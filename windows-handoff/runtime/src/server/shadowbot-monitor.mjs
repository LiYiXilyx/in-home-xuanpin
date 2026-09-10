import {archiveDownloads} from './archive-downloads.mjs';
import {prepareShadowbotImages} from './prepare-shadowbot-images.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const appId='ae70b438-a3a6-44b3-ba0a-c77aeef41539';
const root='F:/Temu运营数据';
const stateFile=path.join(root,'monitor-state.json');
export function classifyFailure(message){
  if(/验证码|滑块验证|人机验证|captcha/i.test(message))return {state:'NEEDS_ATTENTION',reason:'验证码待处理',action:'到影刀浏览器手动完成验证。任务已经停止时，处理后重新发起未完成商品。'};
  if(/请登录|登录失效|未登录|login required/i.test(message))return {state:'NEEDS_ATTENTION',reason:'需要登录',action:'到影刀浏览器登录 1688，再重试未完成商品。'};
  return {state:'FAILED',reason:'执行异常，需要检查浏览器',action:'查看影刀浏览器当前页面和下方错误。图像未找到可能由加载慢、弹窗遮挡或按钮变化引起。'};
}
export function createShadowbotMonitor({importResults=null,prepareImport=null,run=async args=>{
  const {stdout}=await execute('I:/影刀/shadowbot.shell-cli.exe',args,{windowsHide:true,timeout:25000,maxBuffer:2*1024*1024});
  const value=JSON.parse(stdout);if(!value.ok)throw Error(value.message||'影刀接口返回失败');return value.data;
}}={}){
  let busy=false;
  async function read(){try{return JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async function save(value){await fs.writeFile(stateFile+'.tmp',JSON.stringify(value,null,2));await fs.rename(stateFile+'.tmp',stateFile);}
  async function status(){
    const current=await read();if(!current)return {state:'IDLE',message:'尚未从运营台启动影刀任务'};
    if(busy)return current;
    busy=true;
    try{
      if(!current.batchDir&&current.state==='IDLE'){delete current.eventError;delete current.archiveError;delete current.error;await save(current);return current;}
      if(current.taskId&&['RUNNING','STARTING','CONNECTION_LOST'].includes(current.state)){
        try{
          const task=await run(['console','task','status','--task-id',current.taskId]);
          const logs=await run(['console','task','logs','--task-id',current.taskId,'--limit','200']);
          current.logs=logs.lines??[];current.taskStatus=task.statusName;
          if(task.statusName==='completed')current.state='COMPLETED';
          else if(['faulted','failed'].includes(task.statusName))Object.assign(current,classifyFailure(task.error||task.statusName),{error:task.error||task.statusName});
          else if(['stopped','cancelled','canceled'].includes(task.statusName)){current.state='STOPPED';current.error=null;current.action='已停止，成果已保留，可继续未完成商品。';}
          else current.state='RUNNING';
          current.connectionError=null;
        }catch(e){current.connectionError=e.message;current.state='CONNECTION_LOST';}
      }
      try{
        const events=(await fs.readFile(path.join(current.batchDir,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
        current.events=events.slice(-100);current.completedGoods=[...new Set(events.filter(e=>e.state==='ITEM_COMPLETED').map(e=>e.goods_id))];
        current.currentGoods=events.filter(e=>e.state==='ITEM_STARTED').at(-1)?.goods_id??null;
        const last=events.at(-1);
        if(last?.state==='FAILED'&&!['RUNNING','STOPPED'].includes(current.state))Object.assign(current,classifyFailure(last.message),{error:last.message});
        if(current.state==='COMPLETED'&&!current.validationOnly&&last?.state!=='COMPLETED')Object.assign(current,classifyFailure('影刀已结束，但批次没有完成记录'),{error:'批次没有完成记录，请检查日志'});
      }catch(e){if(e.code!=='ENOENT')current.eventError=e.message;}
      try{await archiveDownloads(current);current.archiveError=null;}catch(e){current.archiveError='下载归档稍后重试：'+e.message;}
      current.updatedAt=new Date().toISOString();await save(current);
      if(current.autoImport&&!current.validationOnly&&['COMPLETED','IMPORTING'].includes(current.state)&&current.importStatus!=='COMPLETED'&&importResults){
        current.state='IMPORTING';current.importStatus='IMPORTING';await save(current);
        try{
          const result=await importAvailable(current);
          current.importRunId=result.run_id??result.current_run_id;
          current.importStatus='COMPLETED';current.state='IMPORTED';
          current.candidateCount=result.candidate_count;current.imageFailed=result.image_failed??result.failed_image_count??0;
          current.reviewUrl='/sourcing-review.html?run_id='+encodeURIComponent(current.importRunId);
          current.error=null;
        }catch(e){
          if(e.code==='IMPORT_IN_PROGRESS'){current.state='COMPLETED';current.importStatus='WAITING';}
          else {current.state='IMPORT_FAILED';current.importStatus='FAILED';current.error='自动导入失败：'+e.message;current.action='原始结果已保留。修复原因后点击重试导入，不必重新搜图。';}
        }
        await save(current);
      }
      return current;
    }finally{busy=false;}
  }
  async function start({validationOnly=true,...selection}={}){
    if(typeof validationOnly!=='boolean')throw Error('validationOnly 必须为布尔值');
    if(busy)throw Error('正在读取任务状态，请稍后再试');
    busy=true;
    try{
      const old=await read();if(old&&['RUNNING','STARTING','CONNECTION_LOST','IMPORTING','IMPORT_FAILED','FAILED','NEEDS_ATTENTION','PREPARING','STOPPED'].includes(old.state))throw Error('上一个任务尚未完成，请先处理或重试导入');
      const system=await run(['system','state']);
      if(system.hasRunningTask||system.hasStudioOpened||system.isStudioBusy)throw Error('影刀正在运行或设计器未关闭，请回到应用列表后重试');
      const id='operator-trial-'+Date.now();const batchDir=path.join(root,'1688找货',({'catalog_pool_9a0ccd35e57c4eb1a3e5a32bbe2c61ae':'替换零件','catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63':'摩托车配件'}[selection.poolId]||'其他商品池'),new Date().toLocaleDateString('sv-SE'),id);
      await fs.mkdir(path.join(batchDir,'images'),{recursive:true});
      await save({state:'PREPARING',batchId:id,batchDir,validationOnly,total:selection.count??2,logs:[],completedGoods:[],message:'正在自动准备商品资料和图片'});
      let importConfig;
      try{importConfig=!validationOnly&&prepareImport?await prepareImport({...selection,batchDir}):null;}
      catch(e){await save({state:'PREPARE_FAILED',batchId:id,batchDir,error:e.message,logs:[],completedGoods:[]});throw e;}
      let source;
      if(importConfig){try{source={schema_version:1,goods:await prepareShadowbotImages(importConfig.goods,batchDir)};}catch(e){await save({state:'PREPARE_FAILED',batchId:id,batchDir,error:e.message,logs:[],completedGoods:[]});throw e;}}
      else {source=JSON.parse(await fs.readFile(path.join(root,'trial-001/task.json'),'utf8'));for(const row of source.goods)await fs.copyFile(path.join(root,'trial-001',row.image_path),path.join(batchDir,row.image_path));}
      source.batch_id=id;await fs.writeFile(path.join(batchDir,'task.json'),JSON.stringify(source));
      const inputs=path.join(batchDir,'inputs.json');
      await fs.writeFile(inputs,JSON.stringify({task_config:JSON.stringify({manifest_path:path.join(batchDir,'task.json'),download_dir:'C:/Users/Administrator/Desktop/1688',execute:!validationOnly})}));
      const current={state:'STARTING',batchId:id,batchDir,validationOnly,autoImport:!validationOnly,importConfig,total:source.goods.length,startedAt:new Date().toISOString(),logs:[],completedGoods:[]};
      await save(current);
      try{
        const accepted=await run(['console','task','run','--app-id',appId,'--app-type','developed','--inputs-file',inputs,'--async']);
        current.taskId=accepted.taskId??accepted.runAccepted?.taskId;
        if(!current.taskId)throw Error('影刀没有返回任务编号，请检查影刀，勿重复启动');
        current.state='RUNNING';await save(current);return current;
      }catch(e){current.state='CONNECTION_LOST';current.error=e.message;await save(current);throw e;}
    }finally{busy=false;}
  }
  async function retrySearch(){
    if(busy)throw Error('任务处理中');busy=true;
    try{const current=await read();if(!['FAILED','NEEDS_ATTENTION','STOPPED'].includes(current?.state))throw Error('当前没有待重试的搜图任务');
      const system=await run(['system','state']);if(system.hasRunningTask||system.hasStudioOpened||system.isStudioBusy)throw Error('请先让影刀回到应用列表并确认没有任务运行');
      if(current.taskId){const ended=await run(['console','task','status','--task-id',current.taskId]);if(!['completed','faulted','failed','stopped','cancelled','canceled'].includes(ended.statusName))throw Error('原任务尚未确认结束');}
      try{await fs.rename(path.join(current.batchDir,'running.lock'),path.join(current.batchDir,'running.lock.stopped-'+Date.now()));}catch(e){if(e.code!=='ENOENT')throw e;}
      current.state='STARTING';current.error=null;current.reason=null;current.action=null;await save(current);
      try{const accepted=await run(['console','task','run','--app-id',appId,'--app-type','developed','--inputs-file',path.join(current.batchDir,'inputs.json'),'--async']);current.taskId=accepted.taskId??accepted.runAccepted?.taskId;if(!current.taskId)throw Error('未返回影刀任务编号');current.state='RUNNING';await save(current);return current;}
      catch(e){current.state='CONNECTION_LOST';current.error=e.message;await save(current);throw e;}
    }finally{busy=false;}
  }
  async function importAvailable(current){
    const manifest=JSON.parse(await fs.readFile(path.join(current.batchDir,'task.json'),'utf8'));
    const imported=new Set(current.importedGoods??[]), completed=new Set(current.completedGoods??[]);
    const goods=manifest.goods.filter(g=>completed.has(g.goods_id)&&!imported.has(g.goods_id));
    if(!goods.length){if(current.lastImportResult)return current.lastImportResult;throw Error('没有可导入的已保存商品');}
    const key=createHash('sha256').update(goods.map(g=>g.goods_id).sort().join(',')).digest('hex').slice(0,16);
    const batchId=current.batchId+'-saved-'+key;
    const batchDir=path.join(current.batchDir,'复核批次',batchId);
    await fs.mkdir(path.join(batchDir,'results'),{recursive:true});
    for(const g of goods)await fs.copyFile(path.join(current.batchDir,'results',g.goods_id+'.xlsx'),path.join(batchDir,'results',g.goods_id+'.xlsx'));
    await fs.writeFile(path.join(batchDir,'task.json'),JSON.stringify({...manifest,batch_id:batchId,goods}));
    const result=await importResults({batchId,batchDir,importConfig:{...current.importConfig,batchName:(current.importConfig.batchName||'1688找货')+' · 已保存 '+goods.length+' 件 · '+current.batchId}});
    current.importedGoods=[...new Set([...imported,...goods.map(g=>g.goods_id)])];
    current.lastImportResult=result;
    current.reviewUrl='/sourcing-review.html?run_id='+encodeURIComponent(result.run_id??result.current_run_id);
    return result;
  }
  async function importSaved(){
    if(busy)throw Error('任务处理中，请稍后再试');busy=true;
    try{
      const current=await read();
      if(!['STOPPED','FAILED','NEEDS_ATTENTION'].includes(current?.state))throw Error('请先停止搜图再导入已保存商品');
      const system=await run(['system','state']);if(system.hasRunningTask)throw Error('影刀尚未停止');
      current.state='STOPPED';current.partialImportStatus='IMPORTING';current.error=null;current.action='正在导入已保存商品，搜图保持停止';await save(current);
      try{await importAvailable(current);current.partialImportStatus='COMPLETED';current.action='已保存商品已导入人工复核，搜图保持停止';}
      catch(e){current.partialImportStatus='FAILED';current.error='已保存商品导入失败：'+e.message;}
      await save(current);return current;
    }finally{busy=false;}
  }
  async function switchPool({poolId}={}){
    if(typeof poolId!=='string'||!/^catalog_pool_[a-zA-Z0-9]+$/.test(poolId))throw Error('请选择有效商品池');
    if(busy)throw Error('任务处理中，请稍后再试');busy=true;
    try{
      const current=await read();
      if(current&&['RUNNING','STARTING','CONNECTION_LOST','IMPORTING','PREPARING'].includes(current.state))throw Error('请先停止搜图并等待导入结束');
      const system=await run(['system','state']);if(system.hasRunningTask)throw Error('影刀正在运行，请先停止');
      const folder=path.join(root,'池子任务');await fs.mkdir(folder,{recursive:true});
      const oldPool=current?.importConfig?.poolId;
      if(current?.batchId&&/^catalog_pool_[a-zA-Z0-9]+$/.test(oldPool??''))await fs.writeFile(path.join(folder,oldPool+'.json'),JSON.stringify(current,null,2));
      let selected;
      try{selected=JSON.parse(await fs.readFile(path.join(folder,poolId+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;selected={state:'IDLE',importConfig:{poolId},completedGoods:[]};}
      await save(selected);return selected;
    }finally{busy=false;}
  }
  async function openFolder(){const current=await read();if(!current?.batchDir)throw Error('暂无批次目录');const folder=path.resolve(current.batchDir),relative=path.relative(root,folder);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('批次目录不在业务数据目录');if(!(await fs.stat(folder)).isDirectory())throw Error('批次目录不存在');await new Promise((resolve,reject)=>{const child=spawn('explorer.exe',[folder],{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});return {ok:true};}
  async function retryImport(){
    if(busy)throw Error('任务处理中，请稍后再试');
    busy=true;
    try{const current=await read();if(current?.state!=='IMPORT_FAILED')throw Error('当前没有失败的导入');current.state='COMPLETED';current.importStatus='WAITING';await save(current);return current;}finally{busy=false;}
  }
  // Server-owned polling: closing the web page does not stop completion/import handling.
  const timer=importResults?setInterval(()=>{void status().catch(console.error);},5000):null;
  timer?.unref();
  return {status,start,switchPool,importSaved,openFolder,retrySearch,retryImport,stop:()=>clearInterval(timer)};
}



