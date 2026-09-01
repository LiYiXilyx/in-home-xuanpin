export const REVIEW_V1_RUN_ID='yingdao_random5_v1_20260831_001';

export function createYingdaoApi({fetchImpl=globalThis.fetch}={}){if(typeof fetchImpl!=='function')throw new Error('YingDao API缺少 fetch。');
  const request=async(path,options={})=>{assertSourcingPath(path);const response=await fetchImpl(path,{method:options.method??'GET',headers:{'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)}),payload=await response.json();
    if(!response.ok){const error=new Error(payload?.error?.message??'YingDao 操作失败。');error.code=payload?.error?.code??'OPERATION_FAILED';throw error;}return payload;};
  const readCatalogPoolProducts=async({poolVersionId,categoryKey,categoryProfileVersion}={})=>{for(const [name,value] of Object.entries({poolVersionId,categoryKey,categoryProfileVersion}))if(!String(value??'').trim())throw coded('CATALOG_POOL_SCOPE_REQUIRED',`${name} is required`);
    const query=new URLSearchParams({category_key:String(categoryKey),category_profile_version:String(categoryProfileVersion)}),path=`/api/catalog/pools/${encodeURIComponent(String(poolVersionId))}/products?${query}`;
    const response=await fetchImpl(path,{method:'GET',headers:{'Content-Type':'application/json'}}),payload=await response.json();if(!response.ok)throw coded(payload?.error?.code??'OPERATION_FAILED',payload?.error?.message??'Catalog Pool读取失败。');return payload;};
  return{
    settings:()=>request('/api/sourcing/settings'),currentImport:()=>request('/api/sourcing/imports/current'),
    saveSettings:body=>request('/api/sourcing/settings',{method:'PUT',body}),choosePath:kind=>request('/api/sourcing/path-dialog',{method:'POST',body:{kind}}),
    scan:()=>request('/api/sourcing/scan',{method:'POST',body:{}}),startImport:scanToken=>request('/api/sourcing/imports',{method:'POST',body:{scanToken}}),
    retryFailedImages:runId=>request(`/api/sourcing/imports/${encodeURIComponent(runId)}/retry-failed-images`,{method:'POST',body:{}}),
    reviewBootstrap:(runId=REVIEW_V1_RUN_ID)=>request(`/api/sourcing/review/bootstrap?run_id=${encodeURIComponent(runId)}`),readCatalogPoolProducts
  };}
function assertSourcingPath(path){if(!String(path).startsWith('/api/sourcing/')){const error=new Error('YingDao API越界。');error.code='YINGDAO_API_NAMESPACE_INVALID';throw error;}}
function coded(code,message){const error=new Error(message);error.code=code;return error;}
