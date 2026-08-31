import { mountCatalogPanel } from './modules/catalog/panel.js';
import { sourcingControls } from './sourcing-ui-state.js';

const $=selector => document.querySelector(selector);
const catalogRoot=$('#catalog-module-root');
const elements={
  environmentBanner:$('#environmentBanner'),consoleTitle:$('#consoleTitle'),resetTestData:$('#resetTestData'),
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
const sourcing={state:$('#sourcingState'),raw:$('#sourcingRawDir'),images:$('#sourcingImageDir'),workbook:$('#sourcingWorkbook'),chooseRaw:$('#chooseSourcingRaw'),chooseImages:$('#chooseSourcingImages'),chooseWorkbook:$('#chooseSourcingWorkbook'),scan:$('#scanSourcing'),start:$('#startSourcingImport'),retry:$('#retrySourcingImages'),runId:$('#sourcingRunId'),sourceFiles:$('#sourcingSourceFiles'),goods:$('#sourcingGoods'),invalid:$('#sourcingInvalid'),parsed:$('#sourcingParsed'),random5:$('#sourcingRandom5'),imageSuccess:$('#sourcingImageSuccess'),imageFailed:$('#sourcingImageFailed'),qa:$('#sourcingQa'),preview:$('#sourcingPreview')};
const startButtons=[...document.querySelectorAll('[data-start]')];
let state=null,toastTimer;

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

let sourcingModel={state:'UNCONFIGURED',settings:{},image_failed:0},pathsDirty=false;
function renderSourcing(model,{fromServer=false}={}) {
  if(fromServer&&pathsDirty) model={...model,state:'SCAN_STALE',scan_token:null};
  sourcingModel={...sourcingModel,...model};const settings=sourcingModel.settings??{};
  if(document.activeElement!==sourcing.raw)sourcing.raw.value=settings.sourceDir??'';
  if(document.activeElement!==sourcing.images)sourcing.images.value=settings.imageCacheDir??'';
  if(document.activeElement!==sourcing.workbook)sourcing.workbook.value=settings.selectedWorkbookPath??'';
  sourcing.state.textContent=sourcingModel.state;sourcing.runId.textContent=sourcingModel.current_run_id??'—';
  sourcing.sourceFiles.textContent=number(sourcingModel.source_files);sourcing.goods.textContent=number(sourcingModel.valid_goods_id);
  sourcing.invalid.textContent=number(sourcingModel.invalid_files?.length);sourcing.parsed.textContent=number(sourcingModel.parsed_candidates);
  sourcing.random5.textContent=number(sourcingModel.random5_candidates);sourcing.imageSuccess.textContent=number(sourcingModel.image_success);
  sourcing.imageFailed.textContent=number(sourcingModel.image_failed);sourcing.qa.textContent=sourcingModel.qa_status??'—';
  const controls=sourcingControls({state:sourcingModel.state,imageFailed:sourcingModel.image_failed});
  [sourcing.raw,sourcing.images,sourcing.workbook,sourcing.chooseRaw,sourcing.chooseImages,sourcing.chooseWorkbook].forEach(element=>element.disabled=controls.pathsLocked);
  sourcing.scan.disabled=!controls.canScan;sourcing.start.disabled=!controls.canImport;sourcing.retry.disabled=!controls.canRetry;
  const rows=sourcingModel.preview?.files??[];
  sourcing.preview.replaceChildren(...(rows.length?rows.map(file=>{const row=document.createElement('tr');for(const value of [file.filename,file.goods_id,file.row_count,file.parse_status]){const cell=document.createElement('td');cell.textContent=value??'';row.append(cell);}return row;}):[Object.assign(document.createElement('tr'),{innerHTML:'<td colspan="4">尚未扫描</td>'})]));
}
async function refreshSourcing() { try { renderSourcing(await api('/api/sourcing/settings'),{fromServer:true});const current=await api('/api/sourcing/imports/current');if(current.current_run_id)renderSourcing(current,{fromServer:true}); } catch(error) { toast(error.message); } }
async function saveSourcingPaths() { const result=await api('/api/sourcing/settings',{method:'PUT',body:{sourceDir:sourcing.raw.value,imageCacheDir:sourcing.images.value,selectedWorkbookPath:sourcing.workbook.value}});pathsDirty=false;renderSourcing(result); }
for(const input of [sourcing.raw,sourcing.images,sourcing.workbook]) {
  input.addEventListener('input',()=>{pathsDirty=true;renderSourcing({...sourcingModel,state:'SCAN_STALE',scan_token:null});});
  input.addEventListener('change',()=>saveSourcingPaths().catch(error=>toast(error.message)));
}
for(const [button,kind] of [[sourcing.chooseRaw,'RAW_DIRECTORY'],[sourcing.chooseImages,'IMAGE_CACHE_DIRECTORY'],[sourcing.chooseWorkbook,'ANALYSIS_WORKBOOK']]) button.addEventListener('click',async()=>{try{const result=await api('/api/sourcing/path-dialog',{method:'POST',body:{kind}});pathsDirty=false;renderSourcing(result);}catch(error){toast(error.message);}});
sourcing.scan.addEventListener('click',async()=>{try{await saveSourcingPaths();renderSourcing({...sourcingModel,state:'SCANNING'});renderSourcing(await api('/api/sourcing/scan',{method:'POST',body:{}}));}catch(error){toast(error.message);await refreshSourcing();}});
sourcing.start.addEventListener('click',async()=>{try{renderSourcing({...sourcingModel,state:'IMPORTING'});renderSourcing(await api('/api/sourcing/imports',{method:'POST',body:{scanToken:sourcingModel.scan_token}}));}catch(error){toast(error.message);await refreshSourcing();}});
sourcing.retry.addEventListener('click',async()=>{try{renderSourcing({...sourcingModel,state:'RETRYING_FAILED_IMAGES'});renderSourcing(await api(`/api/sourcing/imports/${encodeURIComponent(sourcingModel.current_run_id)}/retry-failed-images`,{method:'POST',body:{}}));}catch(error){toast(error.message);await refreshSourcing();}});

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

mountCatalogPanel({root:catalogRoot});
await Promise.all([refresh(),refreshSourcing()]);
setInterval(refresh,1500);
setInterval(refreshSourcing,3000);
