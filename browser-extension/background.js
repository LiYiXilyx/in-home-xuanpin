'use strict';

const API_BASE='http://127.0.0.1:37821/api/browser-extension';
const CATALOG_API_BASE='http://127.0.0.1:37821/api/catalog';
const CATALOG_RPA_API_BASE='http://127.0.0.1:37821/api/catalog-rpa';

chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
  if (!['GET_REVIEW_CONTEXT','SAVE_REVIEW_PAGE','SAVE_REVIEW_BATCH','FINISH_REVIEW_SCROLL','FAIL_REVIEW_CAPTURE','GET_CATALOG_CONTEXT','GET_CATALOG_CURRENT','SAVE_CATALOG_BATCH','GET_CATALOG_STATUS','SAVE_CATALOG_CHECKPOINT','CATALOG_MANUAL_REQUIRED','RESUME_CATALOG_RUNNER'].includes(message?.type)) return false;
  handleApiMessage(message).then(sendResponse).catch(error => sendResponse({ ok:false,error:error.message,errorCode:error.code }));
  return true;
});

async function handleApiMessage(message) {
  const controller=new AbortController();
  const timeout=setTimeout(() => controller.abort(),8000);
  try {
    const options={ credentials:'omit',cache:'no-store',signal:controller.signal };
    if (message.type==='GET_CATALOG_CONTEXT') {
      const url=`${CATALOG_API_BASE}/context?campaign_id=${encodeURIComponent(message.campaignId ?? '')}&source_id=${encodeURIComponent(message.sourceId ?? '')}`;
      return await request(url,options);
    }
    if (message.type==='GET_CATALOG_CURRENT') return await request(`${CATALOG_RPA_API_BASE}/current-context`,options);
    if (message.type==='GET_CATALOG_STATUS') {
      const url=`${CATALOG_API_BASE}/status?campaign_id=${encodeURIComponent(message.campaignId ?? '')}`;
      return await request(url,options);
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

async function request(url,options) {
  const response=await fetch(url,options);const body=await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) { const error=new Error(body.error?.message ?? `本地 API 返回 ${response.status}`);error.code=body.error?.code;throw error; }
  return body;
}
