import fs from 'node:fs';
import path from 'node:path';
import { machineName } from './machine-role.mjs';

export function acquireRunLock(lockPath,{runId,gitCommit,machine=machineName(),pid=process.pid,startedAt=new Date().toISOString()}={}){
  if(!runId||!gitCommit)throw new Error('创建运行锁需要 runId 和 gitCommit。');
  fs.mkdirSync(path.dirname(lockPath),{recursive:true});
  const payload={run_id:runId,machine_name:machine,pid,started_at:startedAt,git_commit:gitCommit};
  let fd;
  try{fd=fs.openSync(lockPath,'wx');fs.writeFileSync(fd,`${JSON.stringify(payload,null,2)}\n`,'utf8');}
  catch(error){if(error?.code==='EEXIST')throw new Error(`运行锁已存在，拒绝重复执行：${lockPath}`);throw error;}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  return payload;
}

export function inspectRunLock(lockPath){
  if(!fs.existsSync(lockPath))return null;
  try{return JSON.parse(fs.readFileSync(lockPath,'utf8'));}catch{return {invalid:true,path:path.resolve(lockPath)};}
}

export function removeRunLock(lockPath,{runId}={}){
  const current=inspectRunLock(lockPath);if(!current)throw new Error(`运行锁不存在：${lockPath}`);
  if(!runId||current.run_id!==runId)throw new Error('锁中的 run_id 与命令参数不一致，拒绝删除。');
  fs.unlinkSync(lockPath);return current;
}
