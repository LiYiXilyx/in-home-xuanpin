'use strict';

const elements={ goodsId:document.querySelector('#goods-id'),matched:document.querySelector('#matched'),cutoffDate:document.querySelector('#cutoff-date'),start:document.querySelector('#start'),status:document.querySelector('#status') };
let activeTabId=null;

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
