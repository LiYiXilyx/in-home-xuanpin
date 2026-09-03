'use strict';

const API_BASE='http://127.0.0.1:37821/api/browser-extension';
const CATALOG_API_BASE='http://127.0.0.1:37821/api/catalog';
const CATALOG_RPA_API_BASE='http://127.0.0.1:37821/api/catalog-rpa';

chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  if (!['EVIDENCE_BIND_TOKEN','EVIDENCE_CAPTURE_VISIBLE','EVIDENCE_SAVE_PHASE','GET_REVIEW_CONTEXT','GET_REVIEW_QUEUE_CURRENT','REPORT_REVIEW_SAFETY','SAVE_REVIEW_PAGE','SAVE_REVIEW_BATCH','FINISH_REVIEW_SCROLL','FAIL_REVIEW_CAPTURE','GET_CATALOG_CONTEXT','GET_CATALOG_CURRENT','SAVE_CATALOG_BATCH','GET_CATALOG_STATUS','SAVE_CATALOG_CHECKPOINT','CATALOG_MANUAL_REQUIRED','RESUME_CATALOG_RUNNER'].includes(message?.type)) return false;
  handleApiMessage(message,sender).then(sendResponse).catch(error => sendResponse({ ok:false,error:{message:error.message,code:error.code},errorCode:error.code }));
  return true;
});

async function handleApiMessage(message,sender) {
  const controller=new AbortController();
  const timeout=setTimeout(() => controller.abort(),8000);
  try {
    const options={ credentials:'omit',cache:'no-store',signal:controller.signal };
    if(message.type==='EVIDENCE_CAPTURE_VISIBLE')return {ok:true,result:{dataUrl:await chrome.tabs.captureVisibleTab(sender.tab.windowId,{format:'png'})}};
    if(message.type==='EVIDENCE_BIND_TOKEN'){const payload={...(message.payload??{}),tab_identity_hash:await sha256(`${chrome.runtime.id}:${sender.tab.id}`)};return request('http://127.0.0.1:37821/api/sourcing/review/evidence-extension/bind-token/consume',{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
    if(message.type==='EVIDENCE_SAVE_PHASE'){const payload={...(message.payload??{}),tab_identity_hash:await sha256(`${chrome.runtime.id}:${sender.tab.id}`)};return request(`http://127.0.0.1:37821/api/sourcing/review/evidence-extension/goods/${encodeURIComponent(payload.anchor_temu_goods_id)}/sessions/${encodeURIComponent(payload.session_id)}/phases/${encodeURIComponent(payload.phase)}`,{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});}
    if (message.type==='GET_CATALOG_CONTEXT') {
      const url=`${CATALOG_API_BASE}/context?campaign_id=${encodeURIComponent(message.campaignId ?? '')}&source_id=${encodeURIComponent(message.sourceId ?? '')}`;
      return await request(url,options);
    }
    if (message.type==='GET_CATALOG_CURRENT') return await request(`${CATALOG_RPA_API_BASE}/current-context`,options);
    if (message.type==='GET_CATALOG_STATUS') {
      const url=`${CATALOG_API_BASE}/status?campaign_id=${encodeURIComponent(message.campaignId ?? '')}`;
      return await request(url,options);
    }
    if (message.type==='GET_REVIEW_QUEUE_CURRENT') return await request('http://127.0.0.1:37821/api/rpa/review-queue/current',options);
    if (message.type==='REPORT_REVIEW_SAFETY') {
      const queueId=encodeURIComponent(message.payload?.queueId ?? '');
      return await request(`http://127.0.0.1:37821/api/rpa/review-queue/${queueId}/safety/signal`,
        { ...options,method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(message.payload ?? {}) });
    }
    if (message.type==='SAVE_CATALOG_BATCH') {
      return await request(`${CATALOG_API_BASE}/batches`,{ ...options,method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(message.payload ?? {}) });
    }
    const extensionRoute={ SAVE_CATALOG_CHECKPOINT:'checkpoint',CATALOG_MANUAL_REQUIRED:'manual-required',RESUME_CATALOG_RUNNER:'resume' }[message.type];
    if (extensionRoute) return await request(`http://127.0.0.1:37821/api/catalog-extension/${extensionRoute}`,
      { ...options,method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(message.payload ?? {}) });
    let url=`${API_BASE}/context?goods_id=${encodeURIComponent(message.goodsId ?? '')}`;
    if (message.type !== 'GET_REVIEW_CONTEXT') {
      const route={ SAVE_REVIEW_PAGE:'capture-page',SAVE_REVIEW_BATCH:'capture-batch',FINISH_REVIEW_SCROLL:'complete-scroll',FAIL_REVIEW_CAPTURE:'capture-failed' }[message.type];
      url=`${API_BASE}/${route}`;
      options.method='POST';
      options.headers={ 'Content-Type':'application/json' };
      options.body=JSON.stringify(message.payload ?? {});
    }
    return await request(url,options);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接本地运营台超时，请确认 127.0.0.1:37821 已启动。');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function sha256(value){const bytes=new TextEncoder().encode(value),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}

async function request(url,options) {
  const response=await fetch(url,options);const body=await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) { const error=new Error(body.error?.message ?? `本地 API 返回 ${response.status}`);error.code=body.error?.code;throw error; }
  return body;
}
