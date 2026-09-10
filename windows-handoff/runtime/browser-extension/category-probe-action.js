'use strict';
(() => {
 async function recognize(doc=globalThis.document,url=globalThis.location.href){
  let descriptor;
  try{descriptor=globalThis.TemuCategoryPageDescriptor.parseCategoryPage(doc,url);}catch(error){
   const messages={CATEGORY_MARKET_MISMATCH:'未确认 Germany / English / EUR：请检查站点、语言和商品价格币种。',CATEGORY_SORT_MISMATCH:'当前不是 Top Sales 排序，请在 Temu 人工切换为 Top Sales 后重新识别。',UNSUPPORTED_CATEGORY_CAPTURE_PAGE:'请打开 Temu 商品类目列表页，再识别当前类目。'};
   if(messages[error.code])error.message=messages[error.code];throw error;
  }
  const result=await new Promise((resolve,reject)=>chrome.runtime.sendMessage({type:'CREATE_CATEGORY_PROBE',payload:descriptor},response=>{
   if(chrome.runtime.lastError)reject(new Error(chrome.runtime.lastError.message));else if(!response?.ok)reject(new Error(response?.error?.message??'类目识别失败'));else resolve(response);
  }));return result.probe;
 }
 globalThis.TemuCategoryProbeAction=Object.freeze({recognize});
})();
