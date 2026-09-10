// Tracks handler lifetime, including work continuing after client disconnect.
// Detached workers are outside this process-local contract.
export function createRuntimeLifecycle(router){
  let draining=false,activeRequests=0;
  const waiters=new Set();
  const snapshot=()=>({service:'temu-operator-dashboard',scope:'PROCESS_ONLY',draining,activeRequests});
  function drain(){
    draining=true;
    return activeRequests===0?Promise.resolve():new Promise(resolve=>waiters.add(resolve));
  }
  async function handle(request,response){
    if(draining){response.writeHead(503,{'Content-Type':'application/json','Connection':'close'});response.end(JSON.stringify({ok:false,error:{code:'DASHBOARD_DRAINING'}}));return;}
    if(request.method==='GET'&&request.url.split('?')[0]==='/api/runtime/activity'){
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify(snapshot()));return;
    }
    activeRequests++;
    try{return await router(request,response);}
    finally{activeRequests--;if(activeRequests===0){for(const resolve of waiters)resolve();waiters.clear();}}
  }
  return {handle,snapshot,drain};
}
