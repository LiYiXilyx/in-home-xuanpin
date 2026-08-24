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
    if (hasReviewGuidelineDialog()) {
      const message='Temu 正在显示“评价规则”说明。请先手动点击 OK 或右上角关闭，再点击采集；扩展不会自动关闭该说明。';
      showOperatorNotice(message);
      throw new Error(message);
    }
    onStatus('正在读取当前页面已显示评论…');
    let cards=collectVisibleReviewCards();
    if (!cards.length) {
      const opened=await openVisibleReviews();
      if (opened) {
        onStatus('已展开评论区域，正在读取…');
        await waitForPageUpdate();
        cards=collectVisibleReviewCards();
      }
    }
    if (!cards.length) {
      const message='未发现已显示的具体评论。请向下滚动到 Customer reviews，点击 See all / View all reviews，确认评论内容出现后再点击采集。';
      showOperatorNotice(message);
      throw new Error(message);
    }
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

async function openVisibleReviews() {
  const controls=[...document.querySelectorAll('button,[role="button"],a')]
    .filter(node => node instanceof HTMLElement && node.offsetParent !== null)
    .filter(node => /^(?:see all|view all|all)\s+reviews?\b/i.test(node.innerText.trim()))
    .slice(0,1);
  const control=controls[0];
  if (!control) return false;
  control.scrollIntoView({ block:'center',behavior:'smooth' });
  await new Promise(resolve => setTimeout(resolve,250));
  control.click();
  return true;
}

function waitForPageUpdate() { return new Promise(resolve => setTimeout(resolve,1200)); }

function showOperatorNotice(message) {
  const existing=document.getElementById('temu-review-capture-notice');
  existing?.remove();
  const notice=document.createElement('div');
  notice.id='temu-review-capture-notice';notice.setAttribute('role','alert');notice.textContent=message;
  Object.assign(notice.style,{ position:'fixed',right:'20px',bottom:'78px',zIndex:'2147483647',maxWidth:'360px',padding:'12px 14px',borderRadius:'8px',background:'#7f1d1d',color:'#fff',fontSize:'14px',lineHeight:'1.45',boxShadow:'0 3px 12px rgba(0,0,0,.28)' });
  document.documentElement.append(notice);
  setTimeout(() => notice.remove(),12000);
}

function collectVisibleReviewCards() {
  const selectors=['[data-testid*="review" i]','[data-review-id]','[class*="review-item" i]','[class*="comment-item" i]'];
  const selectorNodes=selectors.flatMap(selector => [...document.querySelectorAll(selector)]);
  const nodes=[...new Set([...selectorNodes,...collectDateBasedReviewCards()])]
    .filter(node => node instanceof HTMLElement && node.offsetParent !== null && node.innerText.trim().length >= 5)
    .filter(node => !nodesContainCandidateAncestor(node,selectors)).slice(0,200);
  return nodes.map(node => {
    const rawText=node.innerText.trim().slice(0,5000);
    const ratingNode=node.querySelector('[aria-label*="star" i],[aria-label*="out of 5" i],[data-rating]');
    const contentNode=node.querySelector('[data-testid*="content" i],[class*="content" i],[class*="text" i]');
    const dateNode=node.querySelector('time,[data-testid*="date" i],[class*="date" i]');
    return {
      reviewId:node.getAttribute('data-review-id') || node.id || null,
      ratingText:inferRatingText(ratingNode,rawText),
      contentText:contentNode?.textContent?.trim() || rawText,
      dateText:dateNode?.getAttribute('datetime') || dateNode?.textContent?.trim() || rawText,
      sku:node.querySelector('[class*="sku" i],[class*="variant" i]')?.textContent?.trim() || null,
      country:node.querySelector('[class*="country" i]')?.textContent?.trim() || null,
      imageUrls:[...node.querySelectorAll('img[src]')].map(image => image.currentSrc || image.src).filter(Boolean).slice(0,20),
      rawText
    };
  });
}

function collectDateBasedReviewCards() {
  const datePattern=/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b/i;
  const dateNodes=[...document.querySelectorAll('div,li,article,span,p')]
    .filter(node => node instanceof HTMLElement && node.offsetParent !== null && datePattern.test(node.innerText));
  return [...new Set(dateNodes.map(node => reviewContainerForDate(node,datePattern)).filter(Boolean))];
}

function reviewContainerForDate(node,datePattern) {
  let current=node;
  let best=null;
  for (let depth=0;current && depth<8;depth+=1,current=current.parentElement) {
    const text=current.innerText?.trim() ?? '';
    const matches=text.match(new RegExp(datePattern.source,'ig')) ?? [];
    if (matches.length > 1) break;
    if (matches.length === 1 && text.length >= 25 && text.length <= 5_000) best=current;
  }
  return best;
}

function inferRatingText(ratingNode,rawText) {
  const explicit=ratingNode?.getAttribute('aria-label') || ratingNode?.getAttribute('data-rating');
  if (explicit) return explicit;
  const stars=(String(rawText).match(/★/g) ?? []).length;
  if (stars >= 1 && stars <= 5) return `${stars} out of 5 stars`;
  const named=String(rawText).match(/\b(excellent|good|average|poor|bad)\b/i)?.[1]?.toLowerCase();
  const values={ excellent:5,good:4,average:3,poor:2,bad:1 };
  return named ? `${values[named]} out of 5 stars`:rawText;
}

function hasReviewGuidelineDialog() {
  return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')]
    .some(node => node instanceof HTMLElement && node.offsetParent !== null
      && /all reviews are from customers who have purchased this item from temu/i.test(node.innerText));
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
