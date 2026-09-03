'use strict';

const elements={ goodsId:document.querySelector('#goods-id'),matched:document.querySelector('#matched'),cutoffDate:document.querySelector('#cutoff-date'),start:document.querySelector('#start'),status:document.querySelector('#status'),
  reviewPanel:document.querySelector('#review-panel'),catalogPanel:document.querySelector('#catalog-panel'),evidenceToken:document.querySelector('#evidence-bind-token'),evidenceBind:document.querySelector('#evidence-bind'),evidenceBefore:document.querySelector('#evidence-before'),evidenceAfter:document.querySelector('#evidence-after') };
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

function renderCatalog(value){
  const model=globalThis.TemuCatalogOperatorViewModel.build(value);
  elements.catalogPanel.innerHTML=globalThis.TemuCatalogPopupView.renderMarkup(model);
  const actions=[['#detect-page','MANUAL_DETECT_CURRENT'],['#bind-page','MANUAL_BIND_CURRENT'],['#capture-page','MANUAL_CAPTURE_CURRENT']];
  for(const [selector,type] of actions)elements.catalogPanel.querySelector(selector)?.addEventListener('click',()=>manualAction(type).catch(error=>{const status=elements.catalogPanel.querySelector('#catalog-status');if(status)status.textContent=`${error.code??'ERROR'}: ${error.message}`;}));
  return model;
}

async function manualAction(type){const status=elements.catalogPanel.querySelector('#catalog-status');if(status)status.textContent='处理中…';const response=await tabMessage(activeTabId,{type});if(!response?.ok){const error=new Error(response?.error?.message??'操作失败。');error.code=response?.error?.code;throw error;}renderCatalog(response.result);return response.result;}

elements.start.addEventListener('click',async () => {
  elements.start.disabled=true;elements.status.textContent='正在读取并保存当前页面已显示评论…';
  try {
    const response=await tabMessage(activeTabId,{ type:'START_CURRENT_PAGE_CAPTURE' });
    if (!response?.ok) throw new Error(response?.error ?? '采集失败。');
    const result=response.result;elements.status.textContent=`完成：读取 ${result.received} 条，新增 ${result.inserted} 条，去重 ${result.deduplicated} 条。`;
  } catch (error) { elements.status.textContent=`未采集：${error.message}`; }
  finally { elements.start.disabled=false; }
});
async function evidenceAction(type,extra={}){elements.status.textContent='正在处理人工搜索证据…';const response=await tabMessage(activeTabId,{type,...extra});if(!response?.ok)throw Object.assign(new Error(response?.error?.message??'证据操作失败'),{code:response?.error?.code});elements.status.textContent=`证据操作完成：${response.result?.status??response.result?.phase?.phase??''}`;return response.result;}
elements.evidenceBind.addEventListener('click',()=>evidenceAction('EVIDENCE_BIND_PAGE',{bindToken:elements.evidenceToken.value}).catch(error=>elements.status.textContent=`${error.code??'ERROR'}：${error.message}`));
elements.evidenceBefore.addEventListener('click',()=>evidenceAction('EVIDENCE_CAPTURE_BEFORE').catch(error=>elements.status.textContent=`${error.code??'ERROR'}：${error.message}`));
elements.evidenceAfter.addEventListener('click',()=>evidenceAction('EVIDENCE_CAPTURE_AFTER').catch(error=>elements.status.textContent=`${error.code??'ERROR'}：${error.message}`));

load();
