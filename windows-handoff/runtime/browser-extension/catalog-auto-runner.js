'use strict';

(() => {
  const NETWORK_CAPTURE_DEBUG_BUILD='2026-08-27-C';
  const STATES=Object.freeze({ IDLE:'IDLE',SCANNING:'SCANNING',BATCH_SUBMITTING:'BATCH_SUBMITTING',SCROLLING:'SCROLLING',
    LOAD_MORE_DETECTED:'LOAD_MORE_DETECTED',LOAD_MORE_TRIGGERED:'LOAD_MORE_TRIGGERED',WAITING_PROGRESS:'WAITING_PROGRESS',
    MANUAL_REQUIRED:'MANUAL_REQUIRED',COMPLETED:'COMPLETED',FAILED:'FAILED',PAUSED:'PAUSED' });
  const LOAD_PATTERN=/^(?:See more|Load more|Show more)(?:\s+(?:items|products))?$/i;
  const TRY_AGAIN_PATTERN=/^(?:Try again|Try more)$/i;
  const TARGET_CATEGORY='Motorcycles & Powersports Accessories';
  const TARGET_SORT='Top sales';
  const VERIFY_PATTERN=/captcha|verify you are human|security verification|slide to verify|验证码|安全验证/i;
  const UNHEALTHY_PATTERN=/Oops!\s*The items are gone|No results for|Please check your network connection and try again/i;
  const STATE_UI=Object.freeze({ IDLE:['未开始','#64748b'],SCANNING:['正在扫描商品卡','#0ea5e9'],BATCH_SUBMITTING:['正在保存数据','#2563eb'],
    SCROLLING:['正在加载下一批','#7c3aed'],LOAD_MORE_DETECTED:['发现加载按钮','#7c3aed'],LOAD_MORE_TRIGGERED:['已点击加载按钮','#7c3aed'],
    WAITING_PROGRESS:['等待新商品出现','#d97706'],MANUAL_REQUIRED:['需要人工处理','#dc2626'],COMPLETED:['本轮目标已完成','#16a34a'],
    FAILED:['运行失败','#dc2626'],PAUSED:['已暂停','#64748b'] });

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
        checkpoint.runner_state===STATES.COMPLETED ? STATES.COMPLETED:checkpoint.runner_state===STATES.PAUSED ? STATES.PAUSED:
          checkpoint.runner_state===STATES.FAILED ? STATES.FAILED:STATES.IDLE;
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
          const networkAudit=globalThis.TemuCatalogNetworkCache?.diagnostics?.(before.goodsIds) ?? null;
          await this.checkpoint('capturing',this.metrics({ runner_state:STATES.BATCH_SUBMITTING,last_action:'batch_submitted',
            batch_id:submitted.batch?.batchId ?? null,current_unique:campaign.nonElectronicUniqueCount,
            raw_observed:campaign.rawObservedCount,non_electronic_unique:campaign.nonElectronicUniqueCount,
            excluded_unique:campaign.electronicExcludedCount,manual_review:campaign.manualReviewCount ?? null,
            campaign_staging_deduped:submitted.batch?.duplicateCount ?? 0,
            campaign_target:submitted.audit?.campaignTarget ?? campaign.targetCount,
            target_reached:Boolean(submitted.audit?.targetReached),service_observed:submitted.audit?.serviceObserved ?? null,
            electronic_excluded:submitted.audit?.electronicExcluded ?? null,
            other_business_excluded:submitted.audit?.otherBusinessExcluded ?? null,
            eligible_goods:submitted.audit?.eligibleGoods ?? null,accepted_goods:submitted.audit?.acceptedGoods ?? null,
            stopped_due_to_target:submitted.audit?.stoppedDueToTarget ?? null,
            unprocessed_after_target:submitted.audit?.unprocessedAfterTarget ?? null,
            network_duplicate_rows:networkAudit ? Math.max(0,Number(networkAudit.main_products_sent_count??0)-Number(networkAudit.network_unique_goods??0)):null,
            cache_duplicate_goods:networkAudit?.cache_deduped_goods ?? null,
            batch_idempotent_replay:Boolean(submitted.idempotentReplay) }));
          if (Number(campaign.nonElectronicUniqueCount)>=Number(this.sessionTarget)) {
            this.setState(STATES.COMPLETED,{ lastAction:'target_reached' });
            await this.checkpoint('capturing',this.metrics({ runner_state:STATES.COMPLETED,last_action:'target_reached',
              stop_reason:Number(campaign.nonElectronicUniqueCount)>=Number(campaign.targetCount) ? 'CAMPAIGN_GATE_REACHED':'AB_TARGET_REACHED' }));
            return this.snapshot();
          }

          this.setState(STATES.SCROLLING,{ lastAction:'scroll_bottom' });
          await this.dependencies.scroll();await this.dependencies.delay(this.dependencies.scrollWaitMs ?? 6000);
          const afterScroll=this.dependencies.scan();
          if (await this.guardPage(afterScroll)) return this.snapshot();
          const scrollAdded=difference(afterScroll.goodsIds,before.goodsIds);
          if (scrollAdded.length) {
            await this.checkpoint('capturing',this.metrics({ runner_state:STATES.SCROLLING,last_action:'scroll_progress',
              load_state:'LOAD_MORE_PROGRESS',new_goods_count:scrollAdded.length,last_progress_at:this.dependencies.now() }));
            await this.dependencies.delay(this.dependencies.progressCooldownMs ?? 5000);
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
            const progress=await this.dependencies.waitForProgress(triggerBefore,{ timeoutMs:this.dependencies.progressTimeoutMs ?? 20_000 });
            if (progress.verification) return this.manual('CAPTCHA_OR_LOGIN','检测到 CAPTCHA / Security Verification。',{ load_more_attempt:attempt });
            if (progress.unhealthy) return this.manual('LISTING_CONTEXT_UNHEALTHY','商品列表上下文异常或商品卡归零。',{ load_more_attempt:attempt });
            const added=difference(progress.goodsIds,triggerBefore.goodsIds);
            if (added.length) {
              progressed=true;this.stats.loadMoreSuccessCount+=1;
              await this.checkpoint('capturing',this.metrics({ runner_state:STATES.WAITING_PROGRESS,last_action:'load_more_progress',
                load_state:'LOAD_MORE_PROGRESS',new_goods_count:added.length,button_detected:true,button_label:label,
                load_more_attempt:attempt,loading_observed:Boolean(progress.loadingObserved),after_card_count:progress.cardCount,
                after_scroll_height:progress.scrollHeight,last_progress_at:this.dependencies.now() }));
              await this.dependencies.delay(this.dependencies.progressCooldownMs ?? 5000);
              break;
            }
            this.stats.retryCount+=1;
            await this.checkpoint('waiting_load_more',this.metrics({ runner_state:STATES.WAITING_PROGRESS,last_action:'load_more_retryable',
              load_state:'LOAD_MORE_RETRYABLE',new_goods_count:0,button_detected:true,button_label:label,
              load_more_attempt:attempt,loading_observed:Boolean(progress.loadingObserved),after_card_count:progress.cardCount,
              after_scroll_height:progress.scrollHeight }));
            if (attempt===1) await this.dependencies.delay(this.dependencies.retryWaitMs ?? 15000);
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
      if (signals.tryAgain) { await this.manual('LISTING_CONTEXT_UNHEALTHY','检测到 Try again，已暂停并等待人工恢复。');return true; }
      if (signals.unhealthy || signals.cardCount===0) { await this.manual('LISTING_CONTEXT_UNHEALTHY','商品列表上下文异常或商品卡归零。');return true; }
      if (signals.contextHealthy===false) { await this.manual('LISTING_CONTEXT_UNHEALTHY',
        `页面上下文不符合 Germany / English / EUR / ${TARGET_CATEGORY} / ${TARGET_SORT}。`);return true; }
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
    const text=String(document.body?.innerText ?? ''),lower=text.toLowerCase();const goodsIds=new Set(cards.map(card => card.goods_id).filter(Boolean));
    const root=document.scrollingElement || document.documentElement;
    const category=String(document.querySelector('h1')?.textContent??'').replace(/\s+/g,' ').trim(),sort=detectSortLabel();
    const germany=/\/de-en\//i.test(location.pathname)||/germany/i.test(lower),english=String(document.documentElement.lang??'').toLowerCase().startsWith('en')||/\/de-en\//i.test(location.pathname),eur=/€|\bEUR\b/i.test(text);
    return { goodsIds,cardCount:cards.length,scrollHeight:Number(root?.scrollHeight ?? 0),category,sort,germany,english,eur,
      verification:VERIFY_PATTERN.test(text) || /\/bgn_verification\.html/i.test(location.href)
        || [...document.querySelectorAll('iframe')].some(frame => /\/bgn_verification\.html/i.test(frame.src ?? '')),
      unhealthy:UNHEALTHY_PATTERN.test(text) || cards.length===0,
      tryAgain:[...document.querySelectorAll('button,[role="button"],a')].some(element=>visible(element)&&TRY_AGAIN_PATTERN.test(String(element.innerText??element.textContent??'').trim())),
      contextHealthy:germany&&english&&eur&&category===TARGET_CATEGORY&&new RegExp(`^${TARGET_SORT}$`,'i').test(sort),
      loading:/\bloading\s*(?:\.\.\.|…)?/i.test(text) };
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
    trigger:async element => { element.scrollIntoView({ block:'center',behavior:'instant' });await wait(1200);element.click(); },
    scroll:async () => { const root=document.scrollingElement || document.documentElement;root.scrollTop=root.scrollHeight;window.scrollTo(0,root.scrollHeight); },
    delay:wait,waitForProgress,now:() => new Date().toISOString(),
    getContext:async () => (await send({ type:'GET_CATALOG_CURRENT' })).context,
    submit:async () => globalThis.TemuCatalogCapture.capture({}),
    checkpoint:async payload => (await send({ type:'SAVE_CATALOG_CHECKPOINT',payload })).result,
    manualRequired:async payload => (await send({ type:'CATALOG_MANUAL_REQUIRED',payload })).result,
    resume:async payload => (await send({ type:'RESUME_CATALOG_RUNNER',payload })).result };
  }

  function detectSortLabel() {
    const controls=[...new Set([...document.querySelectorAll('[role="button"][aria-controls="sort-select-down-list"]'),
      ...document.querySelectorAll('button,[role="button"]')])];
    const control=controls.find(node=>visible(node)&&String(node.innerText??node.textContent??'').split(/\r?\n/).some(line=>/^Sort by:/i.test(line.trim())));
    const line=String(control?.innerText??control?.textContent??'').split(/\r?\n/).map(value=>value.replace(/\s+/g,' ').trim()).find(value=>/^Sort by:/i.test(value));
    return line ? line.replace(/^Sort by:\s*/i,'').trim():'未识别';
  }
  function humanAction(action) { return ({ checkpoint_restored:'已恢复上次进度',scan:'扫描商品卡',batch_submit:'准备保存',batch_submitted:'数据已保存',
    scroll_bottom:'滚动加载',scroll_progress:'发现新商品',load_more_detected:'发现 See more / Load more',load_more_triggered:'已触发加载',
    waiting_progress:'等待页面返回新商品',load_more_progress:'加载成功',load_more_retryable:'加载未新增，准备重试',manual_required:'等待人工处理',
    target_reached:'已达到目标',pause_requested:'正在暂停',pause:'已暂停',stop_requested:'已停止',failed:'运行失败',start:'开始采集',resume_checkpoint:'从 checkpoint 继续' })[action] ?? action ?? '-'; }
  function uiSummary(value,sortLabel='未识别') {
    const campaign=value.campaign ?? {};const target=Number(value.sessionTarget ?? campaign.targetCount ?? 0);const current=Number(campaign.nonElectronicUniqueCount ?? 0);
    const [stateLabel,stateColor]=STATE_UI[value.state] ?? [value.state,'#64748b'];
    const refresh=campaign.refreshProgress??{};
    return { stateLabel,stateColor,target,current,percent:target ? Math.min(100,Math.round(current/target*100)):0,
      raw:Number(campaign.rawObservedCount ?? 0),excluded:Number(campaign.electronicExcludedCount ?? 0),round:Number(value.round ?? 0),
      existingRefreshed:Number(refresh.intersection_count??0),newProducts:Number(refresh.new_goods_count??0),remaining:Math.max(0,target-current),
      action:humanAction(value.lastAction),sortLabel,sortHealthy:/^Top\s*sales$/i.test(sortLabel) };
  }

  function installUi(runner) {
    const id='temu-catalog-auto-runner';if (document.getElementById(id)) return;
    const panel=document.createElement('div');panel.id=id;
    Object.assign(panel.style,{ all:'initial',position:'fixed',right:'18px',bottom:'150px',zIndex:'2147483647',width:'370px',boxSizing:'border-box',padding:'14px',borderRadius:'12px',background:'#102a43',color:'#fff',font:'14px/1.45 system-ui,"Microsoft YaHei",sans-serif',boxShadow:'0 8px 28px rgba(0,0,0,.35)' });
    const launcher=document.createElement('button');launcher.id=`${id}-launcher`;launcher.type='button';launcher.textContent='Catalog';
    Object.assign(launcher.style,{ all:'initial',position:'fixed',right:'18px',bottom:'122px',zIndex:'2147483647',padding:'7px 11px',borderRadius:'7px',background:'#102a43',color:'#fff',font:'700 13px/1.2 system-ui,sans-serif',cursor:'pointer',boxShadow:'0 3px 12px rgba(0,0,0,.25)' });
    const header=document.createElement('div');Object.assign(header.style,{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px' });
    const title=document.createElement('div');title.textContent='Catalog';Object.assign(title.style,{ fontWeight:'800',fontSize:'17px' });
    const badge=document.createElement('span');Object.assign(badge.style,{ padding:'3px 8px',borderRadius:'999px',fontWeight:'700',fontSize:'12px',background:'#64748b' });
    const collapseButton=document.createElement('button');collapseButton.type='button';collapseButton.textContent='收起';collapseButton.title='收起 Catalog 面板';
    Object.assign(collapseButton.style,{ all:'initial',padding:'3px 7px',borderRadius:'5px',background:'#334e68',color:'#fff',font:'700 12px/1.2 system-ui,sans-serif',cursor:'pointer' });
    const setCollapsed=collapsed => { panel.style.display=collapsed?'none':'block';launcher.style.display=collapsed?'block':'none'; };
    collapseButton.addEventListener('click',() => setCollapsed(true));launcher.addEventListener('click',() => setCollapsed(false));header.append(title,badge,collapseButton);
    const progressText=document.createElement('div');Object.assign(progressText.style,{ marginTop:'11px',fontSize:'22px',fontWeight:'800' });
    const track=document.createElement('div');Object.assign(track.style,{ height:'10px',margin:'6px 0 10px',borderRadius:'999px',background:'rgba(255,255,255,.2)',overflow:'hidden' });
    const bar=document.createElement('div');Object.assign(bar.style,{ height:'100%',width:'0%',background:'#22c55e',transition:'width .25s ease' });track.append(bar);
    const details=document.createElement('div');Object.assign(details.style,{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 12px',fontSize:'13px',color:'#dbeafe' });
    const networkDetails=document.createElement('div');Object.assign(networkDetails.style,{ marginTop:'8px',fontSize:'12px',color:'#bfdbfe',whiteSpace:'pre-wrap' });
    const notice=document.createElement('div');Object.assign(notice.style,{ display:'none',marginTop:'10px',padding:'8px 10px',borderRadius:'7px',background:'#7f1d1d',color:'#fff',fontWeight:'700',whiteSpace:'pre-wrap' });
    const controls=document.createElement('div');controls.style.margin='11px 0 0';
    const make=(label,handler) => { const button=document.createElement('button');button.type='button';button.textContent=label;
      Object.assign(button.style,{ margin:'0 6px 6px 0',padding:'7px 10px',border:'0',borderRadius:'6px',cursor:'pointer',fontWeight:'700',background:'#e2e8f0',color:'#0f172a' });button.addEventListener('click',handler);controls.append(button);return button; };
    const startButton=make('首次开始',() => runner.start());const pauseButton=make('暂停',() => runner.pause());
    const resumeButton=make('恢复当前进度',() => runner.resume());const stopButton=make('停止',() => runner.stop());
    runner.subscribe(value => { const summary=uiSummary(value,detectSortLabel());const campaign=value.campaign??{};
      title.textContent=`Catalog ${summary.target||''} ${campaign.campaignType==='expansion'?'扩容':'刷新'}`.replace(/\s+/g,' ').trim();badge.textContent=summary.stateLabel;badge.style.background=summary.stateColor;
      progressText.textContent=`已采集 ${summary.current} / ${summary.target}（${summary.percent}%）`;bar.style.width=`${summary.percent}%`;
      details.innerHTML=`<span>已刷新旧品：<b>${summary.existingRefreshed}</b></span><span>本轮新商品：<b>${summary.newProducts}</b></span><span>剩余：<b>${summary.remaining}</b></span><span>电子排除：<b>${summary.excluded}</b></span><span>原始观察：<b>${summary.raw}</b></span><span>运行轮次：<b>${summary.round}</b></span><span>当前排序：<b>${summary.sortLabel}</b></span><span style="grid-column:1 / -1">当前动作：<b>${summary.action}</b></span>`;
      const warnings=[];if(!summary.sortHealthy)warnings.push('⚠ 请把页面排序改成 Top sales');if(value.state===STATES.MANUAL_REQUIRED)warnings.push(`⚠ 需要人工处理：${value.errorMessage ?? '请检查 Try again、验证码或 Oops'}`);if(value.errorCode)warnings.push(`错误代码：${value.errorCode}`);
      notice.textContent=warnings.join('\n');notice.style.display=warnings.length?'block':'none';
      const active=[STATES.SCANNING,STATES.BATCH_SUBMITTING,STATES.SCROLLING,STATES.LOAD_MORE_DETECTED,STATES.LOAD_MORE_TRIGGERED,STATES.WAITING_PROGRESS].includes(value.state);
      startButton.disabled=value.state!==STATES.IDLE;pauseButton.disabled=!active;resumeButton.disabled=![STATES.PAUSED,STATES.MANUAL_REQUIRED,STATES.FAILED].includes(value.state);stopButton.disabled=value.state===STATES.IDLE;
      for(const button of [startButton,pauseButton,resumeButton,stopButton])button.style.opacity=button.disabled?'.45':'1';resumeButton.style.background=resumeButton.disabled?'#e2e8f0':'#22c55e';
    });
    const refreshNetworkDiagnostics=() => {
      const parser=globalThis.TemuCatalogParser,rawCards=parser?.parseDocument(document,{baseUrl:location.href,enrich:false}) ?? [],cards=parser?.enrichCards(rawCards) ?? rawCards;
      const diagnostics=globalThis.TemuCatalogNetworkCache?.diagnostics?.(rawCards.map(card=>card.goods_id)) ?? {};
      const preview=cards.slice(0,10).map((card,index)=>({ goods_id:card.goods_id,dom:{title:rawCards[index]?.title??null,price_amount:rawCards[index]?.price_amount??null,sales_count:rawCards[index]?.sales_count??null,rating:rawCards[index]?.rating??null,review_count:rawCards[index]?.review_count??null},network:card.capture_transport==='NETWORK_ENRICHED'?{title:card.title,price_amount:card.price_amount,sales_count:card.sales_count,rating:card.rating,review_count:card.review_count}:null,merged:{title:card.title,price_amount:card.price_amount,sales_count:card.sales_count,rating:card.rating,review_count:card.review_count},source_url:card.href,
        capture_transport:card.capture_transport,field_provenance:card.field_provenance }));
      networkDetails.textContent=`Network Capture Debug Build: ${NETWORK_CAPTURE_DEBUG_BUILD}\nNetwork：${diagnostics.network_interceptor_ready?'已就绪':'未就绪'}｜Fetch ${diagnostics.total_fetch_seen??0}｜XHR ${diagnostics.total_xhr_seen??0}｜Allowlist ${diagnostics.allowlist_matched??0}｜MAIN消息 ${diagnostics.main_products_message_sent??0}/${diagnostics.main_products_sent_count??0}｜隔离接收 ${diagnostics.isolated_products_message_received??0}/${diagnostics.isolated_products_received_count??0}｜缓存 ${diagnostics.network_cache_size??0}｜增强 ${diagnostics.network_enriched_goods??0}｜拒绝 ${(diagnostics.bridge_schema_rejected??0)+(diagnostics.bridge_nonce_rejected??0)+(diagnostics.bridge_unknown_type??0)+(diagnostics.bridge_payload_rejected??0)}${diagnostics.bridge_last_reject_reason?`（${diagnostics.bridge_last_reject_reason}）`:''}`;
      panel.dataset.networkDiagnostics=JSON.stringify(diagnostics);panel.dataset.networkPreview=JSON.stringify(preview);
    };
    refreshNetworkDiagnostics();setInterval(refreshNetworkDiagnostics,2000);
    panel.append(header,progressText,track,details,networkDetails,notice,controls);document.documentElement.append(panel,launcher);
    setCollapsed(location.pathname==='/' || /-g-\d+\.html/i.test(location.pathname) || /(?:login|sign[-_]?in|register|verification)/i.test(location.pathname));
  }

  const module=Object.freeze({ CatalogAutoRunner,STATES,difference,scanDom,findLoadControl,waitForProgress,uiSummary,humanAction });
  globalThis.TemuCatalogAutoRunnerModule=module;
  if (typeof document!=='undefined' && typeof chrome!=='undefined') { (async()=>{const dependencies=realDependencies();let context=null;try{context=await dependencies.getContext();}catch{}
    const mode=globalThis.TemuCatalogOverlayMode?.resolveCatalogOverlayMode(context)??'BLOCKED';
    if(mode!=='LEGACY_AUTO_RUNNER')return;
    const runner=new CatalogAutoRunner(dependencies);globalThis.TemuCatalogAutoRunner=runner;installUi(runner);runner.restore().catch(()=>{});})().catch(()=>{}); }
})();
