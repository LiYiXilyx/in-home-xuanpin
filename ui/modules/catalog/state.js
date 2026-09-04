const STATE_KEYS=new Set(['profiles','selectedProfile','currentCampaign','currentPool','quantityPolicy',
  'initialQa','activation','claimRecovery','onboarding','loading','error','mounted','lastRefreshedAt','categoryProbe']);

export function createCatalogState(){return{
  profiles:[],selectedProfile:null,currentCampaign:null,currentPool:null,quantityPolicy:null,initialQa:null,categoryProbe:null,
  activation:null,claimRecovery:{primaryBlocker:null,allBlockers:[],firstInspection:null,secondInspection:null},onboarding:{open:false,draft:null,validation:null,registered:null,profileSaved:false,campaignCreated:false},
  loading:{profiles:false,current:false,create:false,qa:false,activation:false,claim:false,onboardingValidate:false,onboardingSave:false,export:false},error:null,
  mounted:false,lastRefreshedAt:null
};}

export function patchCatalogState(state,patch={}){
  for(const key of Object.keys(patch))if(!STATE_KEYS.has(key))throw coded('CATALOG_STATE_KEY_INVALID',`Catalog state不允许字段：${key}`);
  Object.assign(state,patch);return state;
}

export function snapshotCatalogState(state){return deepFreeze(structuredClone(state));}

function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  for(const nested of Object.values(value))deepFreeze(nested);return Object.freeze(value);}
function coded(code,message){const error=new Error(message);error.code=code;return error;}
