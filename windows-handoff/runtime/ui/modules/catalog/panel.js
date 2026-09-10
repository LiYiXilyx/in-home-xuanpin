import { createCatalogApi } from './api.js';
import { createCatalogState,patchCatalogState,snapshotCatalogState } from './state.js';
import { buildCreatePayload,buildInitialActivationPayload,buildInitialCreatePayload,buildInitialQaPayload,buildInitialContinuePayload,operatorEntry,
  buildOperatorCategoryDraft,calculateTarget,createRequestIdentity,initialOperatorViewModel,operatorErrorMessage } from './model.js';

const mounts=new WeakMap();
let currentController=null;

export function catalogPanelMarkup(){return `
  <section id="catalog-panel" class="catalog-panel panel" aria-labelledby="catalog-panel-title">
    <div class="catalog-heading">
      <div><p class="eyebrow">手工采集</p><h2 id="catalog-panel-title">新建采集任务</h2><p><a href="/operator-guide.html" target="_blank" rel="noopener">运营操作说明书（完整步骤与常见问题） ↗</a></p></div>
      <span class="catalog-hint">创建任务后，在 Temu 手动插件中检测、绑定、采集。</span>
    </div>
    <p><a href="#existing-task-entry" onclick="event.preventDefault();document.getElementById('existing-task-entry')?.scrollIntoView({behavior:'smooth'});">想接着上次采集？去“继续已有任务”选择原任务 →</a></p><p class="catalog-hint">新类目：识别类目 → 选择类目 → 开始首次采集。继续旧任务、释放活跃队列或周期复采，请使用本页下方“已有商品复采”区。</p><p id="catalog-supplement-help" hidden role="status"></p><section id="catalog-quick-category"><h3>快速使用当前 Temu 类目</h3><p>请在 Temu 扩展中人工点击“识别当前类目”。</p><pre id="catalog-probe-summary">尚未识别</pre><button id="catalog-probe-select" type="button" disabled>选择当前类目</button></section>
    <button id="catalog-add-category" class="catalog-add-category" type="button">手工新建类目（无法自动识别时使用）</button>
    <section id="catalog-manual-bind-steps" class="catalog-manual-bind-steps"><h3>新类目手工采集步骤</h3><ol><li>创建首次任务</li><li>打开 Temu 页面</li><li>扩展检测当前页面</li><li>绑定当前页面</li><li>人工滚动 / See more</li><li>采集当前页面</li></ol><p>手工采集：请在 Temu 页面自行滚动或点击“查看更多”，再点击插件中的“采集当前页面”。</p></section>
    <section id="catalog-onboarding" class="catalog-onboarding" hidden>
      <h3>Temu 新类目首次采集向导</h3>
      <form id="catalog-onboarding-form" class="catalog-onboarding-form">
        <label class="catalog-field">运营显示名称（可用中文）<input id="catalog-onboarding-display-name" required></label>
        <label class="catalog-field">Temu 页面上的类目名称（照原文填写）<input id="catalog-onboarding-page-category" required></label>
        <input id="catalog-onboarding-aliases" type="hidden">
        <input id="catalog-onboarding-parent" type="hidden">
        <label class="catalog-field">页面顶部的类目路径（按顺序填写）<textarea id="catalog-onboarding-breadcrumbs" placeholder="例如：Home > Automotive > Replacement Parts，可直接粘贴或每行填一级" required></textarea></label>
        <label class="catalog-field catalog-onboarding-url">Temu 类目页面链接<input id="catalog-onboarding-listing-url" type="url" required></label>
        <button id="catalog-onboarding-validate" type="submit">检查并继续</button>
      </form>
      <div id="catalog-onboarding-validation" class="catalog-onboarding-validation" hidden>
        <p hidden>Category Key：<strong id="catalog-onboarding-category-key">—</strong></p>
        <p hidden>Profile Version：<strong id="catalog-onboarding-profile-version">—</strong></p>
        <p id="catalog-onboarding-capabilities" hidden>—</p>
        <button id="catalog-onboarding-open-listing" type="button">打开 Temu 类目页</button>
        <label class="catalog-field">采集任务名称<input id="catalog-onboarding-campaign-name" maxlength="200" required></label>
        <button id="catalog-onboarding-save-create" class="primary" type="button">保存并创建首次采集任务</button>
      </div>
    </section>
    <form id="catalog-create-form" class="catalog-form">
      <label class="catalog-field">类目<select id="catalog-category-select" required></select></label>
      <label class="catalog-field" style="display:none">类目配置<select id="catalog-profile-select" required></select></label>
      <label class="catalog-field" style="display:none">采集模式<input id="catalog-capture-mode" value="MANUAL_BIND_PASSIVE_CAPTURE" readonly></label>
      <label class="catalog-field">正式商品池数量<output id="catalog-active-pool-count">0</output></label>
      <label id="catalog-requested-new-field" class="catalog-field">本次新增目标数量<input id="catalog-requested-new" type="number" min="1" step="1"></label>
      <label id="catalog-target-field" class="catalog-field">目标累计数量（以去重入池为准）<output id="catalog-calculated-target">—</output></label>
      <label class="catalog-field">任务名称<input id="catalog-campaign-name" maxlength="200" required></label>
      <button id="catalog-create-campaign" class="catalog-create-button primary" type="submit">创建采集任务</button>
    </form>
    <p id="catalog-loading" class="catalog-loading" hidden>Catalog 加载中…</p>
    <p id="catalog-error" class="catalog-error" style="white-space:pre-line;line-height:1.8" role="alert" hidden></p>
    <button id="catalog-pause-switch" type="button" hidden>暂停当前首次任务，切换类目</button>
    <p id="catalog-pause-feedback" role="status"></p>
    <section id="catalog-claim-blockers" class="catalog-claim-blockers" hidden><h3>Catalog RPA 占用阻塞</h3><pre id="catalog-claim-blocker-list"></pre><button id="catalog-inspect-claim" type="button">检查占用状态</button><button id="catalog-end-stale-claim" type="button" disabled>结束陈旧占用</button></section>
    <section id="catalog-current-campaign" class="catalog-current" hidden>
      <h3 class="catalog-current-title">当前采集任务</h3>
      <dl class="catalog-current-grid">
        <div class="catalog-current-field"><dt>类目</dt><dd id="catalog-current-category">—</dd></div>
        
        <div class="catalog-current-field"><dt>任务名称</dt><dd id="catalog-current-name">—</dd></div>
        
        
        
        <div class="catalog-current-field"><dt>目标数量</dt><dd id="catalog-current-target">0</dd></div>
        <div class="catalog-current-field"><dt>已采集（去重）</dt><dd id="catalog-live-unique-count">0</dd></div>
        <div class="catalog-current-field"><dt>剩余数量</dt><dd id="catalog-current-remaining">0</dd></div>
        <div class="catalog-current-field"><dt>任务状态</dt><dd id="catalog-current-status">—</dd></div>
        <div class="catalog-current-field"><dt>页面绑定</dt><dd id="catalog-current-binding">等待页面绑定</dd></div>
      </dl>
      <details><summary>任务技术信息（配置版本、ID、基线）</summary><dl class="catalog-current-grid"><div class="catalog-current-field"><dt>Profile</dt><dd id="catalog-current-profile">—</dd></div><div class="catalog-current-field"><dt>Campaign ID（诊断）</dt><dd id="catalog-current-campaign-id">—</dd></div><div class="catalog-current-field"><dt>Active Pool</dt><dd id="catalog-active-pool-id">—</dd></div><div class="catalog-current-field"><dt>Baseline</dt><dd id="catalog-current-baseline">0</dd></div></dl></details>
      <div id="catalog-initial-actions" class="catalog-initial-actions" hidden>
        <p id="catalog-quantity-mode" class="catalog-quantity-mode">采集数量：不限数量</p>
        <p id="catalog-qa-status" class="catalog-qa-status">QA：NOT_RUN</p>
        <button id="catalog-run-initial-qa" class="catalog-qa-button" type="button">检查首批商品质量</button>
        <button id="catalog-activate-initial-pool" class="catalog-activate-button primary" type="button" disabled>建立首个商品池</button>
      </div>
      <div id="catalog-activation-result" class="catalog-activation-result" hidden></div>
      <div class="catalog-export-actions"><button id="catalog-export-preview" type="button">导出当前采集预览</button>
        <button id="catalog-export-formal" type="button">导出正式商品池</button><span id="catalog-export-result"></span><button id="catalog-open-export-folder" type="button" hidden>打开导出目录</button><span id="catalog-export-folder-status" role="status"></span></div>
    </section>
  <div class="catalog-export-actions"><label>已有导出 <select id="catalog-image-export-history"><option value="">正在读取…</option></select></label><button id="catalog-choose-image-folder" type="button">选择图片下载目录</button><span id="catalog-image-destination">默认保存到 Excel 导出目录的独立子文件夹</span><button id="catalog-open-images" type="button" disabled>打开图片目录</button><button id="catalog-export-images" type="button" disabled>下载 JPG 图片（本机下载）</button><p id="catalog-image-download-status" role="status" aria-live="polite" style="overflow-wrap:anywhere"></p><span>可选择已有导出下载图片，无需重复导出。图片文件夹不是1688候选图片缓存目录。</span></div>
  </section>`;}

export function mountCatalogPanel({root,pollIntervalMs=1500,fetchImpl=globalThis.fetch,scheduler=globalThis,api=null,
  randomUUID=defaultRandomUUID,openWindow=url=>globalThis.open?.(url,'_blank','noopener'),confirmAction=message=>globalThis.confirm?.(message)===true}={}){
  if(!root||typeof root!=='object')throw coded('CATALOG_ROOT_REQUIRED','缺少 Catalog mount root。');
  const existing=mounts.get(root);if(existing)return existing;
  root.innerHTML=catalogPanelMarkup();
  const container=root.querySelector('#catalog-panel');
  const heading=container.querySelector('.catalog-heading');
  heading.querySelector('h2').textContent='1. 选择采集类目';
  const flow=document.createElement('p');flow.textContent='选类目 → 新建或继续任务 → 在 Temu 插件采集 → 查看进度 → 预览入池';flow.style.cssText='padding:12px;background:#ecf5ff;color:#245c94;border-radius:6px';heading.after(flow);
  const current=root.querySelector('#catalog-current-campaign');flow.after(current);
  const exports=document.createElement('details');exports.innerHTML='<summary>导出与下载（备份、分享时使用）</summary><p>1688 一键找货会自动准备图片，无需先导出 Excel 或下载 JPG。</p>';
  container.querySelectorAll('.catalog-export-actions').forEach(node=>exports.append(node));container.append(exports);
  const create=document.createElement('section');create.id='catalog-new-task-entry';create.innerHTML='<h3>2. 新建采集任务</h3>';flow.after(create);
  const form=root.querySelector('#catalog-create-form');
  const category=root.querySelector('#catalog-category-select').closest('label'),count=root.querySelector('#catalog-active-pool-count').closest('label');
  const poolBar=document.createElement('div');poolBar.className='catalog-form';poolBar.append(category,count);flow.before(poolBar);
  const guide=document.createElement('section');guide.innerHTML='<h3>3. 在 Temu 插件中检测、绑定并采集</h3>';
  for(const id of ['catalog-quick-category','catalog-add-category','catalog-manual-bind-steps','catalog-onboarding'])guide.append(root.querySelector('#'+id));create.append(form,guide);
  const help=root.querySelector('#catalog-supplement-help');form.before(help);const resumeLink=container.querySelector('a[href="#existing-task-entry"]');if(resumeLink)create.querySelector("h3").after(resumeLink.parentElement);
  container.querySelectorAll(':scope > p.catalog-hint').forEach(p=>p.hidden=true);
  const name=root.querySelector('#catalog-campaign-name');name.required=false;name.placeholder='可留空，自动命名';
  form.addEventListener('submit',()=>{if(!name.value.trim())name.value=root.querySelector('#catalog-category-select').value+' 新商品 '+new Date().toLocaleString('zh-CN');},true);
  const next=document.createElement('button');next.type='button';next.textContent='去1688找货';next.style.cssText='background:#409eff;color:white;border:0;border-radius:5px;padding:10px 18px';next.id='catalog-next-sourcing';next.textContent='入池后需要找货？去1688一键找货 →';next.style.cssText='background:transparent;color:#409eff;border:0;text-decoration:underline;padding:8px 0';container.append(next);
  next.onclick=async()=>{next.disabled=true;try{const data=await (await fetch('/api/sourcing/pools')).json();const key=root.querySelector('#catalog-category-select').value;const pool=data.pools.find(p=>p.category_key===key&&p.status==='active');if(!pool)throw Error('该类目还没有正式商品池，请先预览并入池');const response=await fetch('/api/sourcing/automation/switch-pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({poolId:pool.id})});const value=await response.json();if(!response.ok)throw Error(value.error?.message||'无法切换商品池');location.hash='sourcing';}catch(e){const status=root.querySelector('#catalog-error');status.hidden=false;status.textContent=e.message;}finally{next.disabled=false;}};

  const catalogState=createCatalogState(),catalogApi=api??createCatalogApi({fetchImpl});
  patchCatalogState(catalogState,{mounted:true});
  const entryRequests=new Map();let mutationVersion=0;
  let pauseBusy=false,pauseFeedback='';const pauseRequests=new Map();
  let probeBusy=false;const probeRequests=new Map();
  const elements=collectElements(root);let active=true,refreshPromise=null,catalogPollingTimer=null,
    profileRequestId=null,initialCampaignRequestId=null,lastContextKey=null;
  function render(){renderCatalogPanel({root,elements,state:catalogState});document.dispatchEvent(new CustomEvent('catalog-category-selected',{detail:elements.category?.value}));
    const pauseButton=root.querySelector?.('#catalog-pause-switch'),current=catalogState.currentCampaign;
    if(pauseButton){pauseButton.hidden=!(current?.campaign_type==='initial'&&['running','manual_required'].includes(current.status));pauseButton.disabled=pauseBusy||!Number.isInteger(current?.claim_generation)||Object.values(catalogState.loading).some(Boolean);pauseButton.textContent=pauseBusy?'正在安全暂停…':'暂停当前首次任务，切换类目';}
    const feedback=root.querySelector?.('#catalog-pause-feedback');if(feedback)feedback.textContent=['running','manual_required'].includes(current?.status)?'':pauseFeedback;
    const p=catalogState.categoryProbe,d=p?.descriptor,summary=root.querySelector?.('#catalog-probe-summary'),button=root.querySelector?.('#catalog-probe-select');
    if(summary)summary.textContent=d?`${d.page_category_name}\n父类目：${d.breadcrumb_parent??''}\n路径：${(d.breadcrumbs??[]).join(' > ')}\n${d.canonical_listing_url??''}\nGermany / English / EUR · ${d.sort_order??''}\n商品卡：${d.dom_goods_count??0}\n识别时间：${d.detected_at??''}\nProfile：${p.resolution}${p.code?' · '+p.code:''}`:'尚未识别';
    if(button){button.disabled=probeBusy||!p||p.resolution==='BLOCKED'||Date.parse(p.expires_at)<=Date.now();button.textContent=probeBusy?'处理中…':p?.resolution==='NEW'?'注册并选择当前类目':'选择当前类目';}}
  function setError(error){patchCatalogState(catalogState,{error:{code:error.code??'OPERATION_FAILED',message:operatorErrorMessage(error)}});render();}
  function updateSelection(){
    const profile=catalogState.profiles.find(row=>row.category_key===elements.category?.value
      && row.category_profile_version===elements.profile?.value)??null;
    patchCatalogState(catalogState,{selectedProfile:profile,error:null});render();
  }
  function applyRemote(profiles,current){
    const rows=profiles??[],effectiveCurrent=current??(catalogState.activation?catalogState.currentCampaign:null),selected=catalogState.selectedProfile,
      preferred=selected?rows.find(row=>row.category_key===selected.category_key&&row.category_profile_version===selected.category_profile_version)
      :effectiveCurrent?rows.find(row=>row.category_key===effectiveCurrent.category_key&&row.category_profile_version===effectiveCurrent.category_profile_version):null;
    patchCatalogState(catalogState,{profiles:rows,selectedProfile:preferred??rows[0]??null,currentCampaign:effectiveCurrent??null,
      currentPool:effectiveCurrent?.pool_version_id??catalogState.activation?.pool_version_id??preferred?.active_pool_version_id??null,quantityPolicy:effectiveCurrent?{
        quantityMode:effectiveCurrent.quantity_mode??'TARGETED',targetCount:effectiveCurrent.target_count??null,
        remaining:effectiveCurrent.remaining??null,targetReached:effectiveCurrent.target_reached??null
      }:null,initialQa:current?.qa??null,lastRefreshedAt:new Date().toISOString()});
  }
  async function refresh({silent=false}={}){
    if(!active)throw coded('CATALOG_PANEL_NOT_MOUNTED','Catalog panel 已卸载。');
    if(refreshPromise)return refreshPromise;
    refreshPromise=(async()=>{
      if(silent)patchCatalogState(catalogState,{error:null});
      else{patchCatalogState(catalogState,{loading:{...catalogState.loading,profiles:true,current:true},error:null});render();}
      try{
        const readVersion=mutationVersion;
        const [profiles,current,blockers,probeResult]=await Promise.all([catalogApi.listProfiles(),catalogApi.currentCampaign(),catalogApi.listClaimBlockers?.()??{primary_blocker:null,all_blockers:[]},catalogApi.currentProbe?.()??{probe:null}]);
        if(!active||readVersion!==mutationVersion)return snapshotCatalogState(catalogState);
        const campaign=current.current??null;
        applyRemote(profiles.profiles??[],campaign);
        if(!probeBusy)patchCatalogState(catalogState,{categoryProbe:probeResult.probe??null});
        const historicalBlockers=(blockers.all_blockers??[]).filter(row=>row.campaignId!==campaign?.campaign_id);
        patchCatalogState(catalogState,{claimRecovery:{...catalogState.claimRecovery,primaryBlocker:historicalBlockers[0]??null,allBlockers:historicalBlockers}});
        emitContextIfChanged(root,campaign,context=>{if(context!==lastContextKey){lastContextKey=context;return true;}return false;});
      }catch(error){patchCatalogState(catalogState,{error:{code:error.code??'OPERATION_FAILED',message:operatorErrorMessage(error)}});}
      finally{if(!silent)patchCatalogState(catalogState,{loading:{...catalogState.loading,profiles:false,current:false}});render();refreshPromise=null;}
      return snapshotCatalogState(catalogState);
    })();
    return refreshPromise;
  }
  const controller={
    refresh,
    getState(){return snapshotCatalogState(catalogState);},
    destroy(){if(!active)return;active=false;if(catalogPollingTimer!==null)scheduler.clearInterval(catalogPollingTimer);
      catalogPollingTimer=null;patchCatalogState(catalogState,{mounted:false});root.replaceChildren();mounts.delete(root);
      if(currentController===controller)currentController=null;}
  };
  root.querySelector?.('#catalog-pause-switch')?.addEventListener('click',async()=>{
    const c=catalogState.currentCampaign;
    if(pauseBusy||c?.campaign_type!=='initial'||!['running','manual_required'].includes(c.status)||!Number.isInteger(c.claim_generation)||Object.values(catalogState.loading).some(Boolean))return;
    if(!confirmAction(`暂停 ${c.category_key} 的当前首次任务？已采集商品和进度会保留，旧绑定失效。切换后需手工重新检测和绑定，不会自动开始新任务。`))return;
    pauseBusy=true;mutationVersion+=1;const key=JSON.stringify([c.campaign_id,c.queue_id,c.claim_generation]);
    if(!pauseRequests.has(key))pauseRequests.set(key,randomUUID());render();
    try{
      await catalogApi.pauseInitial(c.campaign_id,{campaign_id:c.campaign_id,category_key:c.category_key,category_profile_version:c.category_profile_version,queue_id:c.queue_id,expected_claim_generation:c.claim_generation,request_id:pauseRequests.get(key)});
      if(!active)return;
      mutationVersion+=1;catalogState.error=null;patchCatalogState(catalogState,{currentCampaign:null,error:null});
      pauseFeedback='已暂停，商品和进度已保留。请选择目标类目，再点击开始或继续首次采集；返回原类目可继续原任务。';
      if(refreshPromise)await refreshPromise;
      await refresh();
    }catch(error){if(active)setError(error);}
    finally{pauseBusy=false;if(active)render();}
  });
  root.querySelector?.('#catalog-probe-select')?.addEventListener('click',async()=>{
    const p=catalogState.categoryProbe;if(probeBusy||!p||p.resolution==='BLOCKED'||Date.parse(p.expires_at)<=Date.now())return;
    probeBusy=true;render();try{
      let profile=p.profile;
      if(p.resolution==='NEW'){
        if(!probeRequests.has(p.probe_id))probeRequests.set(p.probe_id,randomUUID());
        const result=await catalogApi.registerProbe(p.probe_id,{probe_id:p.probe_id,descriptor_fingerprint:p.descriptor_fingerprint,request_id:probeRequests.get(p.probe_id)});profile=result.profile;
      }
      const result=await catalogApi.listProfiles();if(!active)return;
      const exact=result.profiles.find(row=>row.category_key===profile?.category_key&&row.category_profile_version===profile?.category_profile_version);
      if(!exact)throw coded('CATEGORY_PROFILE_CONFLICT','识别的 Profile 已变化，请重新识别。');
      patchCatalogState(catalogState,{profiles:result.profiles,selectedProfile:exact,error:null});
    }catch(error){setError(error);}finally{probeBusy=false;if(active)render();}
  });
  bindCatalogHandlers({root,elements,state:catalogState,api:catalogApi,randomUUID,render,setError,updateSelection,
    openWindow,confirmAction,entryRequests,beginEntryMutation:()=>{mutationVersion+=1;},isActive:()=>active,
    getProfileRequestId:()=>profileRequestId,setProfileRequestId:value=>{profileRequestId=value;},
    getInitialCampaignRequestId:()=>initialCampaignRequestId,setInitialCampaignRequestId:value=>{initialCampaignRequestId=value;},applyRemote,refresh});
  mounts.set(root,controller);currentController=controller;
  void refresh();catalogPollingTimer=scheduler.setInterval(()=>{void refresh({silent:true});},Number(pollIntervalMs));
  return controller;
}

export async function refreshCatalogPanel(){
  if(!currentController)throw coded('CATALOG_PANEL_NOT_MOUNTED','Catalog panel 尚未挂载。');
  return currentController.refresh();
}

function coded(code,message){const error=new Error(message);error.code=code;return error;}

function collectElements(root){
  if(typeof root.querySelector!=='function')return{};
  const byId=id=>root.querySelector(`#catalog-${id}`);
  return{category:byId('category-select'),profile:byId('profile-select'),requested:byId('requested-new'),requestedField:byId('requested-new-field'),
    targetField:byId('target-field'),calculatedTarget:byId('calculated-target'),campaignName:byId('campaign-name'),form:byId('create-form'),
    create:byId('create-campaign'),activePoolCount:byId('active-pool-count'),loading:byId('loading'),error:byId('error'),
    current:byId('current-campaign'),currentCategory:byId('current-category'),currentProfile:byId('current-profile'),currentName:byId('current-name'),
    currentId:byId('current-campaign-id'),activePoolId:byId('active-pool-id'),baseline:byId('current-baseline'),target:byId('current-target'),
    unique:byId('live-unique-count'),remaining:byId('current-remaining'),status:byId('current-status'),binding:byId('current-binding'),
    initialActions:byId('initial-actions'),quantityMode:byId('quantity-mode'),qaStatus:byId('qa-status'),qa:byId('run-initial-qa'),
    activate:byId('activate-initial-pool'),activationResult:byId('activation-result'),addCategory:byId('add-category'),
    onboarding:byId('onboarding'),onboardingForm:byId('onboarding-form'),onboardingDisplayName:byId('onboarding-display-name'),
    onboardingPageCategory:byId('onboarding-page-category'),onboardingAliases:byId('onboarding-aliases'),onboardingParent:byId('onboarding-parent'),
    onboardingBreadcrumbs:byId('onboarding-breadcrumbs'),onboardingListingUrl:byId('onboarding-listing-url'),
    onboardingValidate:byId('onboarding-validate'),onboardingValidation:byId('onboarding-validation'),
    onboardingCategoryKey:byId('onboarding-category-key'),onboardingProfileVersion:byId('onboarding-profile-version'),
    onboardingCapabilities:byId('onboarding-capabilities'),onboardingOpenListing:byId('onboarding-open-listing'),
    onboardingCampaignName:byId('onboarding-campaign-name'),onboardingSaveCreate:byId('onboarding-save-create'),
    claimBlockers:byId('claim-blockers'),claimBlockerList:byId('claim-blocker-list'),inspectClaim:byId('inspect-claim'),endStaleClaim:byId('end-stale-claim'),exportPreview:byId('export-preview'),exportFormal:byId('export-formal'),exportResult:byId('export-result')};
}

function bindCatalogHandlers(context){const {elements}=context;if(!elements.form)return;
  elements.category.addEventListener('change',()=>{renderProfileOptions(context);context.updateSelection();});
  elements.profile.addEventListener('change',context.updateSelection);
  elements.requested.addEventListener('input',()=>context.render());
  elements.form.addEventListener('submit',event=>createCampaign(event,context));
  elements.qa.addEventListener('click',()=>runQa(context));elements.activate.addEventListener('click',()=>activatePool(context));
  elements.addCategory.addEventListener('click',()=>{patchCatalogState(context.state,{onboarding:{...context.state.onboarding,
    open:!context.state.onboarding.open}});context.render();});
  elements.onboardingForm.addEventListener('submit',event=>validateOnboarding(event,context));
  elements.onboardingOpenListing.addEventListener('click',()=>openOnboardingListing(context));
  elements.onboardingSaveCreate.addEventListener('click',()=>saveAndCreateInitial(context));
  elements.exportPreview.addEventListener('click',()=>exportCurrent('preview',context));
  elements.exportFormal.addEventListener('click',()=>exportCurrent('formal',context));
  const imagesButton=context.root.querySelector('#catalog-export-images');
  const history=context.root.querySelector('#catalog-image-export-history');
  const selectHistory=()=>{imagesButton.dataset.file=history.value;imagesButton.disabled=!history.value;};history.addEventListener('change',selectHistory);
  context.api.imageExportHistory().then(r=>{if(imagesButton.dataset.file)return;history.replaceChildren();for(const row of r.files){const option=document.createElement('option');option.value=row.file_name;option.textContent=row.modified_at.replace('T',' ').slice(0,19)+' · '+row.product_count+' 件 · '+row.file_name;history.append(option);}if(!r.files.length){const o=document.createElement('option');o.value='';o.textContent='暂无可用记录，请先导出一次';history.append(o);}selectHistory();}).catch(e=>{history.replaceChildren();context.root.querySelector('#catalog-image-download-status').textContent='读取已有导出失败：'+e.message;});
  const choose=context.root.querySelector('#catalog-choose-image-folder'),open=context.root.querySelector('#catalog-open-images'),destination=context.root.querySelector('#catalog-image-destination');
  choose.addEventListener('click',async()=>{choose.disabled=true;try{const r=(await context.api.chooseImageFolder()).result;if(!r.cancelled)destination.textContent='保存位置：'+r.path+'（每次下载建立独立子文件夹）';}catch(e){destination.textContent=e.message;}finally{choose.disabled=false;}});
  open.addEventListener('click',async()=>{try{await context.api.openImageFolder();}catch(e){context.root.querySelector('#catalog-image-download-status').textContent=e.message;}});
  imagesButton.addEventListener('click',async()=>{if(imagesButton.disabled)return;imagesButton.disabled=true;choose.disabled=true;const status=context.root.querySelector('#catalog-image-download-status');status.textContent='正在下载商品图片，请保持页面打开。完成后这里会显示成功和失败数量。';imagesButton.textContent='正在下载，请稍候…';try{const response=await context.api.exportImages({file_name:imagesButton.dataset.file});const r=response.result;open.disabled=false;status.textContent='下载完成：成功 '+r.saved+' 件，失败 '+r.failed+' 件。目录：'+r.folder;}catch(e){status.textContent='图片导出失败：'+e.message;}finally{imagesButton.disabled=false;choose.disabled=false;imagesButton.textContent='下载商品图片到文件夹（本机下载）';}});
  const folderButton=context.root.querySelector('#catalog-open-export-folder');
  folderButton.addEventListener('click',async()=>{
    if(folderButton.hidden||folderButton.disabled)return;folderButton.disabled=true;
    const status=context.root.querySelector('#catalog-export-folder-status');status.textContent='正在打开…';
    try{await context.api.openExportFolder();status.textContent='已打开目录 ✓';}catch(error){status.textContent='打开失败';context.setError(error);}finally{folderButton.disabled=false;}
  });
  elements.inspectClaim.addEventListener('click',()=>inspectClaim(context));elements.endStaleClaim.addEventListener('click',()=>endStaleClaim(context));
}

async function exportCurrent(kind,context){const {state,api}=context,current=state.currentCampaign;if(!current)return;
  patchCatalogState(state,{loading:{...state.loading,export:true},error:null});context.render();
  try{const body={category_key:current.category_key,category_profile_version:current.category_profile_version};
    const response=kind==='preview'?await api.exportInitialPreview(current.campaign_id,{...body,campaign_id:current.campaign_id,
      candidate_revision:current.candidate_revision}):await api.exportFormalPool(current.pool_version_id??state.currentPool,body);
    context.elements.exportResult.textContent=`已导出：${response.result?.file_name??''}`;
    context.root.querySelector('#catalog-open-export-folder').hidden=false;const imageButton=context.root.querySelector('#catalog-export-images');imageButton.hidden=false;imageButton.disabled=false;imageButton.dataset.file=response.result.file_name;const history=context.root.querySelector('#catalog-image-export-history');const option=document.createElement('option');option.value=response.result.file_name;option.textContent=response.result.file_name;history.prepend(option);history.value=option.value;
  }catch(error){context.setError(error);}
  finally{patchCatalogState(state,{loading:{...state.loading,export:false}});context.render();}
}

async function validateOnboarding(event,context){event.preventDefault();const {state,api,elements}=context;
  patchCatalogState(state,{loading:{...state.loading,onboardingValidate:true},error:null});context.render();
  try{const draft=buildOperatorCategoryDraft({displayName:elements.onboardingDisplayName.value,
      pageCategoryName:elements.onboardingPageCategory.value,aliases:elements.onboardingAliases.value,
      parentCategory:elements.onboardingParent.value,breadcrumbs:elements.onboardingBreadcrumbs.value,
      listingUrl:elements.onboardingListingUrl.value});
    const response=await api.validateOperatorProfile(draft);patchCatalogState(state,{onboarding:{...state.onboarding,draft,
      validation:response.profile,registered:null,profileSaved:false,campaignCreated:false}});
  }catch(error){context.setError(error);}
  finally{patchCatalogState(state,{loading:{...state.loading,onboardingValidate:false}});context.render();}
}
function openOnboardingListing(context){const url=context.state.onboarding.validation?.listing_url;
  if(!url)throw coded('CATEGORY_PROFILE_NOT_VALIDATED','请先检查并继续。');context.openWindow(url);}

async function saveAndCreateInitial(context){const {state,api,elements}=context;let registered=state.onboarding.registered;
  if(!state.onboarding.validation||!state.onboarding.draft)return context.setError(coded('CATEGORY_PROFILE_NOT_VALIDATED','请先检查并继续。'));
  patchCatalogState(state,{loading:{...state.loading,onboardingSave:true},error:null});context.render();
  try{
    if(!state.onboarding.profileSaved){let requestId=context.getProfileRequestId();if(!requestId){requestId=createRequestIdentity({randomUUID:context.randomUUID});context.setProfileRequestId(requestId);}
      const response=await api.registerOperatorProfile({request_id:requestId,...state.onboarding.draft});registered=response.profile;
      patchCatalogState(state,{onboarding:{...state.onboarding,registered,profileSaved:true,campaignCreated:false,campaignErrorCode:null}});
    }
    const profilesResponse=await api.listProfiles(),profiles=profilesResponse.profiles??[];
    const selected=profiles.find(row=>row.category_key===registered.category_key&&row.category_profile_version===registered.category_profile_version);
    if(!selected)throw coded('CATEGORY_PROFILE_NOT_FOUND','保存后的 Category Profile 未出现在 Registry。');
    patchCatalogState(state,{profiles,selectedProfile:selected});
    let campaignRequestId=context.getInitialCampaignRequestId();if(!campaignRequestId){campaignRequestId=createRequestIdentity({randomUUID:context.randomUUID});context.setInitialCampaignRequestId(campaignRequestId);}
    const body=buildInitialCreatePayload({profile:selected,campaignName:elements.onboardingCampaignName.value,requestId:campaignRequestId});
    const response=await api.createInitial(body),current=response.result;
    if(current?.campaign_id)state.error=null;
    patchCatalogState(state,{currentCampaign:current,currentPool:null,initialQa:current?.qa??null,
      onboarding:{...state.onboarding,registered,profileSaved:true,campaignCreated:true,campaignErrorCode:null}});
  }catch(error){if(state.onboarding.profileSaved){patchCatalogState(state,{onboarding:{...state.onboarding,campaignCreated:false,
      campaignErrorCode:error.code??'OPERATION_FAILED'},error:{code:'PROFILE_SAVED_CAMPAIGN_NOT_CREATED',
      message:`${operatorErrorMessage({code:'PROFILE_SAVED_CAMPAIGN_NOT_CREATED'})}\n${operatorErrorMessage(error)}`}});context.render();}
    else context.setError(error);
  }finally{patchCatalogState(state,{loading:{...state.loading,onboardingSave:false}});context.render();}
}

async function createCampaign(event,context){event.preventDefault();const {state,api,elements}=context;
  if(state.loading.create)return;
  const selected=state.selectedProfile,selectionKey=identityKey(selected),entry=operatorEntry(selected);
  if(!entry.available||entry.action==='BLOCKED')return context.setError(coded(entry.code??'INITIAL_CAMPAIGN_NOT_CONTINUABLE','当前类目状态不允许开始或继续采集。'));
  const stillSelected=()=>context.isActive()&&identityKey(state.selectedProfile)===selectionKey;
  context.beginEntryMutation();
  patchCatalogState(state,{loading:{...state.loading,create:true},error:null});context.render();
  try{const profile=state.selectedProfile;if(!profile)throw coded('CATEGORY_PROFILE_NOT_FOUND','找不到所选 Category Profile。');
    const requestKey=JSON.stringify([selectionKey,entry.action,entry.campaign_id,entry.action==='CONTINUE_INITIAL'?null:elements.campaignName.value.trim(),entry.action==='EXPANSION'?Number(elements.requested.value):null]);
    let requestId=context.entryRequests.get(requestKey);if(!requestId){requestId=createRequestIdentity({randomUUID:context.randomUUID});context.entryRequests.set(requestKey,requestId);}
    const body=entry.action==='CONTINUE_INITIAL'?buildInitialContinuePayload({profile,campaignId:entry.campaign_id,requestId})
      :entry.action==='START_INITIAL'?buildInitialCreatePayload({profile,campaignName:elements.campaignName.value,requestId})
      :buildCreatePayload({profile,requestedNewCount:Number(elements.requested.value),campaignName:elements.campaignName.value,requestId});
    const response=entry.action==='CONTINUE_INITIAL'?await api.continueInitial(entry.campaign_id,body):entry.action==='START_INITIAL'?await api.createInitial(body):await api.createExpansion(body),current=response.result??null;
    context.entryRequests.delete(requestKey);
    if(!stillSelected())return;
    if(current?.campaign_id)state.error=null;
    patchCatalogState(state,{currentCampaign:current,currentPool:current?.pool_version_id??null,initialQa:current?.qa??null});
    if(entry.action==='START_INITIAL'&&current?.campaign_id){const next={...profile,entry:{...entry,action:'CONTINUE_INITIAL',campaign_id:current.campaign_id}};
      patchCatalogState(state,{selectedProfile:next,profiles:state.profiles.map(row=>row===profile?next:row)});}
    emitCatalogIdentity(context.root,'catalog:context-changed',current??{});
  }catch(error){if(stillSelected())context.setError(error);}
  finally{patchCatalogState(state,{loading:{...state.loading,create:false}});context.render();}
}

async function runQa(context){const {state,api}=context,current=state.currentCampaign;
  if(!current)return;patchCatalogState(state,{loading:{...state.loading,qa:true},error:null});context.render();
  try{const profile=findCurrentProfile(state,current),body=buildInitialQaPayload({campaignId:current.campaign_id,profile,
      requestId:createRequestIdentity({randomUUID:context.randomUUID})});
    const response=await api.runInitialQa(current.campaign_id,body),next=response.result??current;
    patchCatalogState(state,{currentCampaign:next,initialQa:next.qa??state.initialQa});
  }catch(error){context.setError(error);}
  finally{patchCatalogState(state,{loading:{...state.loading,qa:false}});context.render();}
}

async function activatePool(context){const {state,api}=context,current=state.currentCampaign;if(!current)return;
  patchCatalogState(state,{loading:{...state.loading,activation:true},error:null});context.render();
  try{const profile=findCurrentProfile(state,current),body=buildInitialActivationPayload({campaignId:current.campaign_id,profile,
      requestId:createRequestIdentity({randomUUID:context.randomUUID})}),response=await api.activateInitial(current.campaign_id,body),result=response.result;
    patchCatalogState(state,{activation:result});emitCatalogIdentity(context.root,'catalog:pool-activated',{
      ...current,pool_version_id:result?.pool_version_id??null});
    const [profiles,currentResponse]=await Promise.all([api.listProfiles(),api.currentCampaign()]);
    context.applyRemote(profiles.profiles??[],currentResponse.current??null);
  }catch(error){context.setError(error);}
  finally{patchCatalogState(state,{loading:{...state.loading,activation:false}});context.render();}
}

function renderCatalogPanel({root,elements,state}){if(!elements.form)return;
  renderCategoryOptions({root,elements,state});renderProfileOptions({root,elements,state});
  const profile=state.selectedProfile,entry=operatorEntry(profile),initial=['START_INITIAL','CONTINUE_INITIAL'].includes(entry.action);
  elements.activePoolCount.textContent=formatNumber(profile?.active_pool_count);elements.requestedField.hidden=Boolean(initial);
  elements.targetField.hidden=Boolean(initial);elements.requested.required=!initial;
  const supplement=entry.action==='EXPANSION';
  const help=root.querySelector('#catalog-supplement-help');if(help){help.hidden=!supplement;help.textContent='已有正式池 '+formatNumber(profile?.active_pool_count)+' 件。填写本次新增目标和新任务名称，点击“新建补充采集任务”（新开一批，不会接着旧任务），然后回 Temu 插件检测、绑定并开始。池内已有商品不计入新增目标；本次采集不自动更新正式池。';}
  if(supplement&&elements.requested.dataset.supplementDefault!=='set'){if(!elements.requested.value)elements.requested.value='300';elements.requested.dataset.supplementDefault='set';}
  const target=calculateTarget(profile,Number(elements.requested.value));elements.calculatedTarget.textContent=target===null?'—':formatNumber(target);
  elements.campaignName.required=false;elements.campaignName.disabled=entry.action==='CONTINUE_INITIAL';
  elements.create.textContent=({START_INITIAL:'开始首次采集',CONTINUE_INITIAL:'继续首次采集',EXPANSION:'新建补充采集任务',BLOCKED:'当前类目不可采集'})[entry.action];
  elements.create.disabled=state.loading.create||!entry.available;
  const busy=Object.values(state.loading).some(Boolean);elements.loading.hidden=!busy;
  elements.error.hidden=!state.error;elements.error.textContent=state.error?.message??'';
  renderClaimBlockers(elements,state);renderOnboarding(elements,state);
  renderCurrent(elements,state);
}
function renderClaimBlockers(elements,state){const recovery=state.claimRecovery,rows=recovery.allBlockers??[];elements.claimBlockers.hidden=!rows.length;elements.claimBlockerList.textContent=rows.map((row,index)=>`${index===0?'Primary blocker':'Blocker'}\nCampaign ID: ${row.campaignId}\nCategory: ${row.categoryKey}\nType: ${row.campaignType??'-'}\nCampaign status: ${row.campaignStatus}\nQueue status: ${row.queueStatus}\nRunner status: ${row.checkpoint?.runner_state??'-'}\nLast activity: ${row.heartbeatAt??row.queueUpdatedAt??'-'}\nLive worker: ${row.liveWorker??'UNKNOWN'}\nLive binding: ${row.liveBinding??'UNKNOWN'}\nStale determination: ${row.staleDetermination}`).join('\n\n');const confirmed=recovery.secondInspection?.determination==='STALE_CONFIRMED'||recovery.primaryBlocker?.staleDetermination==='STALE_CONFIRMED';elements.inspectClaim.disabled=!recovery.primaryBlocker||state.loading.claim;elements.endStaleClaim.disabled=!confirmed||state.loading.claim;}

async function inspectClaim(context){const {state,api}=context,blocker=state.claimRecovery.primaryBlocker;if(!blocker)return;patchCatalogState(state,{loading:{...state.loading,claim:true},error:null});context.render();try{const first=state.claimRecovery.firstInspection,response=await api.inspectClaim(blocker.campaignId,{previous_inspection_id:first?.id??first?.inspectionId??null}),inspection=response.result??response;patchCatalogState(state,{claimRecovery:{...state.claimRecovery,firstInspection:first??inspection,secondInspection:first?inspection:null}});}catch(error){context.setError(error);}finally{patchCatalogState(state,{loading:{...state.loading,claim:false}});context.render();}}
async function endStaleClaim(context){const {state,api}=context,blocker=state.claimRecovery.primaryBlocker,first=state.claimRecovery.firstInspection,second=state.claimRecovery.secondInspection;if(!blocker)return;if(!context.confirmAction('该操作会把历史 Campaign 标记为 cancelled，不会删除商品、Pool、Snapshot，也不会恢复旧任务。'))return;patchCatalogState(state,{loading:{...state.loading,claim:true},error:null});context.render();try{await api.endStaleClaim(blocker.campaignId,{queue_id:blocker.queueId,source_id:blocker.sourceId,first_inspection_id:first?.id??first?.inspectionId,second_inspection_id:second?.id??second?.inspectionId,expected_claim_token:blocker.claimToken,expected_claim_generation:blocker.claimGeneration,request_id:context.randomUUID(),operator_confirmation:'END_STALE_CLAIM'});patchCatalogState(state,{claimRecovery:{primaryBlocker:null,allBlockers:[],firstInspection:null,secondInspection:null}});await context.refresh({silent:true});}catch(error){context.setError(error);}finally{patchCatalogState(state,{loading:{...state.loading,claim:false}});context.render();}}

function renderOnboarding(elements,state){const onboarding=state.onboarding,profile=onboarding.validation;
  elements.onboarding.hidden=!onboarding.open;elements.onboardingValidation.hidden=!profile;
  elements.onboardingValidate.disabled=state.loading.onboardingValidate;
  elements.onboardingCategoryKey.textContent=profile?.category_key??'—';elements.onboardingProfileVersion.textContent=profile?.category_profile_version??'—';
  elements.onboardingCapabilities.textContent=profile
    ?'Raw Capture：READY · Initial Pool：READY · Classification：BLOCKED · Opportunity：BLOCKED':'—';
  elements.onboardingOpenListing.disabled=!profile;
  elements.onboardingSaveCreate.disabled=!profile||state.loading.onboardingSave;
  elements.onboardingSaveCreate.textContent=onboarding.profileSaved&&!onboarding.campaignCreated?'重试创建首次采集任务':'保存并创建首次采集任务';
}

function renderCategoryOptions({root,elements,state}){const values=[...new Set(state.profiles.map(row=>row.category_key))],previous=elements.category.value;
  replaceOptions(root,elements.category,values.map(value=>({value,label:value})));if(values.includes(previous))elements.category.value=previous;
  if(state.selectedProfile&&values.includes(state.selectedProfile.category_key))elements.category.value=state.selectedProfile.category_key;
}
function renderProfileOptions({root,elements,state}){const rows=state.profiles.filter(row=>row.category_key===elements.category.value),previous=elements.profile.value;
  replaceOptions(root,elements.profile,rows.map(row=>({value:row.category_profile_version,label:`${row.category_profile_version}${operatorEntry(row).available?'':'（不可用）'}`,
    disabled:false})));if(rows.some(row=>row.category_profile_version===previous))elements.profile.value=previous;
  if(state.selectedProfile&&rows.includes(state.selectedProfile))elements.profile.value=state.selectedProfile.category_profile_version;
}
function replaceOptions(root,select,rows){if(!select||!root.ownerDocument?.createElement)return;const options=rows.map(row=>{const option=root.ownerDocument.createElement('option');
  option.value=row.value;option.textContent=row.label;option.disabled=Boolean(row.disabled);return option;});select.replaceChildren(...options);}
function renderCurrent(elements,state){const current=state.currentCampaign;elements.current.hidden=!current;if(!current)return;
  elements.currentCategory.textContent=current.category_key??'—';elements.currentProfile.textContent=current.category_profile_version??'—';
  elements.currentName.textContent=current.campaign_name??'—';elements.currentId.textContent=current.campaign_id??'—';
  elements.activePoolId.textContent=current.pool_version_id??state.activation?.pool_version_id??'—';elements.baseline.textContent=formatNumber(current.baseline_count);
  const initial=current.campaign_type==='initial';elements.target.textContent=current.quantity_mode==='OPEN_ENDED'?'不限数量':formatNumber(current.target_count);
  elements.unique.textContent=formatNumber(current.current_unique);elements.remaining.textContent=current.quantity_mode==='OPEN_ENDED'?'—':formatNumber(current.remaining);
  elements.status.textContent=current.status??'—';elements.binding.textContent=current.binding_status==='UNBOUND'?'等待页面绑定 · UNBOUND':current.binding_status??'—';
  elements.exportPreview.disabled=!(initial&&Number(current.current_unique)>0)||state.loading.export;
  elements.exportFormal.disabled=!(current.pool_version_id??state.currentPool)||state.loading.export;
  elements.initialActions.hidden=!initial;if(initial){const view=initialOperatorViewModel(current);elements.quantityMode.textContent=`采集数量：不限数量`;
    elements.qaStatus.textContent=`QA：${view.qaStatus} · 覆盖 ${view.qaCandidateCount} · 当前 ${view.currentCount} · 未QA ${view.unreviewedDelta}`;
    elements.qa.disabled=!view.qaEnabled||state.loading.qa||state.loading.activation;elements.activate.disabled=!view.activationEnabled||state.loading.activation;}
  const result=state.activation;elements.activationResult.hidden=!result;elements.activationResult.textContent=result
    ?`首个商品池已建立\nPool Version：${result.pool_version_id}\nCategory：${result.category_key}\nCount：${result.pool_count}\nActivated At：${result.activated_at}\nSource Campaign：${result.source_campaign_id}`:'';
}
function findCurrentProfile(state,current){const profile=state.profiles.find(row=>row.category_key===current.category_key
  && row.category_profile_version===current.category_profile_version);if(!profile)throw coded('CATEGORY_PROFILE_NOT_FOUND','找不到当前 Campaign 对应的 Category Profile。');return profile;}
function emitContextIfChanged(root,value,shouldEmit){const context=identityKey(value);if(shouldEmit(context))emitCatalogIdentity(root,'catalog:context-changed',value??{});}
function emitCatalogIdentity(root,type,value){const CustomEventCtor=root.ownerDocument?.defaultView?.CustomEvent;if(typeof CustomEventCtor!=='function')return;
  const detail=Object.freeze({category_key:value?.category_key??null,category_profile_version:value?.category_profile_version??null,
    campaign_id:value?.campaign_id??null,pool_version_id:value?.pool_version_id??null});
  try{root.dispatchEvent(new CustomEventCtor(type,{detail,bubbles:true}));}catch{/* Events are optional integration hints. */}}
function identityKey(value){return[value?.category_key??'',value?.category_profile_version??'',value?.campaign_id??'',value?.pool_version_id??''].join('|');}
function formatNumber(value){return new Intl.NumberFormat('zh-CN').format(Number(value??0));}
function defaultRandomUUID(){if(typeof globalThis.crypto?.randomUUID!=='function')throw coded('CATALOG_REQUEST_ID_UNAVAILABLE','无法生成创建请求标识。');return globalThis.crypto.randomUUID();}
