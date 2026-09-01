export function createYingdaoApi({fetchImpl=globalThis.fetch}={}){if(typeof fetchImpl!=='function')throw new Error('YingDao API缺少 fetch。');
  const request=async(path,options={})=>{assertSourcingPath(path);const response=await fetchImpl(path,{method:options.method??'GET',headers:{'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body)}),payload=await response.json();
    if(!response.ok){const error=new Error(payload?.error?.message??'YingDao 操作失败。');error.code=payload?.error?.code??'OPERATION_FAILED';throw error;}return payload;};
  return{
    settings:()=>request('/api/sourcing/settings'),currentImport:()=>request('/api/sourcing/imports/current'),
    saveSettings:body=>request('/api/sourcing/settings',{method:'PUT',body}),choosePath:kind=>request('/api/sourcing/path-dialog',{method:'POST',body:{kind}}),
    scan:()=>request('/api/sourcing/scan',{method:'POST',body:{}}),startImport:scanToken=>request('/api/sourcing/imports',{method:'POST',body:{scanToken}}),
    retryFailedImages:runId=>request(`/api/sourcing/imports/${encodeURIComponent(runId)}/retry-failed-images`,{method:'POST',body:{}}),
    reviewBootstrap:()=>request('/api/sourcing/review/bootstrap')
  };}
function assertSourcingPath(path){if(!String(path).startsWith('/api/sourcing/')){const error=new Error('YingDao API越界。');error.code='YINGDAO_API_NAMESPACE_INVALID';throw error;}}
