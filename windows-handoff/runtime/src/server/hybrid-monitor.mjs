import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile);
const root='F:/Temu运营数据/Temu辅助采集测试';
const app='c8d1633f-4c86-4e80-908f-d14213d40e5d';
const active=new Set(['QUEUED','RUNNING','WAITING_HUMAN','STARTING','CONNECTION_LOST']);
async function read(name){try{return JSON.parse(await fs.readFile(`${root}/${name}.json`,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function write(name,value){await fs.mkdir(root,{recursive:true});await fs.writeFile(`${root}/${name}.json.tmp`,JSON.stringify(value));await fs.rename(`${root}/${name}.json.tmp`,`${root}/${name}.json`);}
async function cli(args){const {stdout}=await execute('I:/影刀/shadowbot.shell-cli.exe',args,{windowsHide:true,timeout:25000,maxBuffer:2e6});const r=JSON.parse(stdout);if(!r.ok)throw Error(r.message||'影刀启动失败');return r.data;}
export function createHybridMonitor(catalog){
 let busy=false;
 return {
 async status(){
 const s=await read('status');if(!s)return {state:'IDLE'};
 const run=await read('launch');
 if(active.has(s.state)&&run?.id===s.id&&run.taskId){
 try{const task=await cli(['console','task','status','--task-id',run.taskId]);
 if(['completed','stopped','cancelled','canceled','faulted','failed'].includes(task.statusName)){
 const latest=await read('status');if(active.has(latest.state)){latest.state=['faulted','failed'].includes(task.statusName)?'FAILED':'STOPPED';latest.message=task.error||'影刀已结束，已保存商品保留。请检查日志后再启动。';await write('status',latest);const pending=await read('request');if(pending?.id===latest.id&&pending.state==='QUEUED')await write('request',{...pending,state:'CANCELLED'});return latest;}
 }}catch(e){s.connectionWarning=e.message;}
 }
 return s;
 },
 async command(body){if(!['resume','stop'].includes(body.action))throw Error('操作无效');const s=await read('status');if(!s||!active.has(s.state))throw Error('没有运行中的采集');await write('command',{id:s.id,action:body.action});return {ok:true};},
 async start(body){
 if(busy)throw Error('启动处理中');busy=true;
 try{
 const old=await read('status');if(old&&active.has(old.state))throw Error('已有采集运行或等待人工处理，请先结束');
 if(!/^[a-f0-9-]{36}$/i.test(body.profile_id||''))throw Error('请填写 VMLogin 配置ID');
 const target=Number(body.target??2000);if(!Number.isInteger(target)||target<1||target>2000)throw Error('新增目标为1至2000件');
 const tasks=catalog.manualTasks();const current=tasks.tasks.find(t=>t.id===tasks.current?.id);
 if(!current||current.status!=='running'||current.id!==body.campaign_id)throw Error('请先在运营台选择并继续一个采集任务');
 const sys=await cli(['system','state']);if(sys.hasRunningTask)throw Error('影刀已有任务运行，请先结束');
 try{const detail=await cli(['console','app','detail','--app-id',app,'--app-type','developed']);if(detail.appId!==app)throw Error('应用ID不匹配');}
 catch(e){throw Error('影刀当前账号无法找到“Temu辅助采集测试”，采集尚未启动。请确认影刀账号及应用是否已保存到当前应用列表。详情：'+e.message);}
 const id=randomUUID();const job={id,state:'QUEUED',campaign_name:current.name,baseline:current.count,created_at:Date.now(),args:{profile_id:body.profile_id,campaign_id:current.id,target,minutes:1440,execute:true,auto_bind:true}};
 await write('request',job);await write('status',job);
 try{const r=await cli(['console','task','run','--app-id',app,'--app-type','developed','--async']);const taskId=r.taskId??r.runAccepted?.taskId;if(!taskId)throw Error('没有返回任务编号');await write('launch',{id,taskId});return {ok:true,id,taskId};}
 catch(e){const s=await read('status');await write('status',{...s,state:'CONNECTION_LOST',message:'启动结果不确定，请先检查影刀，勿重复启动：'+e.message});throw e;}
 }finally{busy=false;}
 }
 };
}
