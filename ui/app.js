import { buildCreatePayload,buildInitialActivationPayload,buildInitialCreatePayload,buildInitialQaPayload,
  calculateTarget,createRequestIdentity,initialOperatorViewModel,operatorErrorMessage } from './operator-campaign.js';

const $=selector => document.querySelector(selector);
const elements={
  environmentBanner:$('#environmentBanner'),consoleTitle:$('#consoleTitle'),resetTestData:$('#resetTestData'),
  operatorHeaderContext:$('#operatorHeaderContext'),operatorCampaignForm:$('#operatorCampaignForm'),
  operatorCategory:$('#operatorCategory'),operatorProfile:$('#operatorProfile'),operatorMode:$('#operatorMode'),
  operatorActivePool:$('#operatorActivePool'),operatorRequestedNew:$('#operatorRequestedNew'),
  operatorRequestedNewField:$('#operatorRequestedNewField'),operatorCalculatedTargetField:$('#operatorCalculatedTargetField'),
  operatorCalculatedTarget:$('#operatorCalculatedTarget'),operatorCampaignName:$('#operatorCampaignName'),
  createOperatorCampaign:$('#createOperatorCampaign'),operatorCampaignError:$('#operatorCampaignError'),
  operatorCurrentCampaign:$('#operatorCurrentCampaign'),operatorCurrentCategory:$('#operatorCurrentCategory'),
  operatorCurrentName:$('#operatorCurrentName'),operatorCurrentId:$('#operatorCurrentId'),
  operatorCurrentBaseline:$('#operatorCurrentBaseline'),operatorCurrentTarget:$('#operatorCurrentTarget'),
  operatorCurrentUnique:$('#operatorCurrentUnique'),operatorCurrentRemaining:$('#operatorCurrentRemaining'),
  operatorCurrentStatus:$('#operatorCurrentStatus'),operatorCurrentBinding:$('#operatorCurrentBinding'),
  initialPoolActions:$('#initialPoolActions'),initialQuantityMode:$('#initialQuantityMode'),initialQaStatus:$('#initialQaStatus'),
  runInitialQa:$('#runInitialQa'),activateInitialPool:$('#activateInitialPool'),initialActivationResult:$('#initialActivationResult'),
  notice:$('#notice'),browserPulse:$('#browserPulse'),browserStatus:$('#browserStatus'),openBrowser:$('#openBrowser'),newBrowser:$('#newBrowser'),connectExisting:$('#connectExisting'),validatePage:$('#validatePage'),
  pageReadiness:$('#pageReadiness'),browserMode:$('#browserMode'),profileName:$('#profileName'),cdpPort:$('#cdpPort'),healthCountry:$('#healthCountry'),
  healthLanguage:$('#healthLanguage'),healthCurrency:$('#healthCurrency'),loginStatus:$('#loginStatus'),productListVisible:$('#productListVisible'),
  categorySortStatus:$('#categorySortStatus'),pageHealthCode:$('#pageHealthCode'),profileWarning:$('#profileWarning'),diagnosticParams:$('#diagnosticParams'),
  jobStatus:$('#jobStatus'),jobId:$('#jobId'),target:$('#target'),discovered:$('#discovered'),stored:$('#stored'),
  success:$('#success'),failed:$('#failed'),resumeCount:$('#resumeCount'),imageCoverage:$('#imageCoverage'),
  imageCount:$('#imageCount'),checkpoint:$('#checkpoint'),activeProducts:$('#activeProducts'),qualitySummary:$('#qualitySummary'),
  latestExcel:$('#latestExcel'),recentError:$('#recentError'),updatedAt:$('#updatedAt'),jobHistory:$('#jobHistory'),
  events:$('#events'),eventCount:$('#eventCount'),pause:$('#pause'),resume:$('#resume'),cancel:$('#cancel'),
  retry:$('#retry'),sessionRecoveryControls:$('#sessionRecoveryControls'),validateSessionRecovery:$('#validateSessionRecovery'),resumeReviewCapture:$('#resumeReviewCapture'),sessionStatus:$('#sessionStatus'),export:$('#export'),openExcel:$('#openExcel'),clearExcel:$('#clearExcel'),openFolder:$('#openFolder'),toast:$('#toast')
};
const startButtons=[...document.querySelectorAll('[data-start]')];
let state=null,toastTimer,operatorProfiles=[],selectedOperatorProfile=null,operatorRequestId=null,currentOperatorCampaign=null;

async function api(url,options={}) {
  const response=await fetch(url,{ method:options.method ?? 'GET',headers:{ 'Content-Type':'application/json' },body:options.body ? JSON.stringify(options.body) : undefined });
  const payload=await response.json();
  if (!response.ok) {
    const error=new Error(payload.error?.message ?? '操作没有完成，请稍后重试。');
    error.code=payload.error?.code ?? 'OPERATION_FAILED';
    throw error;
  }
  return payload;
}
function number(value) { return new Intl.NumberFormat('zh-CN').format(Number(value ?? 0)); }
function time(value) { return value ? new Intl.DateTimeFormat('zh-CN',{ month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit' }).format(new Date(value)) : '—'; }
function toast(message) { elements.toast.textContent=message; elements.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(() => elements.toast.classList.remove('show'),3000); }
function statusLabel(status) { return ({ pending:'等待开始',running:'运行中',paused:'已暂停',paused_manual_recovery:'等待人工恢复',interrupted:'异常中断',completed:'已完成',completed_with_errors:'完成但有错误',failed:'失败',cancelled:'已取消' })[status] ?? '空闲'; }

async function loadOperatorProfiles() {
  const payload=await api('/api/catalog/operator/profiles');
  operatorProfiles=payload.profiles ?? [];
  const categories=[...new Set(operatorProfiles.map(profile=>profile.category_key))];
  elements.operatorCategory.replaceChildren(...categories.map(key=>option(key,key)));
  renderOperatorProfileOptions();
}

function renderOperatorProfileOptions() {
  const profiles=operatorProfiles.filter(profile=>profile.category_key===elements.operatorCategory.value);
  elements.operatorProfile.replaceChildren(...profiles.map(profile=>option(profile.category_profile_version,
    `${profile.category_profile_version}${profile.available||profile.initial_pool_available ? '':'（不可用）'}`,
    !profile.available&&!profile.initial_pool_available)));
  selectedOperatorProfile=profiles.find(profile=>profile.category_profile_version===elements.operatorProfile.value) ?? profiles[0] ?? null;
  if (selectedOperatorProfile && !elements.operatorProfile.value) elements.operatorProfile.value=selectedOperatorProfile.category_profile_version;
  renderOperatorSelection();
}

function renderOperatorSelection() {
  selectedOperatorProfile=operatorProfiles.find(profile=>profile.category_key===elements.operatorCategory.value
    && profile.category_profile_version===elements.operatorProfile.value) ?? null;
  elements.operatorActivePool.textContent=number(selectedOperatorProfile?.active_pool_count);
  const initial=Boolean(selectedOperatorProfile?.initial_pool_available&&!selectedOperatorProfile?.expansion_available);
  elements.operatorRequestedNewField.hidden=initial;elements.operatorCalculatedTargetField.hidden=initial;
  elements.operatorRequestedNew.required=!initial;
  const target=calculateTarget(selectedOperatorProfile,Number(elements.operatorRequestedNew.value));
  elements.operatorCalculatedTarget.textContent=target===null ? '—':number(target);
  elements.createOperatorCampaign.disabled=!(selectedOperatorProfile?.available||selectedOperatorProfile?.initial_pool_available);
  elements.createOperatorCampaign.textContent=initial?'创建首次采集任务':'创建采集任务';
  renderOperatorHeader(selectedOperatorProfile);
}

function renderOperatorHeader(profile) {
  elements.operatorHeaderContext.textContent=profile
    ? `${profile.site_country} / ${profile.language} / ${profile.currency} · ${profile.display_name} · ${profile.sort_order}`
    :'Germany / English / EUR · Multi-Category';
}

async function createOperatorCampaign(event) {
  event.preventDefault();
  elements.createOperatorCampaign.disabled=true;
  elements.operatorCampaignError.hidden=true;
  operatorRequestId ??= createRequestIdentity({randomUUID:()=>crypto.randomUUID()});
  try {
    const initial=Boolean(selectedOperatorProfile?.initial_pool_available&&!selectedOperatorProfile?.expansion_available);
    const body=initial?buildInitialCreatePayload({profile:selectedOperatorProfile,campaignName:elements.operatorCampaignName.value,
      requestId:operatorRequestId}):buildCreatePayload({profile:selectedOperatorProfile,
      requestedNewCount:Number(elements.operatorRequestedNew.value),campaignName:elements.operatorCampaignName.value,requestId:operatorRequestId});
    const result=await api(initial?'/api/catalog/operator/initial-campaigns':'/api/catalog/operator-campaigns',{method:'POST',body});
    renderOperatorCurrent(result.result);
    operatorRequestId=null;
    toast('采集任务已创建，等待在 Temu 页面检测并绑定。');
  } catch(error) {
    elements.operatorCampaignError.textContent=operatorErrorMessage(error);
    elements.operatorCampaignError.hidden=false;
  } finally {
    elements.createOperatorCampaign.disabled=!(selectedOperatorProfile?.available||selectedOperatorProfile?.initial_pool_available);
  }
}

async function refreshOperatorCurrent() {
  try {
    const payload=await api('/api/catalog/operator-campaign/current');
    renderOperatorCurrent(payload.current);
  } catch(error) {
    elements.operatorCampaignError.textContent=operatorErrorMessage(error);
    elements.operatorCampaignError.hidden=false;
  }
}

function renderOperatorCurrent(current) {
  currentOperatorCampaign=current;
  elements.operatorCurrentCampaign.hidden=!current;
  if (!current) return;
  elements.operatorCurrentCategory.textContent=current.category_key;
  elements.operatorCurrentName.textContent=current.campaign_name ?? '—';
  elements.operatorCurrentId.textContent=current.campaign_id;
  elements.operatorCurrentBaseline.textContent=number(current.baseline_count);
  elements.operatorCurrentTarget.textContent=current.campaign_type==='initial'?'不限数量':number(current.target_count);
  elements.operatorCurrentUnique.textContent=number(current.current_unique);
  elements.operatorCurrentRemaining.textContent=current.campaign_type==='initial'?'—':number(current.remaining);
  elements.operatorCurrentStatus.textContent=current.status;
  elements.operatorCurrentBinding.textContent=current.binding_status==='UNBOUND' ? '等待页面绑定 · UNBOUND':current.binding_status;
  const initial=current.campaign_type==='initial';elements.initialPoolActions.hidden=!initial;
  if(initial){const view=initialOperatorViewModel(current);elements.initialQuantityMode.textContent=`采集模式：${view.modeLabel}`;
    elements.initialQaStatus.textContent=`QA：${view.qaStatus} · 覆盖 ${view.qaCandidateCount} · 当前 ${view.currentCount} · 未QA ${view.unreviewedDelta}`;
    elements.runInitialQa.disabled=!view.qaEnabled;elements.activateInitialPool.disabled=!view.activationEnabled;}
  const profile=operatorProfiles.find(item=>item.category_key===current.category_key
    && item.category_profile_version===current.category_profile_version);
  if (profile) renderOperatorHeader(profile);
}

async function runInitialQa(){if(!currentOperatorCampaign)return;elements.runInitialQa.disabled=true;elements.initialQaStatus.textContent='QA：RUNNING…';
  try{const profile=operatorProfiles.find(item=>item.category_key===currentOperatorCampaign.category_key&&item.category_profile_version===currentOperatorCampaign.category_profile_version);
    const body=buildInitialQaPayload({campaignId:currentOperatorCampaign.campaign_id,profile,requestId:createRequestIdentity({randomUUID:()=>crypto.randomUUID()})});
    await api(`/api/catalog/operator/initial-campaigns/${encodeURIComponent(currentOperatorCampaign.campaign_id)}/qa-runs`,{method:'POST',body});await refreshOperatorCurrent();}
  catch(error){elements.operatorCampaignError.textContent=operatorErrorMessage(error);elements.operatorCampaignError.hidden=false;await refreshOperatorCurrent();}}
async function activateInitial(){if(!currentOperatorCampaign)return;elements.activateInitialPool.disabled=true;
  try{const profile=operatorProfiles.find(item=>item.category_key===currentOperatorCampaign.category_key&&item.category_profile_version===currentOperatorCampaign.category_profile_version);
    const body=buildInitialActivationPayload({campaignId:currentOperatorCampaign.campaign_id,profile,requestId:createRequestIdentity({randomUUID:()=>crypto.randomUUID()})});
    const response=await api(`/api/catalog/operator/initial-campaigns/${encodeURIComponent(currentOperatorCampaign.campaign_id)}/activate`,{method:'POST',body});
    const result=response.result;elements.initialActivationResult.hidden=false;elements.initialActivationResult.textContent=`首个商品池已建立\nPool Version：${result.pool_version_id}\nCategory：${result.category_key}\nCount：${result.pool_count}\nActivated At：${result.activated_at}\nSource Campaign：${result.source_campaign_id}`;
    await loadOperatorProfiles();}
  catch(error){elements.operatorCampaignError.textContent=operatorErrorMessage(error);elements.operatorCampaignError.hidden=false;await refreshOperatorCurrent();}}

function option(value,label,disabled=false) {
  const element=document.createElement('option');element.value=value;element.textContent=label;element.disabled=disabled;return element;
}

function render(payload) {
  state=payload;
  renderEnvironment(payload.environment);
  const job=payload.currentJob;
  elements.browserPulse.classList.toggle('offline',!payload.browser.connected);
  elements.browserStatus.textContent=payload.browser.connected ? `${payload.browser.modeLabel} 已连接 · CDP ${payload.browser.port}` : `${payload.browser.modeLabel} 未连接 · CDP ${payload.browser.port}`;
  elements.openBrowser.disabled=payload.browser.connected || payload.browser.mode !== 'managed_profile';
  elements.newBrowser.disabled=payload.browser.mode !== 'managed_profile';
  elements.connectExisting.disabled=payload.browser.connected || payload.browser.mode !== 'external_cdp';
  elements.openBrowser.textContent=payload.browser.mode === 'external_cdp' ? 'Managed Chrome 已停用':payload.browser.connected ? '采集 Chrome 已打开':'打开采集 Chrome';
  renderBrowserHealth(payload.browser);
  elements.jobStatus.textContent=statusLabel(job?.status);
  elements.jobStatus.className=job?.status ?? 'idle';
  elements.jobId.textContent=job?.id ?? '当前没有任务';
  elements.target.textContent=number(job?.targetCount);
  elements.discovered.textContent=number(job?.discovered);
  elements.stored.textContent=number(job?.stored);
  elements.success.textContent=number(job?.success);
  elements.failed.textContent=number(job?.failed);
  elements.resumeCount.textContent=`恢复 ${number(job?.resumeCount)} 次`;
  elements.imageCoverage.textContent=`${number(payload.imageCoverage.percent)}%`;
  elements.imageCount.textContent=`${number(payload.imageCoverage.usable)} / ${number(payload.imageCoverage.active)}`;
  elements.activeProducts.textContent=number(payload.activeProducts);
  elements.checkpoint.textContent=checkpointText(payload.checkpoint);
  elements.qualitySummary.textContent=qualityText(payload.quality);
  elements.latestExcel.textContent=payload.latestExcel.exists ? `${payload.latestExcel.name} · ${time(payload.latestExcel.modifiedAt)}` : '尚未生成';
  elements.recentError.textContent=payload.recentErrors[0]?.message ?? '无';
  elements.sessionStatus.textContent=job?.status === 'paused_manual_recovery' ? (job.sessionRecoveryValidated ? 'SESSION_RECOVERED · 可继续评论采集':'SESSION_CONTEXT_PROBLEM · 等待人工恢复'):'无待恢复关卡';
  elements.updatedAt.textContent=`更新于 ${time(new Date())}`;
  renderHistory(payload.jobs);
  renderEvents(payload.events);
  renderControls(job,payload);
  renderNotice(job,payload);
}
function renderEnvironment(environment={}) {
  const testMode=environment.testMode === true;
  document.body.classList.toggle('test-mode',testMode);
  elements.environmentBanner.hidden=!testMode;
  elements.resetTestData.hidden=!testMode;
  elements.consoleTitle.textContent=testMode ? 'Temu 测试运营台':'Temu 选品运营台';
  document.title=testMode ? 'Temu 测试运营台':'Temu 选品运营台';
}
function renderBrowserHealth(browser) {
  const health=browser.pageHealth;
  const checks=health?.checks ?? {};
  const readiness=health?.status ?? 'NOT_READY';
  elements.pageReadiness.textContent=readiness;
  elements.pageReadiness.className=readiness === 'READY' ? 'ready':'not-ready';
  elements.browserMode.textContent=browser.modeLabel ?? '—';
  elements.profileName.textContent=browser.profileName ?? '—';
  elements.cdpPort.textContent=String(browser.port ?? '—');
  elements.healthCountry.textContent=checks.COUNTRY ?? 'UNKNOWN';
  elements.healthLanguage.textContent=checks.LANGUAGE ?? 'UNKNOWN';
  elements.healthCurrency.textContent=checks.CURRENCY ?? 'UNKNOWN';
  elements.loginStatus.textContent=checks.LOGIN_STATUS ?? 'UNKNOWN';
  elements.productListVisible.textContent=checks.PRODUCT_LIST_VISIBLE ? 'YES':'NO';
  elements.categorySortStatus.textContent=`${checks.CATEGORY_CONFIRMED ? 'YES':'NO'} / ${checks.TOP_SALES_CONFIRMED ? 'YES':'NO'}`;
  elements.pageHealthCode.textContent=checks.PAGE_HEALTH ?? '尚未验证';
  elements.profileWarning.textContent=health?.profileWarning ?? '';
  elements.profileWarning.hidden=!health?.profileWarning;
  elements.diagnosticParams.textContent=diagnosticText(health?.diagnostics,health?.checkedAt);
}
function diagnosticText(value,checkedAt) {
  if (!value) return '点击“验证当前页面”后显示诊断参数。';
  const navigation=value.navigation ?? {};
  const markers=value.markers ?? {};
  const expected=value.expected ?? {};
  return [
    `检查时间: ${checkedAt ?? '—'}`,
    `URL host/path: ${value.urlHost || '—'}${value.urlPath || ''}`,
    `URL 参数名称: ${(value.queryParamNames ?? []).join(', ') || '无'}`,
    `会话型参数名称: ${(value.sessionParamNames ?? []).join(', ') || '无'}`,
    `页面标题: ${value.pageTitle || '—'}`,
    `document.readyState: ${value.documentReadyState ?? 'UNKNOWN'}`,
    `navigator.onLine: ${String(value.navigatorOnline ?? 'UNKNOWN')}`,
    `浏览器语言: ${value.navigatorLanguage ?? 'UNKNOWN'} / ${(value.navigatorLanguages ?? []).join(', ') || '—'}`,
    `时区 / 可见性: ${value.timezone ?? 'UNKNOWN'} / ${value.visibilityState ?? 'UNKNOWN'}`,
    `Service Worker 控制: ${value.serviceWorkerControlled ? 'YES':'NO'}`,
    `页面文本长度 / 商品链接: ${value.bodyTextLength ?? 0} / ${value.productLinkCount ?? 0}`,
    `导航: ${navigation.type ?? 'UNKNOWN'} · response ${navigation.responseStartMs ?? '—'}ms · DOM ${navigation.domContentLoadedMs ?? '—'}ms · load ${navigation.loadEventEndMs ?? '—'}ms · ${navigation.transferSize ?? '—'} bytes`,
    `异常标志: SEARCH_NO_RESULTS=${Boolean(markers.searchNoResults)} · STALE_CATEGORY_PAGE=${Boolean(markers.staleCategory)} · NETWORK_ERROR=${Boolean(markers.networkError)}`,
    `环境差异: 会话参数=${Boolean(markers.sessionParamsPresent)} · 浏览器语言不一致=${Boolean(markers.navigatorLanguageMismatch)} · 德国目标/系统时区不一致=${Boolean(markers.targetCountryTimezoneMismatch)}`,
    `期望环境: ${expected.country || '—'} / ${expected.language || '—'} / ${expected.currency || '—'} / Chrome locale ${expected.browserLocale || '—'}`,
    `期望页面: ${expected.primaryCategory || '—'} > ${expected.subcategory || '—'} / ${expected.sortOrder || '—'}`,
    '打开标签页:',
    ...(value.tabs ?? []).map(tab => `  [${tab.selected ? '*':' '}] #${tab.index} ${tab.visible ? 'VISIBLE':'HIDDEN'} ${tab.host || '—'}${tab.path || ''} · ${tab.title || '—'} · 参数 ${(tab.queryParamNames ?? []).join(', ') || '无'}`)
  ].join('\n');
}
function checkpointText(checkpoint) {
  if (!checkpoint) return '暂无';
  const round=checkpoint.scrollRound ?? checkpoint.round;
  const count=checkpoint.currentCount ?? checkpoint.discovered;
  return [checkpoint.phase && `阶段 ${checkpoint.phase}`,round != null && `滚动 ${round} 轮`,count != null && `当前 ${count} 条`,checkpoint.lastEvent].filter(Boolean).join(' · ');
}
function qualityText(rows) {
  if (!rows.length) return '暂无质量记录';
  const passed=rows.filter(row => row.passed).length;
  return `${passed}/${rows.length} 项通过${passed === rows.length ? '' : '，请查看最近错误和事件'}`;
}
function renderHistory(jobs) {
  elements.jobHistory.replaceChildren(...jobs.slice(0,8).map(job => {
    const row=document.createElement('button');
    row.type='button'; row.className='history-row'; row.disabled=true;
    const title=document.createElement('strong'); title.textContent=`${job.jobType} · ${statusLabel(job.status)}`;
    const meta=document.createElement('span'); meta.textContent=`${job.id} · ${time(job.updatedAt)}`;
    row.append(title,meta); return row;
  }));
}
function renderEvents(events) {
  elements.eventCount.textContent=`${events.length} 条`;
  if (!events.length) { elements.events.innerHTML='<p class="empty">任务事件会显示在这里。</p>'; return; }
  elements.events.replaceChildren(...events.slice().reverse().map(event => {
    const row=document.createElement('article'); row.className=`event ${event.level}`;
    const top=document.createElement('div'); const type=document.createElement('strong'); type.textContent=event.type;
    const at=document.createElement('time'); at.textContent=time(event.createdAt); top.append(type,at);
    const message=document.createElement('p'); message.textContent=event.message; row.append(top,message); return row;
  }));
}
function renderControls(job,payload) {
  const status=job?.status;
  const active=['pending','running','paused','paused_manual_recovery','interrupted'].includes(status);
  startButtons.forEach(button => button.disabled=active || !payload.browser.connected || payload.browser.pageHealth?.status !== 'READY');
  elements.validatePage.disabled=!payload.browser.connected;
  elements.pause.disabled=status !== 'running' || job?.pauseRequested;
  elements.resume.disabled=!['paused','interrupted'].includes(status);
  elements.cancel.disabled=!['pending','running','paused','paused_manual_recovery','interrupted','failed'].includes(status);
  const sessionGate=status === 'paused_manual_recovery' && job?.jobType === 'reviews';
  elements.sessionRecoveryControls.hidden=!sessionGate;
  elements.validateSessionRecovery.disabled=!sessionGate;
  elements.resumeReviewCapture.disabled=!sessionGate || !job?.sessionRecoveryValidated;
  elements.retry.disabled=!['failed','interrupted','completed_with_errors'].includes(status);
  elements.export.disabled=payload.activeProducts === 0;
  elements.openExcel.disabled=!payload.latestExcel.exists;
  elements.clearExcel.disabled=!(payload.currentExcelExists ?? payload.latestExcel.exists);
}
function renderNotice(job,payload) {
  let message='',kind='';
  if (!payload.browser.connected) message=payload.browser.mode === 'external_cdp'
    ? '请先由运营人员准备已开启 CDP 的 Chrome，进入摩托配件 Top Sales 页面，再点击“连接已有 Chrome”。'
    : '请先打开采集 Chrome，人工登录 Temu，进入摩托配件类目并选择 Top Sales。';
  else if (payload.browser.pageHealth?.status !== 'READY') message='请点击“验证当前页面”。只有摩托配件 Top Sales 页面显示真实商品且状态为 READY 才能开始采集。';
  if (payload.browser.pageHealth?.profileWarning) { message=payload.browser.pageHealth.profileWarning;kind='warn'; }
  if (job?.pauseRequested) message='暂停请求已收到，任务会在下一个安全批次边界保存 checkpoint 后暂停。';
  if (job?.cancelRequested) message='取消请求已收到，任务会在下一个安全点停止，已成功数据会保留。';
  if (job?.status === 'paused') message='任务已安全暂停。页面准备好后点击“继续”，将按原 job_id 从 checkpoint 恢复。';
  if (job?.status === 'paused_manual_recovery') { message='External Chrome 当前商品上下文异常。请人工：1. 回 Temu 首页或目标类目；2. 确认 Germany / English / EUR；3. 重新进入 Motorcycle Accessories / Top Sales；4. 人工打开一个正常商品；5. 如有验证码或登录，请人工完成。然后点击“页面已恢复，重新验证”。';kind='warn'; }
  if (job?.waitingForInput) {
    message=job.manualGateMessage ?? 'Temu 需要人工处理。请在采集 Chrome 中完成操作后点击“继续”。';
    kind='warn';
  }
  if (job?.status === 'interrupted') { message='检测到服务或采集进程中断，数据和 checkpoint 已保留，请点击“继续”。'; kind='warn'; }
  if (job?.status === 'failed') { message=job.lastError ?? '任务失败，已成功数据仍保留。请修复页面或网络后重试。'; kind='error'; }
  if (job?.status === 'completed' && !message) { message='任务已完成，可以导出或打开运营 Excel。'; kind='success'; }
  elements.notice.textContent=message; elements.notice.className=`notice ${message ? 'show' : ''} ${kind}`;
}
async function action(path,message,body) { try { toast(message); await api(path,{ method:'POST',body }); await refresh(); } catch(error) { toast(error.message); await refresh(); } }
async function refresh() { try { render(await api('/api/status')); } catch(error) { elements.notice.textContent=`运营台连接异常：${error.message}`; elements.notice.className='notice show error'; } }

elements.openBrowser.addEventListener('click',() => action('/api/browser/open','正在打开采集 Chrome…'));
elements.connectExisting.addEventListener('click',() => action('/api/browser/connect','正在连接已有 Chrome…'));
elements.newBrowser.addEventListener('click',() => {
  if (confirm('确认新建一个完全独立的采集 Chrome？\n\n旧 profile 会保留，新 Chrome 不复制 Cookie、Token 或登录状态，需要重新人工登录 Temu。')) action('/api/browser/new','正在创建新的独立采集 Chrome…');
});
elements.validatePage.addEventListener('click',async () => {
  try { const result=await api('/api/browser/validate',{ method:'POST' });toast(`页面验证：${result.validation.status} · ${result.validation.code}`);await refresh(); }
  catch(error) { toast(error.message);await refresh(); }
});
startButtons.forEach(button => button.addEventListener('click',() => action('/api/jobs/start',`正在开始 ${button.dataset.start} 条任务…`,{ targetCount:Number(button.dataset.start) })));
elements.pause.addEventListener('click',() => action(`/api/jobs/${state.currentJob.id}/pause`,'暂停请求已提交'));
elements.resume.addEventListener('click',() => action(`/api/jobs/${state.currentJob.id}/resume`,'正在从 checkpoint 继续'));
elements.cancel.addEventListener('click',() => { if (confirm('确认取消当前任务？已成功数据和历史会保留。')) action(`/api/jobs/${state.currentJob.id}/cancel`,'取消请求已提交'); });
elements.retry.addEventListener('click',() => action(`/api/jobs/${state.currentJob.id}/retry`,'正在重试可恢复失败项'));
elements.validateSessionRecovery.addEventListener('click',() => action(`/api/reviews/${state.currentJob.id}/validate-session-recovery`,'正在验证 External Chrome 页面与 3 个 Control Products…'));
elements.resumeReviewCapture.addEventListener('click',() => action(`/api/reviews/${state.currentJob.id}/resume`,'Session 已恢复，正在从 checkpoint 继续评论采集…'));
elements.export.addEventListener('click',() => action('/api/export','正在从数据库导出 Excel…'));
elements.openExcel.addEventListener('click',() => action('/api/open/excel','正在打开最新 Excel…'));
elements.clearExcel.addEventListener('click',() => {
  if (!confirm('确认清除当前导出的 Excel 文件吗？\n\n文件会移入本地历史备份，数据库、图片缓存和人工备注不会删除。之后可点击“导出 Excel”重新生成。')) return;
  action('/api/clear/excel','正在清除 Excel 文件…',{ confirmed:true });
});
elements.resetTestData.addEventListener('click',() => {
  if (!confirm('第一次确认：确定重置全部测试数据吗？\n\n只允许清理独立测试数据库、测试 Excel 和测试图片；重置前会自动备份。')) return;
  const phrase=prompt('第二次确认：请输入“重置测试数据”继续。');
  if (phrase !== '重置测试数据') { toast('确认文字不正确，已取消重置。');return; }
  action('/api/test/reset','正在备份并重置测试数据…',{ confirmed:true,phrase:'RESET_TEST_DATA' });
});
elements.openFolder.addEventListener('click',() => action('/api/open/folder','正在打开结果目录…'));

elements.operatorCampaignForm.addEventListener('submit',createOperatorCampaign);
elements.runInitialQa.addEventListener('click',runInitialQa);elements.activateInitialPool.addEventListener('click',activateInitial);
elements.operatorCategory.addEventListener('change',()=>{operatorRequestId=null;renderOperatorProfileOptions();});
elements.operatorProfile.addEventListener('change',()=>{operatorRequestId=null;renderOperatorSelection();});
for (const input of [elements.operatorRequestedNew,elements.operatorCampaignName]) input.addEventListener('input',()=>{
  operatorRequestId=null;renderOperatorSelection();
});

await Promise.all([refresh(),loadOperatorProfiles().then(refreshOperatorCurrent)]);
setInterval(()=>{refresh();refreshOperatorCurrent();},1500);
