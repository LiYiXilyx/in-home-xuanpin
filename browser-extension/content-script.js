'use strict';

const BUTTON_ID='temu-current-review-capture-button';
let captureRunning=false;
let safetySignalReported=false;

function currentPage() {
  const goodsId=extractGoodsId(location.href);
  return { goodsId,url:location.href,isTemuProductPage:location.hostname === 'www.temu.com' && Boolean(goodsId) };
}

function extractGoodsId(value) {
  try { const url=new URL(value);return url.searchParams.get('goods_id')?.trim() || url.pathname.match(/-g-(\d+)\.html/i)?.[1] || null; } catch { return null; }
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
  let matchedContext=false;
  const report=message => { onStatus(message);showProgressNotice(message); };
  try {
    const page=currentPage();
    if (!page.isTemuProductPage) throw new Error('当前页面不是带 goods_id 的 Temu 商品页。');
    if (!globalThis.TemuReviewLoader) throw new Error('评论加载器未就绪。请在 chrome://extensions 重新加载扩展后刷新商品页。');
    report('正在核对运营台任务…');
    const lookup=await sendRuntimeMessage({ type:'GET_REVIEW_CONTEXT',goodsId:page.goodsId });
    if (!lookup?.ok) throw new Error(lookup?.error ?? '无法连接本地运营台。');
    if (!lookup.context?.matched) throw new Error('当前商品与运营台 Day9 评论任务不匹配。');
    matchedContext=true;

    let received=0,inserted=0,deduplicated=0,batches=0,cutoffReached=false;
    const result=await globalThis.TemuReviewLoader.loadReviews({
      cutoffDate:lookup.context.cutoffDate,
      startPageIndex:Number(lookup.context.pagesScanned ?? 0)+1,
      onStatus:report,
      onBatch:async (cards,pageIndex) => {
        report(`正在保存第 ${pageIndex} 批已显示评论…`);
        const saved=await sendRuntimeMessage({ type:'SAVE_REVIEW_BATCH',payload:{ goodsId:page.goodsId,sourceUrl:page.url,cards,pageIndex } });
        if (!saved?.ok) throw new Error(saved?.error ?? '保存评论失败。');
        batches+=1;received+=Number(saved.result.received ?? 0);inserted+=Number(saved.result.inserted ?? 0);deduplicated+=Number(saved.result.deduplicated ?? 0);
        cutoffReached=Boolean(saved.result.cutoffReached);
        return saved.result;
      }
    });
    const finalCutoffReached=cutoffReached || result.cutoffReached;
    const finished=await sendRuntimeMessage({ type:'FINISH_REVIEW_SCROLL',payload:{ goodsId:page.goodsId,sourceUrl:page.url,stopReason:result.stopReason,cutoffReached:finalCutoffReached,lastPageIndex:result.lastPageIndex } });
    if (!finished?.ok) throw new Error(finished?.error ?? '保存评论结束状态失败。');
    report(`完成：加载 ${batches} 批，读取 ${received} 条，新增 ${inserted} 条，去重 ${deduplicated} 条。${finalCutoffReached ? '已遇到早于 cutoff 的评论，已停止。':'Temu 在 cutoff 前已无更多可加载评论，已记录为部分完成。'}`);
    return { ...result,received,inserted,deduplicated,batches,cutoffReached:finalCutoffReached,completion:finished.result };
  } catch (error) {
    const errorCode=String(error?.code ?? 'EXTENSION_CAPTURE_FAILED');
    const manualVerification=errorCode === 'MANUAL_VERIFICATION_REQUIRED';
    const message=manualVerification ? `等待人工验证：${error.message}`:`未采集：${error.message}`;
    const page=currentPage();
    if (matchedContext && page.goodsId) await sendRuntimeMessage({ type:'FAIL_REVIEW_CAPTURE',payload:{ goodsId:page.goodsId,errorCode,errorMessage:error.message } }).catch(() => {});
    showOperatorNotice(message,manualVerification);onStatus(message);throw error;
  } finally { captureRunning=false; }
}

function showProgressNotice(message) {
  let notice=document.getElementById('temu-review-capture-progress');
  if (!notice) {
    notice=document.createElement('div');notice.id='temu-review-capture-progress';notice.setAttribute('role','status');
    Object.assign(notice.style,{ all:'initial',position:'fixed',right:'18px',bottom:'76px',zIndex:'2147483647',width:'340px',boxSizing:'border-box',padding:'11px 13px',borderRadius:'8px',background:'#172033',color:'#fff',font:'14px/1.45 system-ui,sans-serif',boxShadow:'0 3px 12px rgba(0,0,0,.3)',wordBreak:'break-word' });
    document.documentElement.append(notice);
  }
  notice.textContent=message;
}

function showOperatorNotice(message,recoverable=false) {
  const existing=document.getElementById('temu-review-capture-notice');existing?.remove();
  const notice=document.createElement('div');notice.id='temu-review-capture-notice';notice.setAttribute('role','alert');notice.textContent=message;
  Object.assign(notice.style,{ position:'fixed',right:'20px',bottom:'78px',zIndex:'2147483647',maxWidth:'380px',padding:'12px 14px',borderRadius:'8px',background:recoverable ? '#92400e':'#7f1d1d',color:'#fff',fontSize:'14px',lineHeight:'1.45',boxShadow:'0 3px 12px rgba(0,0,0,.28)' });
  document.documentElement.append(notice);setTimeout(() => notice.remove(),recoverable ? 30000:12000);
}

function installCaptureButton() {
  if (document.getElementById(BUTTON_ID)) return;
  const button=document.createElement('button');button.id=BUTTON_ID;button.type='button';button.textContent='采集当前商品评论';button.title='仅读取当前页面已经显示的公开评论';
  Object.assign(button.style,{ all:'initial',position:'fixed',right:'18px',bottom:'18px',zIndex:'2147483646',boxSizing:'border-box',padding:'11px 15px',border:'0',borderRadius:'8px',background:'#f97316',color:'#fff',font:'700 14px/1.3 system-ui,sans-serif',cursor:'pointer',boxShadow:'0 2px 10px rgba(0,0,0,.25)' });
  button.addEventListener('click',async () => { button.disabled=true;try { await captureCurrentPage(message => { button.textContent=message.slice(0,42); }); } catch {} finally { button.disabled=false;button.textContent='采集当前商品评论'; } });
  document.documentElement.append(button);
}

async function reportStrongReviewSafetySignal() {
  if (location.hostname !== 'www.temu.com' || safetySignalReported) return;
  const bodyText=(document.body?.innerText ?? '').slice(0,12000);let code=null;
  if (/Oops! The items are gone\.|Try again to find items/i.test(bodyText)) code='ITEMS_GONE';
  else if (/bgn_verification|captcha|verify you are human|security verification/i.test(`${location.href}\n${bodyText}`)) code='CAPTCHA';
  else if (/\/login\.html/i.test(location.pathname)) code='LOGIN_REQUIRED';
  if (!code) return;
  safetySignalReported=true;
  try {
    const current=await sendRuntimeMessage({ type:'GET_REVIEW_QUEUE_CURRENT' });const item=current?.result?.item;
    if (!item || !['opening','waiting_operator','capturing'].includes(item.status)) return;
    const reported=await sendRuntimeMessage({ type:'REPORT_REVIEW_SAFETY',payload:{ queueId:item.id,goodsId:item.goodsId,code,
      evidence:{ url:location.href,pageTitle:document.title,source:'business_extension' } } });
    if (reported?.ok !== false) {
      showOperatorNotice('Review 导航已安全熔断：等待冷却并完成人工恢复检查。',true);
    }
  } catch { safetySignalReported=false; }
}

chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
  const manualActions={GET_MANUAL_CAPTURE_STATE:null,MANUAL_DETECT_CURRENT:'detectCurrentPage',MANUAL_BIND_CURRENT:'bindCurrentPage',MANUAL_CAPTURE_CURRENT:'captureCurrentPage'};
  if (Object.hasOwn(manualActions,message?.type)) {
    const runner=globalThis.TemuCatalogManualPassiveRunner;if(!runner){sendResponse({ok:false,error:{code:'MANUAL_RUNNER_NOT_READY',message:'Manual Bind Runner 未就绪。'}});return undefined;}
    const method=manualActions[message.type];if(!method){sendResponse({ok:true,result:runner.snapshot()});return undefined;}
    runner[method]().then(result=>sendResponse({ok:true,result})).catch(error=>sendResponse({ok:false,error:{code:error.code,message:error.message}}));return true;
  }
  if(message?.type==='YINGDAO_EXPORT_SEAM'){const context=globalThis.TemuCatalogManualPassiveRunner?.context;sendResponse({ok:true,result:{integrationSeam:'YingDao Task Export V1',categoryKey:context?.campaign?.categoryKey??null,poolVersionId:context?.poolVersionId??null}});return undefined;}
  if (message?.type === 'GET_CURRENT_PAGE') {
    sendResponse(currentPage());
    return undefined;
  }
  if (message?.type === 'START_CATALOG_CAPTURE') {
    if (!globalThis.TemuCatalogCapture) { sendResponse({ ok:false,error:'Catalog采集模块未就绪。' });return undefined; }
    globalThis.TemuCatalogCapture.capture({ campaignId:message.campaignId,sourceId:message.sourceId,batchId:message.batchId })
      .then(result => sendResponse({ ok:true,result })).catch(error => sendResponse({ ok:false,error:{ code:error.code,message:error.message } }));
    return true;
  }
  if (message?.type !== 'START_CURRENT_PAGE_CAPTURE') return undefined;
  captureCurrentPage().then(result => sendResponse({ ok:true,result })).catch(error => sendResponse({ ok:false,error:error.message }));
  return true;
});

if (currentPage().isTemuProductPage && !document.getElementById('temu-catalog-operator-overlay')) installCaptureButton();
setTimeout(reportStrongReviewSafetySignal,1500);
if(location.hostname==='www.temu.com')globalThis.TemuMarketEvidence?.mount();
