'use strict';

const elements={ goodsId:document.querySelector('#goods-id'),matched:document.querySelector('#matched'),cutoffDate:document.querySelector('#cutoff-date'),start:document.querySelector('#start'),status:document.querySelector('#status'),
  reviewPanel:document.querySelector('#review-panel'),catalogPanel:document.querySelector('#catalog-panel'),category:document.querySelector('#catalog-category'),campaign:document.querySelector('#catalog-campaign'),
  profile:document.querySelector('#catalog-profile'),pageHealth:document.querySelector('#page-health'),bindStatus:document.querySelector('#bind-status'),progress:document.querySelector('#catalog-progress'),
  counts:document.querySelector('#catalog-counts'),catalogError:document.querySelector('#catalog-error'),detect:document.querySelector('#detect-page'),bind:document.querySelector('#bind-page'),capture:document.querySelector('#capture-page'),yingdao:document.querySelector('#yingdao-export') };
let activeTabId=null;
const MANUAL_MODES=new Set(['MANUAL_BIND_PASSIVE_CAPTURE','MANUAL_NAVIGATION_PASSIVE_CAPTURE']);

function tabMessage(tabId,message) {
  return new Promise((resolve,reject) => chrome.tabs.sendMessage(tabId,message,response => {
    const error=chrome.runtime.lastError;if (error) reject(new Error(error.message));else resolve(response);
  }));
}
function runtimeMessage(message) {
  return new Promise((resolve,reject) => chrome.runtime.sendMessage(message,response => {
    const error=chrome.runtime.lastError;if (error) reject(new Error(error.message));else resolve(response);
  }));
}

async function load() {
  try {
    const [tab]=await chrome.tabs.query({ active:true,currentWindow:true });activeTabId=tab?.id ?? null;
    if (!activeTabId) throw new Error('无法读取当前标签页。');
    const catalog=await runtimeMessage({type:'GET_CATALOG_CURRENT'}).catch(()=>null);
    if(catalog?.ok&&MANUAL_MODES.has(catalog.context?.campaign?.browserControlMode)){
      elements.reviewPanel.hidden=true;elements.catalogPanel.hidden=false;
      const state=await tabMessage(activeTabId,{type:'GET_MANUAL_CAPTURE_STATE'});if(!state?.ok)throw new Error(state?.error?.message??'Manual Bind Runner 未就绪。');renderCatalog(state.result);return;
    }
    const page=await tabMessage(activeTabId,{ type:'GET_CURRENT_PAGE' });
    if (!page?.isTemuProductPage) throw new Error('请先打开带 goods_id 的 Temu 商品页。');
    elements.goodsId.textContent=page.goodsId;
    const response=await runtimeMessage({ type:'GET_REVIEW_CONTEXT',goodsId:page.goodsId });
    if (!response?.ok) throw new Error(response?.error ?? '本地运营台不可用。');
    const context=response.context;elements.matched.textContent=context.matched ? '是':'否';elements.matched.className=`value ${context.matched ? 'yes':'no'}`;
    elements.cutoffDate.textContent=context.cutoffDate ?? '—';elements.start.disabled=!context.matched;
    elements.status.textContent=context.matched ? `就绪；任务状态：${context.taskStatus ?? context.jobStatus}`:'当前商品不在运营台 Day9 任务中，不会采集。';
  } catch (error) { elements.matched.textContent='否';elements.matched.className='value no';elements.status.textContent=error.message;elements.start.disabled=true; }
}

function renderCatalog(value){const context=value.context??{},campaign=context.campaign??{},profile=context.profile??{},audit=value.lastResult?.audit??{},checkpoint=context.queue?.checkpoint??{};
  elements.category.textContent=profile.display_name??campaign.categoryKey??'—';elements.campaign.textContent=campaign.id??'—';elements.profile.textContent=campaign.categoryProfileVersion??'—';
  elements.pageHealth.textContent=value.detection?.health?.status??'NOT_DETECTED';elements.bindStatus.textContent=value.binding?.status??'UNBOUND';elements.progress.textContent=`${campaign.targetCount??0} / ${campaign.nonElectronicUniqueCount??0}`;
  elements.counts.textContent=`${audit.acceptedGoods??0} / ${audit.campaignStagingDeduped??0} / ${checkpoint.failed_count??0}`;elements.catalogError.textContent=value.lastError?.code??'—';
  elements.bind.disabled=value.detection?.health?.status!=='READY';elements.capture.disabled=value.binding?.status!=='BOUND';elements.yingdao.disabled=!campaign.categoryKey||!context.poolVersionId;
  elements.status.textContent=value.binding?.status==='BOUND'?'页面已绑定；人工滚动或点击 See more 后，手动点击“采集当前页面”。':'请先检测当前页面，再人工绑定明确 Campaign。';}

async function manualAction(type){elements.status.textContent='处理中…';const response=await tabMessage(activeTabId,{type});if(!response?.ok){const error=new Error(response?.error?.message??'操作失败。');error.code=response?.error?.code;throw error;}renderCatalog(response.result);return response.result;}
elements.detect.addEventListener('click',()=>manualAction('MANUAL_DETECT_CURRENT').catch(error=>{elements.status.textContent=`${error.code??'ERROR'}: ${error.message}`;}));
elements.bind.addEventListener('click',()=>manualAction('MANUAL_BIND_CURRENT').catch(error=>{elements.status.textContent=`${error.code??'ERROR'}: ${error.message}`;}));
elements.capture.addEventListener('click',()=>manualAction('MANUAL_CAPTURE_CURRENT').catch(error=>{elements.status.textContent=`${error.code??'ERROR'}: ${error.message}`;}));
elements.yingdao.addEventListener('click',async()=>{const response=await tabMessage(activeTabId,{type:'YINGDAO_EXPORT_SEAM'});elements.status.textContent=response?.ok?'YingDao Task Export V1 接口已预留；本轮不生成文件。':'影刀导出接口不可用。';});

elements.start.addEventListener('click',async () => {
  elements.start.disabled=true;elements.status.textContent='正在读取并保存当前页面已显示评论…';
  try {
    const response=await tabMessage(activeTabId,{ type:'START_CURRENT_PAGE_CAPTURE' });
    if (!response?.ok) throw new Error(response?.error ?? '采集失败。');
    const result=response.result;elements.status.textContent=`完成：读取 ${result.received} 条，新增 ${result.inserted} 条，去重 ${result.deduplicated} 条。`;
  } catch (error) { elements.status.textContent=`未采集：${error.message}`; }
  finally { elements.start.disabled=false; }
});

load();
