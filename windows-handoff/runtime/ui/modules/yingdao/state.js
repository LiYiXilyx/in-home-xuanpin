const STATE_KEYS=new Set(['currentRun','reviewRun','selectedTask','loading','error','progress','random5','imageCache','exportStatus','importStatus','scanStatus','reviewSummary','settings','scanToken','preview','mounted','lastRefreshedAt']);

export function createYingdaoState(){return{
  currentRun:null,reviewRun:null,selectedTask:null,loading:{settings:false,scan:false,import:false,retry:false,review:false},error:null,
  progress:{sourceFiles:0,validGoods:0,invalidFiles:0,parsedCandidates:0},random5:{candidates:0},
  imageCache:{success:0,failed:0},exportStatus:null,importStatus:null,scanStatus:'UNCONFIGURED',
  reviewSummary:{awaiting:0,confirmed:0,noSelection:0,totalGoods:0,candidates:0},settings:{},scanToken:null,
  preview:[],mounted:false,lastRefreshedAt:null
};}

export function patchYingdaoState(state,patch={}){for(const key of Object.keys(patch))if(!STATE_KEYS.has(key))throw coded('YINGDAO_STATE_KEY_INVALID',`YingDao state不允许字段：${key}`);Object.assign(state,patch);return state;}
export function snapshotYingdaoState(state){return deepFreeze(structuredClone(state));}
function deepFreeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;for(const nested of Object.values(value))deepFreeze(nested);return Object.freeze(value);}
function coded(code,message){const error=new Error(message);error.code=code;return error;}
