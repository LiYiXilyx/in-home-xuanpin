'use strict';

const BUTTON_ID='temu-current-review-capture-button';
let captureRunning=false;

function currentPage() {
  const goodsId=extractGoodsId(location.href);
  return { goodsId,url:location.href,isTemuProductPage:location.hostname === 'www.temu.com' && Boolean(goodsId) };
}

function extractGoodsId(value) {
  try {
    const url=new URL(value);
    return url.searchParams.get('goods_id')?.trim() || url.pathname.match(/-g-(\d+)\.html/i)?.[1] || null;
  } catch { return null; }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve,reject) => chrome.runtime.sendMessage(message,response => {
    const error=chrome.runtime.lastError;
    if (error) reject(new Error(error.message)); else resolve(response);
  }));
}

async function captureCurrentPage(onStatus=() => {}) {
  if (captureRunning) return;
  captureRunning=true;
  try {
    const page=currentPage();
    if (!page.isTemuProductPage) throw new Error('当前页面不是带 goods_id 的 Temu 商品页。');
    onStatus('正在核对运营台任务…');
    const lookup=await sendRuntimeMessage({ type:'GET_REVIEW_CONTEXT',goodsId:page.goodsId });
    if (!lookup?.ok) throw new Error(lookup?.error ?? '无法连接本地运营台。');
    if (!lookup.context?.matched) throw new Error('当前商品与运营台 Day9 评论任务不匹配。');
    onStatus('正在读取当前页面已显示评论…');
    const cards=collectVisibleReviewCards();
    const saved=await sendRuntimeMessage({ type:'SAVE_REVIEW_PAGE',payload:{ goodsId:page.goodsId,sourceUrl:page.url,cards,pageIndex:lookup.context.pagesScanned+1 } });
    if (!saved?.ok) throw new Error(saved?.error ?? '保存评论失败。');
    const result=saved.result;
    onStatus(`完成：读取 ${result.received} 条，新增 ${result.inserted} 条，去重 ${result.deduplicated} 条。`);
    return result;
  } catch (error) {
    onStatus(`未采集：${error.message}`);
    throw error;
  } finally { captureRunning=false; }
}

function collectVisibleReviewCards() {
  const selectors=['[data-testid*="review" i]','[data-review-id]','[class*="review-item" i]','[class*="comment-item" i]'];
  const nodes=[...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
    .filter(node => node instanceof HTMLElement && node.offsetParent !== null && node.innerText.trim().length >= 5)
    .filter(node => !nodesContainCandidateAncestor(node,selectors)).slice(0,200);
  return nodes.map(node => {
    const rawText=node.innerText.trim().slice(0,5000);
    const ratingNode=node.querySelector('[aria-label*="star" i],[aria-label*="out of 5" i],[data-rating]');
    const contentNode=node.querySelector('[data-testid*="content" i],[class*="content" i],[class*="text" i]');
    const dateNode=node.querySelector('time,[data-testid*="date" i],[class*="date" i]');
    return {
      reviewId:node.getAttribute('data-review-id') || node.id || null,
      ratingText:ratingNode?.getAttribute('aria-label') || ratingNode?.getAttribute('data-rating') || rawText,
      contentText:contentNode?.textContent?.trim() || rawText,
      dateText:dateNode?.getAttribute('datetime') || dateNode?.textContent?.trim() || rawText,
      sku:node.querySelector('[class*="sku" i],[class*="variant" i]')?.textContent?.trim() || null,
      country:node.querySelector('[class*="country" i]')?.textContent?.trim() || null,
      imageUrls:[...node.querySelectorAll('img[src]')].map(image => image.currentSrc || image.src).filter(Boolean).slice(0,20),
      rawText
    };
  });
}

function nodesContainCandidateAncestor(node,selectors) {
  return selectors.some(selector => node.parentElement?.closest(selector));
}

function injectCaptureButton() {
  if (!currentPage().isTemuProductPage || document.getElementById(BUTTON_ID)) return;
  const button=document.createElement('button');
  button.id=BUTTON_ID;button.type='button';button.textContent='采集当前商品评论';
  Object.assign(button.style,{ position:'fixed',right:'20px',bottom:'20px',zIndex:'2147483647',padding:'12px 18px',border:'0',borderRadius:'8px',background:'#ff5a1f',color:'#fff',fontSize:'14px',fontWeight:'700',boxShadow:'0 3px 12px rgba(0,0,0,.25)',cursor:'pointer' });
  button.addEventListener('click',() => captureCurrentPage(status => { button.textContent=status;button.disabled=captureRunning; }).catch(() => {}).finally(() => { setTimeout(() => { button.textContent='采集当前商品评论';button.disabled=false; },3000); }));
  document.documentElement.append(button);
}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
  if (message?.type === 'GET_CURRENT_PAGE') { sendResponse(currentPage());return false; }
  if (message?.type === 'START_CURRENT_PAGE_CAPTURE') {
    captureCurrentPage().then(result => sendResponse({ ok:true,result })).catch(error => sendResponse({ ok:false,error:error.message }));
    return true;
  }
  return false;
});

injectCaptureButton();
