'use strict';

(() => {
  const MODE='MANUAL_NAVIGATION_PASSIVE_CAPTURE';
  const TARGET_CATEGORY='Motorcycles & Powersports Accessories';
  const TARGET_SORT='Top sales';
  const STATES=Object.freeze({ UNBOUND:'UNBOUND',PAGE_BOUND:'PAGE_BOUND',PAGE_CONTEXT_LOST:'PAGE_CONTEXT_LOST',CAPTURING:'CAPTURING',
    PAUSED:'PAUSED',TARGET_REACHED:'TARGET_REACHED',COMPLETED:'COMPLETED',FAILED:'FAILED' });
  const VERIFY_PATTERN=/captcha|verify you are human|security verification|slide to verify|验证码|安全验证/i;
  const UNHEALTHY_PATTERN=/Oops!\s*The items are gone|No results for|Please check your network connection and try again/i;

  class ManualPassiveRunner {
    constructor(dependencies,context=null) { this.dependencies=dependencies;this.context=context;this.state=STATES.UNBOUND;this.listeners=new Set();
      this.timer=null;this.ticking=false;this.sessionTarget=null;this.originUnique=null;this.stageTarget=null;this.binding=null;this.lastResult=null;this.lastError=null;this.submitted=new Set(); }
    subscribe(listener){this.listeners.add(listener);listener(this.snapshot());return()=>this.listeners.delete(listener);}
    snapshot(extra={}){const cp=this.context?.queue?.checkpoint??{};return { state:this.state,context:this.context,campaign:this.context?.campaign??null,queue:this.context?.queue??null,
      sessionTarget:this.sessionTarget,originUnique:this.originUnique,stageTarget:this.stageTarget,binding:this.binding,lastResult:this.lastResult,lastError:this.lastError,
      qa50Status:cp.qa_50_status??'PENDING',qa300Status:cp.qa_300_status??'PENDING',...extra };}
    emit(extra={}){const value=this.snapshot(extra);for(const listener of this.listeners)listener(value);}
    setState(state,extra={}){this.state=state;this.emit(extra);}

    async restore(context=null) {
      context=context??this.context??await this.dependencies.getContext();this.context=context;const cp=context.queue?.checkpoint??{};
      if(context.campaign.browserControlMode!==MODE||context.campaign.cdpRequired!==false||context.campaign.extensionPassiveRequired!==true||context.campaign.localServerEndpoint!=='http://127.0.0.1:37821')throw coded('MANUAL_PASSIVE_RUNTIME_MISMATCH','Manual Passive runtime配置不匹配。');
      this.originUnique=numberOrNull(cp.capture_origin_unique)??Number(context.campaign.nonElectronicUniqueCount??0);this.stageTarget=numberOrNull(cp.stage_target_delta);this.sessionTarget=numberOrNull(cp.session_target);
      this.binding=null;this.state=context.campaign.status==='completed'?STATES.COMPLETED:Number(context.campaign.nonElectronicUniqueCount)>=Number(context.campaign.targetCount)?STATES.TARGET_REACHED:STATES.UNBOUND;
      this.emit({lastAction:'checkpoint_restored_binding_required'});return this.snapshot();
    }

    async bindCurrentPage() {
      this.stopSchedule();await this.refreshContext();const page=this.dependencies.scan();assertHealthyBinding(page);
      this.binding={ bound_url:page.url,bound_at:this.dependencies.now(),bound_category:page.category,bound_sort:page.sort,bound_goods_count:page.cardCount };
      this.lastError=null;this.state=STATES.PAGE_BOUND;await this.saveCheckpoint({ runner_state:STATES.PAGE_BOUND,last_action:'page_bound',capture_paused:true,
        ...this.binding,page_binding_version:'manual-page-binding-v1' });this.emit({lastAction:'page_bound'});return this.snapshot();
    }

    async start({stageTarget=50}={}) {
      await this.refreshContext();if(this.state!==STATES.PAGE_BOUND||!this.binding)throw coded('PAGE_BINDING_REQUIRED','请先在健康Top sales页面点击“绑定当前页面”。');
      const page=this.dependencies.scan();assertHealthyBinding(page);assertSameBinding(page,this.binding);const cp=this.context.queue?.checkpoint??{},campaign=this.context.campaign;
      this.originUnique=numberOrNull(cp.capture_origin_unique)??Number(campaign.nonElectronicUniqueCount??0);this.assertStageAllowed(stageTarget,cp);this.stageTarget=Number(stageTarget);
      this.sessionTarget=this.stageTarget>=Number(campaign.targetCount)?Number(campaign.targetCount):Math.min(Number(campaign.targetCount),this.originUnique+this.stageTarget);
      if(Number(campaign.nonElectronicUniqueCount)>=this.sessionTarget)return this.reachTarget('STAGE_ALREADY_REACHED');
      this.state=STATES.CAPTURING;await this.saveCheckpoint({ runner_state:STATES.CAPTURING,capture_mode:MODE,cdp_required:false,extension_passive_required:true,
        local_server_endpoint:'http://127.0.0.1:37821',capture_origin_unique:this.originUnique,stage_target_delta:this.stageTarget,session_target:this.sessionTarget,
        last_action:'stage_started',capture_paused:false,failed_count:Number(cp.failed_count??0),...this.binding });
      this.schedule();return this.tick();
    }

    async tick() {
      if(this.ticking||this.state!==STATES.CAPTURING)return this.snapshot();this.ticking=true;
      try {
        await this.refreshContext();const campaign=this.context.campaign;
        if(campaign.status==='completed'){this.stopSchedule();this.setState(STATES.COMPLETED,{lastAction:'campaign_completed'});return this.snapshot();}
        if(this.sessionTarget===null)return await this.contextLost('STAGE_NOT_STARTED',this.dependencies.scan());
        if(Number(campaign.nonElectronicUniqueCount)>=this.sessionTarget)return await this.reachTarget('STAGE_TARGET_REACHED');
        const page=this.dependencies.scan();if(!page.valid||!sameBinding(page,this.binding))return await this.contextLost(pageReason(page),page);
        const remaining=Math.max(0,this.sessionTarget-Number(campaign.nonElectronicUniqueCount));const candidates=this.dependencies.passiveCandidates({ limit:remaining,submitted:this.submitted });
        if(!candidates.length){const diagnostics=this.dependencies.networkDiagnostics(page.goodsIds),changed=this.lastError?.code!=='NO_NEW_PASSIVE_GOODS';this.lastError=coded('NO_NEW_PASSIVE_GOODS','请人工滚动、点击 See more 或切换必要页面后保持当前绑定上下文。');
          if(changed)await this.saveCheckpoint({runner_state:STATES.CAPTURING,last_action:'waiting_manual_navigation',capture_paused:false,current_dom_unique:page.goodsIds.size,
            card_count:page.cardCount,network_cache_size:Number(diagnostics.network_cache_size??0),...this.binding});this.emit({lastAction:'waiting_manual_navigation',errorCode:this.lastError.code,errorMessage:this.lastError.message});return this.snapshot();}
        this.lastError=null;this.emit({lastAction:'passive_batch_submitting'});
        const result=await this.dependencies.submitPassive({ maxCards:remaining,goodsIds:candidates.map(card=>String(card.goods_id)),pageBinding:this.binding });this.lastResult=result;for(const id of result.passiveGoodsIds??[])this.submitted.add(String(id));
        await this.refreshContext();const diagnostics=this.dependencies.networkDiagnostics(page.goodsIds);
        await this.saveCheckpoint({ runner_state:STATES.CAPTURING,last_action:'passive_batch_saved',capture_paused:false,last_batch:result.batch?.batchId??null,
          accepted_unique:Number(this.context.campaign.nonElectronicUniqueCount??0),observed:Number(this.context.campaign.rawObservedCount??0),eligible:Number(this.context.campaign.nonElectronicUniqueCount??0),
          excluded:Number(this.context.campaign.electronicExcludedCount??0),failed_count:Number(this.context.queue?.checkpoint?.failed_count??0),network_parse_errors:Number(diagnostics.network_parse_errors??0),
          parser_rejected_rows:Number(diagnostics.bridge_payload_rejected??0)+Number(diagnostics.bridge_schema_rejected??0),network_cache_size:Number(diagnostics.network_cache_size??0),
          last_network_endpoint:Object.keys(diagnostics.network_endpoint_counts??{}).at(-1)??null,last_captured_at:this.dependencies.now(),...this.binding });
        if(Number(this.context.campaign.nonElectronicUniqueCount)>=this.sessionTarget)return await this.reachTarget('STAGE_TARGET_REACHED');this.emit({lastAction:'passive_batch_saved'});return this.snapshot();
      } catch(error) {
        if(isPageContextError(error))return await this.contextLost(error.code,this.dependencies.scan());
        this.lastError=error;if(isWaitError(error)){this.emit({lastAction:'waiting_runtime',errorCode:error.code,errorMessage:error.message});return this.snapshot();}
        this.stopSchedule();this.state=STATES.FAILED;const failed=Number(this.context?.queue?.checkpoint?.failed_count??0)+1;
        await this.saveCheckpoint({runner_state:STATES.FAILED,last_action:'failed',capture_paused:true,failed_count:failed,last_error_code:error.code??'PASSIVE_CAPTURE_FAILED',last_error_message:error.message}).catch(()=>{});
        this.emit({lastAction:'failed',errorCode:error.code,errorMessage:error.message});return this.snapshot({error});
      } finally {this.ticking=false;}
    }

    async contextLost(reason,page){this.stopSchedule();this.state=STATES.PAGE_CONTEXT_LOST;this.binding=null;this.lastError=coded(reason,'页面上下文已丢失，采集已暂停。请人工恢复健康Top sales页面后重新绑定。');
      await this.saveCheckpoint({runner_state:STATES.PAGE_CONTEXT_LOST,last_action:'page_context_lost',capture_paused:true,context_lost_reason:reason,
        context_lost_at:this.dependencies.now(),current_url:page.url,current_category:page.category,current_sort:page.sort,card_count:page.cardCount});
      this.emit({lastAction:'page_context_lost',errorCode:reason,errorMessage:this.lastError.message});return this.snapshot();}
    async pause(){this.stopSchedule();this.state=STATES.PAUSED;await this.saveCheckpoint({runner_state:STATES.PAUSED,last_action:'paused',capture_paused:true});this.emit({lastAction:'paused'});return this.snapshot();}
    schedule(){if(this.timer===null)this.timer=this.dependencies.setInterval(()=>this.tick(),this.dependencies.pollMs??2500);}
    stopSchedule(){if(this.timer!==null){this.dependencies.clearInterval(this.timer);this.timer=null;}}
    async refreshContext(){const latest=await this.dependencies.getContext();this.context=latest;return latest;}
    async reachTarget(reason){this.stopSchedule();this.state=STATES.TARGET_REACHED;await this.saveCheckpoint({runner_state:STATES.TARGET_REACHED,last_action:'target_reached',capture_paused:true,
      stop_reason:reason,accepted_unique:Number(this.context.campaign.nonElectronicUniqueCount??0),target_reached_at:this.dependencies.now()});this.emit({lastAction:'target_reached'});return this.snapshot();}
    saveCheckpoint(checkpoint){return this.dependencies.checkpoint({campaign_id:this.context.campaign.id,source_id:this.context.source.id,queue_id:this.context.queue.id,status:'capturing',checkpoint});}
    assertStageAllowed(stageTarget,checkpoint){const stage=Number(stageTarget);if(![50,300,Number(this.context.campaign.targetCount)].includes(stage))throw coded('INVALID_STAGE_TARGET','阶段目标只能是50、300或Campaign最终目标。');
      if(stage===300&&checkpoint.qa_50_status!=='PASS')throw coded('STAGE_50_QA_REQUIRED','50 Goods QA未通过。');if(stage===Number(this.context.campaign.targetCount)&&checkpoint.qa_300_status!=='PASS')throw coded('STAGE_300_QA_REQUIRED','300 Goods QA未通过。');}
  }

  function scanDom(){const parser=globalThis.TemuCatalogParser,rawCards=parser?.parseDocument(document,{baseUrl:location.href,enrich:false})??[],text=String(document.body?.innerText??''),lower=text.toLowerCase();
    const goodsIds=new Set(rawCards.map(card=>String(card.goods_id)).filter(Boolean)),heading=String(document.querySelector('h1')?.textContent??'').replace(/\s+/g,' ').trim();
    const sortControl=document.querySelector('[role="button"][aria-controls="sort-select-down-list"]')
      ??[...document.querySelectorAll('button,[role="button"]')].find(node=>/^Sort by:/i.test(String(node.innerText??node.textContent??'').trim()));
    const sortText=String(sortControl?.innerText??sortControl?.textContent??'').split(/\r?\n/).map(value=>value.replace(/\s+/g,' ').trim()).find(value=>/^Sort by:/i.test(value))??'';
    const page={rawCards,goodsIds,cardCount:rawCards.length,url:location.href,category:heading,sort:sortText.replace(/^Sort by:\s*/i,'').trim(),germany:/\/de-en\//i.test(location.pathname)||/germany/i.test(lower),
      english:String(document.documentElement.lang??'').toLowerCase().startsWith('en')||/\/de-en\//i.test(location.pathname),eur:/€|\bEUR\b/i.test(text),verification:VERIFY_PATTERN.test(text)||/\/bgn_verification\.html/i.test(location.href),
      unhealthy:UNHEALTHY_PATTERN.test(text),categoryMatch:heading===TARGET_CATEGORY,sortMatch:new RegExp(`^${TARGET_SORT}$`,'i').test(sortText.replace(/^Sort by:\s*/i,'').trim())};
    page.valid=page.germany&&page.english&&page.eur&&page.categoryMatch&&page.sortMatch&&page.cardCount>0&&!page.verification&&!page.unhealthy;return page;}
  function assertHealthyBinding(page){if(!page.valid)throw coded(pageReason(page),`当前页面不能绑定：Germany=${page.germany}, English=${page.english}, EUR=${page.eur}, Category=${page.category||'null'}, Sort=${page.sort||'null'}, goods=${page.cardCount}。`);}
  function assertSameBinding(page,binding){if(!sameBinding(page,binding))throw coded('PAGE_CONTEXT_LOST','当前页面与绑定上下文不一致。');}
  function sameBinding(page,binding){return Boolean(binding&&page.valid&&page.category===binding.bound_category&&page.sort.toLowerCase()===String(binding.bound_sort).toLowerCase());}
  function pageReason(page){if(page.verification)return'CAPTCHA_OR_LOGIN';if(page.unhealthy)return'PAGE_UNHEALTHY';if(!page.categoryMatch)return'CATEGORY_MISMATCH';if(!page.sortMatch)return'SORT_ORDER_MISMATCH';if(page.cardCount===0)return'NO_PRODUCT_CARDS';if(!page.germany||!page.english||!page.eur)return'CATALOG_CONTEXT_MISMATCH';return'PAGE_CONTEXT_LOST';}
  function passiveCandidates({limit,submitted}){const records=new Set((globalThis.TemuCatalogNetworkCache?.snapshot?.()??[]).map(row=>String(row.goods_id)));return scanDom().rawCards.filter(card=>records.has(String(card.goods_id))&&!submitted.has(String(card.goods_id))).slice(0,Math.max(0,Number(limit)||0));}
  function send(message){return new Promise((resolve,reject)=>chrome.runtime.sendMessage(message,response=>{const runtimeError=chrome.runtime.lastError;if(runtimeError)reject(coded('LOCAL_SERVER_UNAVAILABLE',runtimeError.message));else if(!response?.ok)reject(coded(response?.error?.code??response?.errorCode??'LOCAL_SERVER_UNAVAILABLE',response?.error?.message??response?.error??'本地运营台不可用。'));else resolve(response);}));}
  function realDependencies(){return {scan:scanDom,passiveCandidates,networkDiagnostics:ids=>globalThis.TemuCatalogNetworkCache?.diagnostics?.(ids)??{},submitPassive:options=>globalThis.TemuCatalogCapture.capturePassive(options),
    getContext:async()=>(await send({type:'GET_CATALOG_CURRENT'})).context,checkpoint:async payload=>(await send({type:'SAVE_CATALOG_CHECKPOINT',payload})).result,now:()=>new Date().toISOString(),
    setInterval:(handler,delay)=>globalThis.setInterval(handler,delay),clearInterval:timer=>globalThis.clearInterval(timer),pollMs:2500};}
  function numberOrNull(value){const number=Number(value);return value===null||value===undefined||value===''||!Number.isFinite(number)?null:number;}
  function coded(code,message){const error=new Error(message);error.code=code;return error;}
  function isWaitError(error){return ['LOCAL_SERVER_UNAVAILABLE','NO_PASSIVE_NETWORK_DOM_MATCH','PASSIVE_CAPTURE_NOT_READY','CATALOG_RPA_NOT_CLAIMED'].includes(error?.code);}
  function isPageContextError(error){return ['PAGE_CONTEXT_LOST','PAGE_UNHEALTHY','CATEGORY_MISMATCH','SORT_ORDER_MISMATCH','NO_PRODUCT_CARDS','CATALOG_CONTEXT_MISMATCH','CAPTCHA_OR_LOGIN'].includes(error?.code);}

  function metrics(value){const campaign=value.campaign??{},target=Number(campaign.targetCount??0),accepted=Number(campaign.nonElectronicUniqueCount??0),cp=value.queue?.checkpoint??{};return {campaign:campaign.id??'-',target,accepted,remaining:Math.max(0,target-accepted),observed:Number(campaign.rawObservedCount??0),eligible:accepted,
    existing:Number(campaign.baselinePoolCount??0),newCount:Math.max(0,accepted-Number(campaign.baselinePoolCount??0)),excluded:Number(campaign.electronicExcludedCount??0),failed:Number(cp.failed_count??0),lastBatch:cp.last_batch??'-',campaignStatus:campaign.status??'-'};}
  function stateColor(state){return ({UNBOUND:'#64748b',PAGE_BOUND:'#0f766e',PAGE_CONTEXT_LOST:'#dc2626',CAPTURING:'#2563eb',PAUSED:'#64748b',TARGET_REACHED:'#16a34a',COMPLETED:'#15803d',FAILED:'#dc2626'})[state]??'#64748b';}
  function installUi(runner){const id='temu-catalog-auto-runner';if(document.getElementById(id))return;const panel=document.createElement('div');panel.id=id;Object.assign(panel.style,{all:'initial',position:'fixed',right:'18px',bottom:'150px',zIndex:'2147483647',width:'390px',boxSizing:'border-box',padding:'14px',borderRadius:'12px',background:'#102a43',color:'#fff',font:'13px/1.45 system-ui,"Microsoft YaHei",sans-serif',boxShadow:'0 8px 28px rgba(0,0,0,.35)'});
    const title=document.createElement('div');title.textContent='Human Navigation + Page Binding';Object.assign(title.style,{fontWeight:'800',fontSize:'16px'});const badge=document.createElement('span');Object.assign(badge.style,{float:'right',padding:'3px 8px',borderRadius:'999px',fontWeight:'700'});title.append(badge);
    const grid=document.createElement('div');Object.assign(grid.style,{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 12px',marginTop:'10px',color:'#dbeafe'});const notice=document.createElement('div');Object.assign(notice.style,{marginTop:'9px',padding:'7px',borderRadius:'6px',background:'#334e68',whiteSpace:'pre-wrap'});
    const controls=document.createElement('div');controls.style.marginTop='10px';const button=(label,handler)=>{const b=document.createElement('button');b.textContent=label;b.type='button';Object.assign(b.style,{margin:'0 5px 5px 0',padding:'7px 9px',border:0,borderRadius:'6px',fontWeight:'700',cursor:'pointer'});b.addEventListener('click',()=>handler().catch(error=>{notice.textContent=`${error.code??'ERROR'}: ${error.message}`;}));controls.append(b);return b;};
    const bind=button('绑定当前页面',()=>runner.bindCurrentPage()),start50=button('开始50 QA',()=>runner.start({stageTarget:50})),start300=button('开始300',()=>runner.start({stageTarget:300})),startFinal=button('开始3000',()=>runner.start({stageTarget:Number(runner.context.campaign.targetCount)})),pause=button('暂停',()=>runner.pause());
    runner.subscribe(value=>{const m=metrics(value);badge.textContent=value.state;badge.style.background=stateColor(value.state);grid.innerHTML=`<span>Campaign</span><b>${m.campaign}</b><span>target</span><b>${m.target}</b><span>accepted_unique</span><b>${m.accepted}</b><span>remaining</span><b>${m.remaining}</b><span>observed</span><b>${m.observed}</b><span>eligible</span><b>${m.eligible}</b><span>existing</span><b>${m.existing}</b><span>new</span><b>${m.newCount}</b><span>excluded</span><b>${m.excluded}</b><span>failed</span><b>${m.failed}</b><span>last_batch</span><b>${m.lastBatch}</b><span>campaign_status</span><b>${m.campaignStatus}</b><span>bound_url</span><b>${value.binding?.bound_url??'-'}</b>`;
      notice.textContent=value.errorMessage??(value.state===STATES.PAGE_BOUND?'页面已绑定；可开始当前已解锁阶段。':value.state===STATES.CAPTURING?'采集中：请人工滚动或点击 See more。':'请人工打开健康Top sales页面后绑定。');bind.textContent=[STATES.PAGE_CONTEXT_LOST,STATES.PAUSED].includes(value.state)?'重新绑定当前页面':'绑定当前页面';bind.disabled=value.state===STATES.CAPTURING;start50.disabled=value.state!==STATES.PAGE_BOUND||value.qa50Status==='PASS';start300.disabled=value.state!==STATES.PAGE_BOUND||value.qa50Status!=='PASS'||value.qa300Status==='PASS';startFinal.disabled=value.state!==STATES.PAGE_BOUND||value.qa300Status!=='PASS';pause.disabled=value.state!==STATES.CAPTURING;for(const b of [bind,start50,start300,startFinal,pause])b.style.opacity=b.disabled?'.45':'1';});
    panel.append(title,grid,notice,controls);document.documentElement.append(panel);}

  async function bootstrap(context){document.getElementById('temu-catalog-capture-button')?.remove();document.getElementById('temu-catalog-capture-status')?.remove();const enriched={...context,status:null},runner=new ManualPassiveRunner(realDependencies(),enriched);globalThis.TemuCatalogManualPassiveRunner=runner;installUi(runner);await runner.restore(enriched);return runner;}
  globalThis.TemuCatalogManualPassiveRunnerModule=Object.freeze({MODE,TARGET_CATEGORY,TARGET_SORT,STATES,ManualPassiveRunner,scanDom,passiveCandidates,metrics,bootstrap});
})();
