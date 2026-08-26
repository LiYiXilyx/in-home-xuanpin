'use strict';

(() => {
  const STATES=Object.freeze({ IDLE:'IDLE',SCANNING:'SCANNING',BATCH_SUBMITTING:'BATCH_SUBMITTING',SCROLLING:'SCROLLING',
    LOAD_MORE_DETECTED:'LOAD_MORE_DETECTED',LOAD_MORE_TRIGGERED:'LOAD_MORE_TRIGGERED',WAITING_PROGRESS:'WAITING_PROGRESS',
    MANUAL_REQUIRED:'MANUAL_REQUIRED',COMPLETED:'COMPLETED',FAILED:'FAILED',PAUSED:'PAUSED' });
  const LOAD_PATTERN=/^(?:See more|Try again|Try more|Load more|Show more)(?:\s+(?:items|products))?$/i;
  const VERIFY_PATTERN=/captcha|verify you are human|security verification|slide to verify|验证码|安全验证/i;
  const UNHEALTHY_PATTERN=/Oops!\s*The items are gone|No results for|Please check your network connection and try again/i;

  class CatalogAutoRunner {
    constructor(dependencies) {
      this.dependencies=dependencies;this.state=STATES.IDLE;this.context=null;this.round=0;this.paused=false;this.stopped=false;
      this.sessionTarget=null;this.lastResult=null;this.listeners=new Set();this.startedAt=null;
      this.stats={ loadMoreSuccessCount:0,retryCount:0,captchaCount:0,oopsCount:0,manualInterventionCount:0,extensionErrorCount:0 };
    }
    subscribe(listener) { this.listeners.add(listener);listener(this.snapshot());return () => this.listeners.delete(listener); }
    snapshot(extra={}) { return { state:this.state,round:this.round,sessionTarget:this.sessionTarget,lastResult:this.lastResult,
      campaign:this.context?.campaign ?? null,queue:this.context?.queue ?? null,...extra }; }
    setState(state,extra={}) { this.state=state;this.emit(extra); }
    emit(extra={}) { const value=this.snapshot(extra);for (const listener of this.listeners) listener(value); }

    async restore() {
      this.context=await this.dependencies.getContext();const checkpoint=this.context.queue?.checkpoint ?? {};
      this.round=Number(checkpoint.round ?? 0);this.sessionTarget=numberOrNull(checkpoint.session_target);
      this.startedAt=checkpoint.ab_started_at ?? null;this.restoreStats(checkpoint);
      this.state=checkpoint.runner_state===STATES.MANUAL_REQUIRED ? STATES.MANUAL_REQUIRED:
        checkpoint.runner_state===STATES.COMPLETED ? STATES.COMPLETED:checkpoint.runner_state===STATES.PAUSED ? STATES.PAUSED:STATES.IDLE;
      this.emit({ lastAction:'checkpoint_restored' });return this.snapshot();
    }

    async start({ smokeLimit=null }={}) {
      if (![STATES.IDLE,STATES.PAUSED,STATES.COMPLETED,STATES.FAILED,STATES.MANUAL_REQUIRED].includes(this.state)) return this.snapshot();
      this.paused=false;this.stopped=false;this.context=await this.dependencies.getContext();
      const checkpoint=this.context.queue?.checkpoint ?? {};
      this.round=Number(checkpoint.round ?? 0);this.restoreStats(checkpoint);
      const campaign=this.context.campaign;
      const savedTarget=numberOrNull(checkpoint.session_target);
      const resumingSmoke=checkpoint.runner_mode==='smoke' && savedTarget!==null
        && savedTarget>Number(campaign.nonElectronicUniqueCount ?? 0) && checkpoint.runner_state!==STATES.COMPLETED;
      this.sessionTarget=smokeLimit===null ? campaign.targetCount:resumingSmoke ? savedTarget:
        Math.min(campaign.targetCount,Number(campaign.nonElectronicUniqueCount ?? 0)+Number(smokeLimit));
      this.startedAt=resumingSmoke ? checkpoint.ab_started_at ?? this.dependencies.now():this.dependencies.now();
      await this.checkpoint('capturing',{ runner_state:STATES.SCANNING,runner_mode:smokeLimit===null ? 'campaign_gate':'smoke',
        session_target:this.sessionTarget,ab_started_at:this.startedAt,last_action:resumingSmoke ? 'resume_checkpoint':'start' });
      return this.run();
    }

    async pause() {
      this.paused=true;this.setState(STATES.PAUSED,{ lastAction:'pause_requested' });
      if (this.context) await this.checkpoint('capturing',{ runner_state:STATES.PAUSED,last_action:'pause' });
      return this.snapshot();
    }
    async stop() {
      this.stopped=true;this.paused=false;this.setState(STATES.IDLE,{ lastAction:'stop_requested' });
      if (this.context) await this.checkpoint('capturing',{ runner_state:STATES.IDLE,last_action:'stop',stop_requested:true });
      return this.snapshot();
    }
    async resume({ smokeLimit=null }={}) {
      this.context=await this.dependencies.getContext();
      if (this.context.queue?.status==='manual_required') await this.dependencies.resume(this.identity({ checkpoint:{ resume_verified:true,runner_state:STATES.SCANNING } }));
      this.state=STATES.PAUSED;
      return this.start({ smokeLimit });
    }

    async run() {
      try {
        while (!this.paused && !this.stopped) {
          this.round+=1;this.setState(STATES.SCANNING,{ lastAction:'scan' });
          const before=this.dependencies.scan();
          if (await this.guardPage(before)) return this.snapshot();

          this.setState(STATES.BATCH_SUBMITTING,{ lastAction:'batch_submit' });
          const submitted=await this.dependencies.submit();this.lastResult=submitted;
          const campaign=submitted.campaign;
          this.context={ ...this.context,campaign:{ ...this.context.campaign,...campaign } };
          await this.checkpoint('capturing',this.metrics({ runner_state:STATES.BATCH_SUBMITTING,last_action:'batch_submitted',
            batch_id:submitted.batch?.batchId ?? null,current_unique:campaign.nonElectronicUniqueCount,
            raw_observed:campaign.rawObservedCount,non_electronic_unique:campaign.nonElectronicUniqueCount,
            excluded_unique:campaign.electronicExcludedCount,manual_review:campaign.manualReviewCount ?? null,
            batch_duplicate_count:submitted.batch?.duplicateCount ?? 0,batch_idempotent_replay:Boolean(submitted.idempotentReplay) }));
          if (Number(campaign.nonElectronicUniqueCount)>=Number(this.sessionTarget)) {
            this.setState(STATES.COMPLETED,{ lastAction:'target_reached' });
            await this.checkpoint('capturing',this.metrics({ runner_state:STATES.COMPLETED,last_action:'target_reached',
              stop_reason:Number(campaign.nonElectronicUniqueCount)>=Number(campaign.targetCount) ? 'CAMPAIGN_GATE_REACHED':'AB_TARGET_REACHED' }));
            return this.snapshot();
          }

          this.setState(STATES.SCROLLING,{ lastAction:'scroll_bottom' });
          await this.dependencies.scroll();await this.dependencies.delay(this.dependencies.scrollWaitMs ?? 2500);
          const afterScroll=this.dependencies.scan();
          if (await this.guardPage(afterScroll)) return this.snapshot();
          const scrollAdded=difference(afterScroll.goodsIds,before.goodsIds);
          if (scrollAdded.length) {
            await this.checkpoint('capturing',this.metrics({ runner_state:STATES.SCROLLING,last_action:'scroll_progress',
              load_state:'LOAD_MORE_PROGRESS',new_goods_count:scrollAdded.length,last_progress_at:this.dependencies.now() }));
            continue;
          }

          const control=this.dependencies.findLoadControl();
          if (!control) return this.manual('LOAD_MORE_RETRYABLE_EXHAUSTED','未找到可用的 See more / Try again / Load more。',
            { button_detected:false,load_more_attempt:0 });
          let progressed=false;
          for (let attempt=1;attempt<=2;attempt+=1) {
            const triggerBefore=this.dependencies.scan();
            if (await this.guardPage(triggerBefore)) return this.snapshot();
            const button=this.dependencies.findLoadControl();
            if (!button) break;
            const label=this.dependencies.controlLabel(button);
            this.setState(STATES.LOAD_MORE_DETECTED,{ lastAction:'load_more_detected',buttonLabel:label,attempt });
            await this.checkpoint('waiting_load_more',this.metrics({ runner_state:STATES.LOAD_MORE_DETECTED,last_action:'load_more_detected',
              button_detected:true,button_label:label,load_more_attempt:attempt,before_card_count:triggerBefore.cardCount,
              before_scroll_height:triggerBefore.scrollHeight }));
            this.setState(STATES.LOAD_MORE_TRIGGERED,{ lastAction:'load_more_triggered',buttonLabel:label,attempt });
            await this.dependencies.trigger(button);
            this.setState(STATES.WAITING_PROGRESS,{ lastAction:'waiting_progress',buttonLabel:label,attempt });
            const progress=await this.dependencies.waitForProgress(triggerBefore,{ timeoutMs:this.dependencies.progressTimeoutMs ?? 10_000 });
            if (progress.verification) return this.manual('CAPTCHA_OR_LOGIN','检测到 CAPTCHA / Security Verification。',{ load_more_attempt:attempt });
            if (progress.unhealthy) return this.manual('LISTING_CONTEXT_UNHEALTHY','商品列表上下文异常或商品卡归零。',{ load_more_attempt:attempt });
            const added=difference(progress.goodsIds,triggerBefore.goodsIds);
            if (added.length) {
              progressed=true;this.stats.loadMoreSuccessCount+=1;
              await this.checkpoint('capturing',this.metrics({ runner_state:STATES.WAITING_PROGRESS,last_action:'load_more_progress',
                load_state:'LOAD_MORE_PROGRESS',new_goods_count:added.length,button_detected:true,button_label:label,
                load_more_attempt:attempt,loading_observed:Boolean(progress.loadingObserved),after_card_count:progress.cardCount,
                after_scroll_height:progress.scrollHeight,last_progress_at:this.dependencies.now() }));
              break;
            }
            this.stats.retryCount+=1;
            await this.checkpoint('waiting_load_more',this.metrics({ runner_state:STATES.WAITING_PROGRESS,last_action:'load_more_retryable',
              load_state:'LOAD_MORE_RETRYABLE',new_goods_count:0,button_detected:true,button_label:label,
              load_more_attempt:attempt,loading_observed:Boolean(progress.loadingObserved),after_card_count:progress.cardCount,
              after_scroll_height:progress.scrollHeight }));
            if (attempt===1) await this.dependencies.delay(this.dependencies.retryWaitMs ?? 8000);
          }
          if (!progressed) return this.manual('LOAD_MORE_RETRYABLE_EXHAUSTED','两次DOM触发均未产生新goods_id，等待人工处理。',
            { load_state:'LOAD_MORE_RETRYABLE',load_more_attempt:2,new_goods_count:0 });
        }
        return this.snapshot();
      } catch (error) {
        this.stats.extensionErrorCount+=1;
        this.setState(STATES.FAILED,{ lastAction:'failed',errorCode:error.code,errorMessage:error.message });
        if (this.context) await this.checkpoint('capturing',this.metrics({ runner_state:STATES.FAILED,last_action:'failed',
          extension_error:error.code ?? error.message })).catch(() => {});
        return this.snapshot({ error });
      }
    }

    async guardPage(signals) {
      if (signals.verification) { await this.manual('CAPTCHA_OR_LOGIN','检测到 CAPTCHA / Security Verification。');return true; }
      if (signals.unhealthy || signals.cardCount===0) { await this.manual('LISTING_CONTEXT_UNHEALTHY','商品列表上下文异常或商品卡归零。');return true; }
      return false;
    }
    async manual(code,message,checkpoint={}) {
      this.stats.manualInterventionCount+=1;
      if (code==='CAPTCHA_OR_LOGIN') this.stats.captchaCount+=1;
      if (code==='LISTING_CONTEXT_UNHEALTHY') this.stats.oopsCount+=1;
      this.setState(STATES.MANUAL_REQUIRED,{ lastAction:'manual_required',errorCode:code,errorMessage:message });
      await this.dependencies.manualRequired(this.identity({ error_code:code,error_message:message,
        checkpoint:this.metrics({ ...checkpoint,runner_state:STATES.MANUAL_REQUIRED,last_action:'manual_required' }) }));
      return this.snapshot();
    }
    identity(extra={}) { return { campaign_id:this.context.campaign.id,source_id:this.context.source.id,queue_id:this.context.queue.id,...extra }; }
    metrics(extra={}) { const signals=this.dependencies.scan();return { round:this.round,scroll_height:signals.scrollHeight,
      current_dom_unique:signals.goodsIds.size,card_count:signals.cardCount,load_more_success_count:this.stats.loadMoreSuccessCount,
      retry_count:this.stats.retryCount,captcha_count:this.stats.captchaCount,oops_count:this.stats.oopsCount,
      manual_intervention_count:this.stats.manualInterventionCount,extension_error_count:this.stats.extensionErrorCount,
      elapsed_ms:this.startedAt ? Math.max(0,Date.now()-Date.parse(this.startedAt)):0,...extra }; }
    checkpoint(status,checkpoint) { return this.dependencies.checkpoint(this.identity({ status,checkpoint })); }
    restoreStats(checkpoint) { this.stats={ loadMoreSuccessCount:Number(checkpoint.load_more_success_count ?? 0),
      retryCount:Number(checkpoint.retry_count ?? 0),captchaCount:Number(checkpoint.captcha_count ?? 0),
      oopsCount:Number(checkpoint.oops_count ?? 0),manualInterventionCount:Number(checkpoint.manual_intervention_count ?? 0),
      extensionErrorCount:Number(checkpoint.extension_error_count ?? 0) }; }
  }

  function difference(after,before) { const known=before instanceof Set ? before:new Set(before ?? []);return [...after].filter(id => !known.has(id)); }
  function numberOrNull(value) { const result=Number(value);return value===null || value===undefined || value==='' || !Number.isFinite(result) ? null:result; }
  function visible(element) { if (!element) return false;const style=getComputedStyle(element);const rect=element.getBoundingClientRect();
    return style.display!=='none' && style.visibility!=='hidden' && Number(style.opacity)!==0 && rect.width>0 && rect.height>0; }
  function scanDom() {
    const parser=globalThis.TemuCatalogParser;const cards=parser?.parseDocument(document,{ baseUrl:location.href }) ?? [];
    const text=String(document.body?.innerText ?? '');const goodsIds=new Set(cards.map(card => card.goods_id).filter(Boolean));
    const root=document.scrollingElement || document.documentElement;
    return { goodsIds,cardCount:cards.length,scrollHeight:Number(root?.scrollHeight ?? 0),
      verification:VERIFY_PATTERN.test(text) || /\/bgn_verification\.html/i.test(location.href)
        || [...document.querySelectorAll('iframe')].some(frame => /\/bgn_verification\.html/i.test(frame.src ?? '')),
      unhealthy:UNHEALTHY_PATTERN.test(text) || cards.length===0,loading:/\bloading\s*(?:\.\.\.|…)?/i.test(text) };
  }
  function findLoadControl() { return [...document.querySelectorAll('button,[role="button"],a')]
    .find(element => visible(element) && LOAD_PATTERN.test(String(element.innerText ?? element.textContent ?? '').trim())); }
  function send(message) { return new Promise((resolve,reject) => chrome.runtime.sendMessage(message,response => {
    const runtimeError=chrome.runtime.lastError;if (runtimeError) reject(new Error(runtimeError.message));
    else if (!response?.ok) { const error=new Error(response?.error?.message ?? response?.error ?? 'Catalog Extension API失败。');error.code=response?.error?.code ?? response?.errorCode;reject(error); }
    else resolve(response);
  })); }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve,ms)); }
  async function waitForProgress(before,{ timeoutMs }) {
    const deadline=Date.now()+timeoutMs;let loadingObserved=false;let current=before;
    while (Date.now()<deadline) {
      await wait(250);current=scanDom();loadingObserved ||= current.loading;
      if (current.verification || current.unhealthy || difference(current.goodsIds,before.goodsIds).length) break;
    }
    return { ...current,loadingObserved };
  }
  function realDependencies() { return { scan:scanDom,findLoadControl,controlLabel:element => String(element.innerText ?? element.textContent ?? '').trim(),
    trigger:async element => { element.scrollIntoView({ block:'center',behavior:'instant' });await wait(300);element.click(); },
    scroll:async () => { const root=document.scrollingElement || document.documentElement;root.scrollTop=root.scrollHeight;window.scrollTo(0,root.scrollHeight); },
    delay:wait,waitForProgress,now:() => new Date().toISOString(),
    getContext:async () => (await send({ type:'GET_CATALOG_CURRENT' })).context,
    submit:async () => globalThis.TemuCatalogCapture.capture({}),
    checkpoint:async payload => (await send({ type:'SAVE_CATALOG_CHECKPOINT',payload })).result,
    manualRequired:async payload => (await send({ type:'CATALOG_MANUAL_REQUIRED',payload })).result,
    resume:async payload => (await send({ type:'RESUME_CATALOG_RUNNER',payload })).result };
  }

  function installUi(runner) {
    const id='temu-catalog-auto-runner';if (document.getElementById(id)) return;
    const panel=document.createElement('div');panel.id=id;
    Object.assign(panel.style,{ all:'initial',position:'fixed',right:'18px',bottom:'172px',zIndex:'2147483647',width:'390px',boxSizing:'border-box',padding:'11px',borderRadius:'8px',background:'#163047',color:'#fff',font:'13px/1.4 system-ui,sans-serif',boxShadow:'0 3px 12px rgba(0,0,0,.3)' });
    const title=document.createElement('div');title.textContent='Catalog Extension Auto Runner';title.style.fontWeight='700';
    const controls=document.createElement('div');controls.style.margin='8px 0';
    const make=(label,handler) => { const button=document.createElement('button');button.type='button';button.textContent=label;
      Object.assign(button.style,{ margin:'0 6px 6px 0',padding:'6px 8px',border:'0',borderRadius:'5px',cursor:'pointer' });button.addEventListener('click',handler);controls.append(button);return button; };
    make('开始自动采集',() => runner.start());make('暂停',() => runner.pause());
    make('继续',() => runner.resume());make('停止',() => runner.stop());
    const status=document.createElement('div');status.textContent='IDLE';
    runner.subscribe(value => { const campaign=value.campaign ?? {};status.textContent=`${value.state}｜Campaign ${campaign.id ?? '-'}｜unique ${campaign.nonElectronicUniqueCount ?? '-'} / ${value.sessionTarget ?? campaign.targetCount ?? '-'}｜raw ${campaign.rawObservedCount ?? '-'}｜excluded ${campaign.electronicExcludedCount ?? '-'}｜round ${value.round}｜${value.lastAction ?? '-'}${value.errorCode ? `｜${value.errorCode}: ${value.errorMessage ?? ''}`:''}`; });
    panel.append(title,controls,status);document.documentElement.append(panel);
  }

  const module=Object.freeze({ CatalogAutoRunner,STATES,difference,scanDom,findLoadControl,waitForProgress });
  globalThis.TemuCatalogAutoRunnerModule=module;
  if (typeof document!=='undefined' && typeof chrome!=='undefined') { const runner=new CatalogAutoRunner(realDependencies());globalThis.TemuCatalogAutoRunner=runner;installUi(runner);runner.restore().catch(() => {}); }
})();
