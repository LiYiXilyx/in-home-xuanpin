import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createVmAdapter,validateCategoryUrl} from './catalog-vm-adapter.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function createCatalogControl({root,adapter=createVmAdapter(),otherBusy=()=>false,wait=sleep,now=Date.now}={}){
 fs.mkdirSync(root,{recursive:true});let active=false,task=null,stop=false,paused=false,ready=null;
 let state={status:'IDLE',screens:0,added:0,count:0,message:'请先创建采集任务，再检测类目页面。',profile:adapter.profile};
 try{state={...state,...JSON.parse(fs.readFileSync(path.join(root,'latest.json'),'utf8'))};if(['RUNNING','PAUSED','DETECTING','READY','STOPPING'].includes(state.status))state={...state,status:'INTERRUPTED',message:'服务已重启，请重新检测绑定；已保存商品保留。'};}catch{}
 function save(){state.updatedAt=new Date(now()).toISOString();fs.writeFileSync(path.join(root,'latest.json'),JSON.stringify(state,null,2));if(state.id)fs.writeFileSync(path.join(root,state.id+'.json'),JSON.stringify(state,null,2));}
 function update(patch){Object.assign(state,patch);save();}
 function assertPage(s){if(s.url!==state.url||!s.category)throw Error('页面地址或类目已变化，请重新检测');if(s.captcha||s.blocked)throw Error('页面出现验证码或访问限制，已停止，请人工处理');}
 function stopped(){return stop||(state.deadline&&now()>=state.deadline);}
 async function checkpoint(){while(paused&&!stopped())await wait(250);if(stopped())throw Object.assign(Error(stop?'已停止，已保存商品保留':'达到最长运行时间'),{code:'STOP'});}
 async function delay(ms){for(let left=ms;left>0;left-=250){await checkpoint();await wait(Math.min(left,250));}await checkpoint();}
 async function inspect(){await checkpoint();const s=await adapter.inspect(state.url);assertPage(s);return s;}
 async function stable(before,{requireNew=false}={}){let previous='',matches=0;const ids=new Set(before?.ids||[]);for(let i=0;i<30;i++){await delay(500);const s=await inspect();if(s.retry)return s;const valid=s.ids.length&&!s.loading&&!s.empty&&(!requireNew||s.ids.some(id=>!ids.has(id)));matches=valid&&s.signature===previous?matches+1:0;previous=s.signature;if(matches>=3)return s;}throw Error('等待商品加载稳定超时，已保存数据保留；请检查页面后重新检测。');}
 async function recover(s){if(!s.retry)return s;if(state.retryUsed){paused=true;update({status:'PAUSED',message:'自动重试已用完，请手动恢复页面后点击继续。'});await checkpoint();s=await inspect();if(s.retry)throw Error('页面仍显示 Try again，请人工恢复加载');return stable(s);}
  update({retryUsed:true,message:'遇到 Try again，等待10秒后仅重试一次'});await delay(10000);const current=await inspect();if(current.retry){await checkpoint();await adapter.click(state.url,'Try again');s=await stable(current,{requireNew:true});}else s=await stable(current);if(s.retry)return recover(s);return s;
 }
 function launch(fn){active=true;stop=false;paused=false;task=(async()=>{try{await fn();}catch(e){ready=null;update({status:e.code==='STOP'?'STOPPED':'ERROR',message:e.message||'页面操作失败，请确认 VMLogin 当前为商品页且独立插件已更新',finishedAt:new Date(now()).toISOString()});}finally{active=false;paused=false;save();}})();}
 async function run(options){
  const origin=ready.count;update({status:'RUNNING',id:crypto.randomUUID(),screens:0,added:0,count:origin,retryUsed:false,startedAt:new Date(now()).toISOString(),finishedAt:null,deadline:now()+options.minutes*60000,target:options.target,intervalSeconds:6,message:'等待页面稳定'});
  let stalled=0,s=await stable(null);
  while(true){await checkpoint();s=await recover(s);if(s.empty)throw Error('页面没有可采集商品');if(s.campaignId!==ready.campaignId)throw Error('采集任务已变化，请重新检测');
   await checkpoint();update({message:'正在解析并保存当前页面商品'});const saved=await adapter.capture(state.url,ready.campaignId);assertPage(saved);if(saved.campaignId!==ready.campaignId)throw Error('采集任务已变化');
   update({screens:state.screens+1,count:saved.count,added:Math.max(0,saved.count-origin),message:'本轮商品已保存'});
   if((options.target>0&&state.added>=options.target)||saved.runnerState==='TARGET_REACHED'){update({status:'DONE',message:'达到新增目标或采集任务目标',finishedAt:new Date(now()).toISOString()});ready=null;return;}
   await delay(6000);s=await recover(await inspect());
   if(s.more){update({message:'点击 See more，等待新增商品稳定'});await checkpoint();await adapter.click(state.url,'See more');s=await recover(await stable(s,{requireNew:true}));stalled=0;}
   const before=s.y;await checkpoint();await adapter.scroll(state.url);s=await stable(s);stalled=Math.abs(s.y-before)<2?stalled+1:0;
   if(stalled>=3){update({status:'DONE',message:'页面连续三次无法继续滚动，已结束；不代表所有商品均已采集。',finishedAt:new Date(now()).toISOString()});ready=null;return;}
  }
 }
 return {busy:()=>active,status:()=>({...state,active,paused,canStart:!active&&Boolean(ready)}),settled:()=>task,
  act(action,body={}){
   if(action==='pause'){if(!active||state.status!=='RUNNING')throw Error('当前不在采集中');paused=true;update({status:'PAUSED',message:'已请求暂停，当前接口返回后的检查点生效'});return this.status();}
   if(action==='resume'){if(!active||!paused)throw Error('当前没有暂停的任务');paused=false;update({status:'RUNNING',message:'继续前重新检查页面'});return this.status();}
   if(action==='stop'){if(!active)throw Error('当前没有运行的任务');stop=true;paused=false;update({status:'STOPPING',message:'正在停止，等待当前接口返回'});return this.status();}
   if(active)throw Error('已有类目操作进行中');if(otherBusy())throw Error('自动截图队列正在运行，请结束后再进行类目采集');
   if(action==='detect'){
    const requested=body.url?.trim()?validateCategoryUrl(body.url.trim()):null;ready=null;state={status:'DETECTING',id:crypto.randomUUID(),screens:0,added:0,count:0,profile:adapter.profile,message:'正在连接 VMLogin 并检测绑定类目页面'};save();
    launch(async()=>{if(requested){state.url=requested;update({message:'正在 VMLogin 打开类目页面'});await adapter.open(requested);await delay(3000);let opened=false;for(let attempt=0;attempt<15;attempt++){await checkpoint();try{const actual=await adapter.current();if(new URL(actual).pathname===new URL(requested).pathname){state.url=actual;opened=true;break;}}catch{}await delay(1000);}if(!opened)throw Error('VMLogin 没有停留在目标类目页。请在普通浏览器打开控制台，保持 VMLogin 显示 Temu 商品页。');}else state.url=await adapter.current();await checkpoint();update({message:'页面已打开，正在连接独立采集插件（最多45秒）'});const s=await adapter.inspect(state.url);assertPage(s);if(s.retry||s.empty)throw Error('页面加载失败，请恢复后再检测');await checkpoint();update({message:'独立插件已连接，正在检查采集任务并绑定'});ready=await adapter.prepare(state.url);assertPage(ready);await checkpoint();update({status:'READY',count:ready.count,campaignId:ready.campaignId,message:'检测绑定通过，可以开始采集'});});return this.status();
   }
   if(action==='start'){if(!ready)throw Error('请先检测并绑定页面');const minutes=Number(body.minutes??30),target=Number(body.target??300);if(!Number.isFinite(minutes)||minutes<1||minutes>240||!Number.isInteger(target)||target<0)throw Error('最长时间为1–240分钟，新增目标为非负整数');launch(()=>run({minutes,target}));return this.status();}
   throw Error('未知操作');
  }
 };
}
