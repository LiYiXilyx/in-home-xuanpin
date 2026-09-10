const KINDS=Object.freeze({worker:'liveWorker',binding:'liveBinding',capture:'inFlightCapture',qa:'inFlightQa',activation:'inFlightActivation',excel_export:'inFlightExcelExport',source_runner:'liveSourceRunner'});

export function createCatalogActivityRegistry(){
  const entries=new Map();let sequence=0;
  function enter(scope,kind){const field=KINDS[kind];if(!field)throw new Error(`未知Catalog activity kind: ${kind}`);const key=scopeKey(scope),token=`catalog-activity-${++sequence}`;entries.set(token,{key,field});return token;}
  function leave(token){entries.delete(token);}
  function snapshot(scope){const key=scopeKey(scope),result=empty();for(const entry of entries.values())if(entry.key===key)result[entry.field]=true;return result;}
  async function run(scope,kind,fn){const token=enter(scope,kind);try{return await fn();}finally{leave(token);}}
  return {enter,leave,snapshot,run};
}
function scopeKey(scope){if(!scope?.campaignId||!scope?.queueId)throw new Error('Catalog activity需要明确campaignId和queueId。');return `${scope.campaignId}\u001f${scope.queueId}`;}
function empty(){return {liveWorker:false,liveBinding:false,inFlightCapture:false,inFlightQa:false,inFlightActivation:false,inFlightExcelExport:false,liveSourceRunner:false};}
