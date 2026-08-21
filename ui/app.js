const $=selector => document.querySelector(selector);
const elements={
  notice:$('#notice'),browserPulse:$('#browserPulse'),browserStatus:$('#browserStatus'),openBrowser:$('#openBrowser'),
  jobStatus:$('#jobStatus'),jobId:$('#jobId'),target:$('#target'),discovered:$('#discovered'),stored:$('#stored'),
  success:$('#success'),failed:$('#failed'),resumeCount:$('#resumeCount'),imageCoverage:$('#imageCoverage'),
  imageCount:$('#imageCount'),checkpoint:$('#checkpoint'),activeProducts:$('#activeProducts'),qualitySummary:$('#qualitySummary'),
  latestExcel:$('#latestExcel'),recentError:$('#recentError'),updatedAt:$('#updatedAt'),jobHistory:$('#jobHistory'),
  events:$('#events'),eventCount:$('#eventCount'),pause:$('#pause'),resume:$('#resume'),cancel:$('#cancel'),
  retry:$('#retry'),export:$('#export'),openExcel:$('#openExcel'),clearExcel:$('#clearExcel'),openFolder:$('#openFolder'),toast:$('#toast')
};
const startButtons=[...document.querySelectorAll('[data-start]')];
let state=null,toastTimer;

async function api(url,options={}) {
  const response=await fetch(url,{ method:options.method ?? 'GET',headers:{ 'Content-Type':'application/json' },body:options.body ? JSON.stringify(options.body) : undefined });
  const payload=await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? '操作没有完成，请稍后重试。');
  return payload;
}
function number(value) { return new Intl.NumberFormat('zh-CN').format(Number(value ?? 0)); }
function time(value) { return value ? new Intl.DateTimeFormat('zh-CN',{ month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit' }).format(new Date(value)) : '—'; }
function toast(message) { elements.toast.textContent=message; elements.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(() => elements.toast.classList.remove('show'),3000); }
function statusLabel(status) { return ({ pending:'等待开始',running:'运行中',paused:'已暂停',interrupted:'异常中断',completed:'已完成',completed_with_errors:'完成但有错误',failed:'失败',cancelled:'已取消' })[status] ?? '空闲'; }

function render(payload) {
  state=payload;
  const job=payload.currentJob;
  elements.browserPulse.classList.toggle('offline',!payload.browser.connected);
  elements.browserStatus.textContent=payload.browser.connected ? `采集 Chrome 已连接 · CDP ${payload.browser.port}` : `采集 Chrome 未连接 · CDP ${payload.browser.port}`;
  elements.openBrowser.disabled=payload.browser.connected;
  elements.openBrowser.textContent=payload.browser.connected ? '采集 Chrome 已打开' : '打开采集 Chrome';
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
  elements.updatedAt.textContent=`更新于 ${time(new Date())}`;
  renderHistory(payload.jobs);
  renderEvents(payload.events);
  renderControls(job,payload);
  renderNotice(job,payload);
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
  const active=['pending','running','paused','interrupted'].includes(status);
  startButtons.forEach(button => button.disabled=active || !payload.browser.connected);
  elements.pause.disabled=status !== 'running' || job?.pauseRequested;
  elements.resume.disabled=!['paused','interrupted'].includes(status);
  elements.cancel.disabled=!['pending','running','paused','interrupted','failed'].includes(status);
  elements.retry.disabled=!['failed','interrupted','completed_with_errors'].includes(status);
  elements.export.disabled=payload.activeProducts === 0;
  elements.openExcel.disabled=!payload.latestExcel.exists;
  elements.clearExcel.disabled=!payload.latestExcel.exists;
}
function renderNotice(job,payload) {
  let message='',kind='';
  if (!payload.browser.connected) message='请先打开采集 Chrome，人工登录 Temu，进入摩托配件类目并选择 Top Sales。';
  if (job?.pauseRequested) message='暂停请求已收到，任务会在下一个安全批次边界保存 checkpoint 后暂停。';
  if (job?.cancelRequested) message='取消请求已收到，任务会在下一个安全点停止，已成功数据会保留。';
  if (job?.status === 'paused') message='任务已安全暂停。页面准备好后点击“继续”，将按原 job_id 从 checkpoint 恢复。';
  if (job?.waitingForInput) { message='Temu 需要登录或安全验证。请在采集 Chrome 中人工处理，恢复摩托配件 Top Sales 页面后点击“继续”。'; kind='warn'; }
  if (job?.status === 'interrupted') { message='检测到服务或采集进程中断，数据和 checkpoint 已保留，请点击“继续”。'; kind='warn'; }
  if (job?.status === 'failed') { message=job.lastError ?? '任务失败，已成功数据仍保留。请修复页面或网络后重试。'; kind='error'; }
  if (job?.status === 'completed') { message='任务已完成，可以导出或打开运营 Excel。'; kind='success'; }
  elements.notice.textContent=message; elements.notice.className=`notice ${message ? 'show' : ''} ${kind}`;
}
async function action(path,message,body) { try { toast(message); await api(path,{ method:'POST',body }); await refresh(); } catch(error) { toast(error.message); await refresh(); } }
async function refresh() { try { render(await api('/api/status')); } catch(error) { elements.notice.textContent=`运营台连接异常：${error.message}`; elements.notice.className='notice show error'; } }

elements.openBrowser.addEventListener('click',() => action('/api/browser/open','正在打开采集 Chrome…'));
startButtons.forEach(button => button.addEventListener('click',() => action('/api/jobs/start',`正在开始 ${button.dataset.start} 条任务…`,{ targetCount:Number(button.dataset.start) })));
elements.pause.addEventListener('click',() => action(`/api/jobs/${state.currentJob.id}/pause`,'暂停请求已提交'));
elements.resume.addEventListener('click',() => action(`/api/jobs/${state.currentJob.id}/resume`,'正在从 checkpoint 继续'));
elements.cancel.addEventListener('click',() => { if (confirm('确认取消当前任务？已成功数据和历史会保留。')) action(`/api/jobs/${state.currentJob.id}/cancel`,'取消请求已提交'); });
elements.retry.addEventListener('click',() => action(`/api/jobs/${state.currentJob.id}/retry`,'正在重试可恢复失败项'));
elements.export.addEventListener('click',() => action('/api/export','正在从数据库导出 Excel…'));
elements.openExcel.addEventListener('click',() => action('/api/open/excel','正在打开最新 Excel…'));
elements.clearExcel.addEventListener('click',() => {
  if (!confirm('确认清除当前导出的 Excel 文件吗？\n\n文件会移入本地历史备份，数据库、图片缓存和人工备注不会删除。之后可点击“导出 Excel”重新生成。')) return;
  action('/api/clear/excel','正在清除 Excel 文件…',{ confirmed:true });
});
elements.openFolder.addEventListener('click',() => action('/api/open/folder','正在打开结果目录…'));

await refresh();
setInterval(refresh,1500);
