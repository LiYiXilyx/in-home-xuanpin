'use strict';
(() => {
 async function recognize(doc=globalThis.document,url=globalThis.location.href){
  const descriptor=globalThis.TemuCategoryPageDescriptor.parseCategoryPage(doc,url);
  const result=await new Promise((resolve,reject)=>chrome.runtime.sendMessage({type:'CREATE_CATEGORY_PROBE',payload:descriptor},response=>{
   if(chrome.runtime.lastError)reject(new Error(chrome.runtime.lastError.message));else if(!response?.ok)reject(new Error(response?.error?.message??'类目识别失败'));else resolve(response);
  }));return result.probe;
 }
 globalThis.TemuCategoryProbeAction=Object.freeze({recognize});
})();
