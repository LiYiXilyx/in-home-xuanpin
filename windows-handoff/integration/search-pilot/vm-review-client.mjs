import {reviewPageStep} from './vm-review-page.mjs';
export function decodeVmValue(data){
  if(data.status!=='OK'||data.success===false)throw Error('VMLogin 接口失败：'+(data.message||data.status));
  let v=data.value;for(let i=0;i<4;i++){if(typeof v==='string'){try{v=JSON.parse(v);continue;}catch{break;}}
    const error=v?.result?.exceptionDetails||v?.exceptionDetails;const remote=v?.result?.result;
    if(error||remote?.subtype==='error'||v?.subtype==='error')throw Error(error?.exception?.description||error?.text||remote?.description||v.description);
    if(remote&&'value' in remote){v=remote.value;continue;}if(v?.type&&'value' in v){v=v.value;continue;}break;}
  return v;
}
export function createVmReviewClient({profileId='3059CDF2-1184-45B6-9938-A3E990EBCBE9',fetcher=fetch}={}){
  const base='http://127.0.0.1:35000/api/v1/profile';
  async function call(route,script){const post=script!==undefined;const r=await fetcher(base+route+(post?'':(route.includes('?')?'&':'?')+'profileId='+encodeURIComponent(profileId)),{...(post?{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({profileId,body:Buffer.from(script).toString('base64')})}:{}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('VMLogin HTTP '+r.status);const data=await r.json();if(data.status!=='OK'||data.success===false)throw Error('VMLogin 接口失败：'+(data.message||data.status));return data;}
  return {profileId,async open(goodsId){if(!/^\d{5,20}$/.test(goodsId))throw Error('商品 ID 无效');const state=await call('/page/pagestate');const current=new URL(state.baseURI);if(current.hostname!=='www.temu.com')throw Error('请先把 VMLogin 当前标签切到 Temu 商品页，以免跳转运营台');await call('/openurl?url='+encodeURIComponent('https://www.temu.com/de-en/goods.html?goods_id='+goodsId));},async step(goodsId,action){const value=decodeVmValue(await call('/ExecuteScript',`JSON.stringify((${reviewPageStep.toString()})(${JSON.stringify(goodsId)},${JSON.stringify(action)}))`));if(!value||typeof value.phase!=='string')throw Error('VMLogin 页面返回结果无效');return value;}};
}
