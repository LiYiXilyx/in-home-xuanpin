'use strict';

const API_BASE='http://127.0.0.1:37821/api/browser-extension';

chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
  if (!['GET_REVIEW_CONTEXT','SAVE_REVIEW_PAGE'].includes(message?.type)) return false;
  handleApiMessage(message).then(sendResponse).catch(error => sendResponse({ ok:false,error:error.message }));
  return true;
});

async function handleApiMessage(message) {
  const controller=new AbortController();
  const timeout=setTimeout(() => controller.abort(),8000);
  try {
    const options={ credentials:'omit',cache:'no-store',signal:controller.signal };
    let url=`${API_BASE}/context?goods_id=${encodeURIComponent(message.goodsId ?? '')}`;
    if (message.type === 'SAVE_REVIEW_PAGE') {
      url=`${API_BASE}/capture-page`;
      options.method='POST';
      options.headers={ 'Content-Type':'application/json' };
      options.body=JSON.stringify(message.payload ?? {});
    }
    const response=await fetch(url,options);
    const body=await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? `本地 API 返回 ${response.status}`);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接本地运营台超时，请确认 127.0.0.1:37821 已启动。');
    throw error;
  } finally { clearTimeout(timeout); }
}
