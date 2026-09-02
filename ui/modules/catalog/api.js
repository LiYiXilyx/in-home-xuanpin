export function createCatalogApi({fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw new Error('Catalog API缺少 fetch。');
  const request=async(path,options={})=>{
    assertCatalogPath(path);
    const method=options.method??'GET';
    const response=await fetchImpl(path,{method,headers:{'Content-Type':'application/json'},
      body:options.body===undefined?undefined:JSON.stringify(options.body)});
    const payload=await response.json();
    if(!response.ok){const error=new Error(payload?.error?.message??'Catalog 操作失败。');
      error.code=payload?.error?.code??'OPERATION_FAILED';error.details=payload?.error?.details??{};throw error;}
    return payload;
  };
  return{
    listProfiles:()=>request('/api/catalog/operator/profiles'),
    validateOperatorProfile:body=>request('/api/catalog/operator/category-profiles/validate',{method:'POST',body}),
    registerOperatorProfile:body=>request('/api/catalog/operator/category-profiles',{method:'POST',body}),
    currentCampaign:()=>request('/api/catalog/operator-campaign/current'),
    listClaimBlockers:()=>request('/api/catalog/operator/rpa-claim-blockers'),
    inspectClaim:(id,body)=>request(`/api/catalog/operator/rpa-claims/${encodeURIComponent(id)}/inspections`,{method:'POST',body}),
    endStaleClaim:(id,body)=>request(`/api/catalog/operator/rpa-claims/${encodeURIComponent(id)}/end-stale`,{method:'POST',body}),
    createExpansion:body=>request('/api/catalog/operator-campaigns',{method:'POST',body}),
    createInitial:body=>request('/api/catalog/operator/initial-campaigns',{method:'POST',body}),
    runInitialQa:(id,body)=>request(`/api/catalog/operator/initial-campaigns/${encodeURIComponent(id)}/qa-runs`,{method:'POST',body}),
    activateInitial:(id,body)=>request(`/api/catalog/operator/initial-campaigns/${encodeURIComponent(id)}/activate`,{method:'POST',body}),
    exportInitialPreview:(id,body)=>request(`/api/catalog/operator/initial-campaigns/${encodeURIComponent(id)}/preview-export`,{method:'POST',body}),
    exportFormalPool:(id,body)=>request(`/api/catalog/pools/${encodeURIComponent(id)}/export`,{method:'POST',body}),
    listPoolProducts:({poolVersionId,categoryKey,categoryProfileVersion})=>{const query=new URLSearchParams({
      category_key:String(categoryKey??''),category_profile_version:String(categoryProfileVersion??'')});
      return request(`/api/catalog/pools/${encodeURIComponent(String(poolVersionId??''))}/products?${query}`);}
  };
}

function assertCatalogPath(path){if(!String(path).startsWith('/api/catalog/')){const error=new Error('Catalog API越界。');
  error.code='CATALOG_API_NAMESPACE_INVALID';throw error;}}
