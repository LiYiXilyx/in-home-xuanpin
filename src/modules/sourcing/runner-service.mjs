import fs from 'node:fs';
import path from 'node:path';
import { openDatabase,transaction } from '../../db/client.mjs';
import { MACHINE_ROLES,assertMachineRole,machineName } from './machine-role.mjs';
import { getGitInfo } from './git-info.mjs';
import { validateInputPackage } from './input-package.mjs';
import { acquireRunLock,inspectRunLock } from './run-lock.mjs';
import { inspectSourcingDatabase,resolveSourcingDbPath } from './sourcing-db.mjs';
import { sourcingRuntimePaths } from './runtime-paths.mjs';
import { createStructuredLogger } from './structured-log.mjs';

export function inspectTemuReadonly(databasePath,{expectedActive=2135}={}){
  if(!fs.existsSync(databasePath))throw new Error(`Temu 数据库不存在：${databasePath}`);
  const db=openDatabase(databasePath,{readOnly:true});try{
    const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
    const active=db.prepare("SELECT id,product_count FROM catalog_pool_versions WHERE status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get();
    const membershipCount=Number(db.prepare('SELECT COUNT(*) n FROM catalog_memberships WHERE active=1').get().n);
    if(integrity!=='ok'||Number(active?.product_count)!==expectedActive||membershipCount!==expectedActive)throw new Error(`Temu 安全门失败：integrity=${integrity}, pool=${active?.product_count??'MISSING'}, memberships=${membershipCount}`);
    return {database_path:path.resolve(databasePath),open_mode:'READ_ONLY',integrity,active_pool_id:active.id,active_pool_count:Number(active.product_count),active_memberships:membershipCount};
  }finally{db.close();}
}

export async function checkChromeCdp(endpoint,{fetchImpl=fetch}={}){
  const url=new URL('/json/version',endpoint).href;let response;
  try{response=await fetchImpl(url,{signal:AbortSignal.timeout(3000)});}catch(error){throw new Error(`无法连接真实 Chrome CDP：${endpoint} (${error.message})`);}
  if(!response.ok)throw new Error(`Chrome CDP 返回 HTTP ${response.status}。`);const info=await response.json();
  if(!String(info.Browser??'').includes('Chrome'))throw new Error('CDP 端点不是 Chrome。');return {endpoint,browser:info.Browser,webSocketDebuggerUrl:info.webSocketDebuggerUrl??null};
}

export async function runnerPreflight({runId,target,projectRoot=process.cwd(),temuDbPath,sourceDbPath=resolveSourcingDbPath(projectRoot),cdpEndpoint=process.env.CHROME_CDP_ENDPOINT??'http://127.0.0.1:9222',checkChrome=true,fetchImpl}={}){
  assertMachineRole(MACHINE_ROLES.RUNNER,'正式 1688 寻源');
  if(!Number.isInteger(target)||target<1||target>20)throw new Error('--target 必须是 1–20 的整数。');
  const paths=sourcingRuntimePaths({projectRoot,runId}),git=getGitInfo({cwd:projectRoot});
  if(!git.available)throw new Error('无法读取 Git 提交。');if(!git.statusClean)throw new Error('执行机工作区必须干净，确保运行可复现。');
  const input=validateInputPackage(paths.inputDir,{expectedRunId:runId,expectedTarget:target});
  if(input.manifest.git_commit!==git.commit)throw new Error(`输入包 Git 提交 ${input.manifest.git_commit} 与执行机 ${git.commit} 不一致。`);
  const temu=inspectTemuReadonly(path.resolve(temuDbPath),{expectedActive:2135});
  const sourcing=inspectSourcingDatabase(sourceDbPath);if(!sourcing.exists||sourcing.integrity!=='ok'||sourcing.schemaVersion!==2)throw new Error('1688 数据库未初始化、结构版本不正确或完整性检查失败；先运行 sourcing:1688:init-db。');
  const db=openDatabase(sourceDbPath,{readOnly:true});try{if(db.prepare('SELECT 1 FROM sourcing_runs WHERE run_id=?').get(runId))throw new Error(`run_id 已执行过，拒绝覆盖历史：${runId}`);}finally{db.close();}
  if(inspectRunLock(paths.lockPath))throw new Error(`运行锁已存在：${paths.lockPath}`);if(fs.existsSync(paths.runOutputDir))throw new Error(`输出目录已存在，拒绝覆盖：${paths.runOutputDir}`);
  const chrome=checkChrome?await checkChromeCdp(cdpEndpoint,{fetchImpl}):{skipped:true};
  return {ok:true,run_id:runId,target,role:MACHINE_ROLES.RUNNER,machine_name:machineName(),git,input,temu,sourcing,sourcing_database:path.resolve(sourceDbPath),chrome,paths};
}

export async function initializeRunnerSession(options){
  const checked=await runnerPreflight(options),now=new Date().toISOString(),{paths,input,git}=checked;
  const lock=acquireRunLock(paths.lockPath,{runId:checked.run_id,gitCommit:git.commit,machine:checked.machine_name,startedAt:now});
  fs.mkdirSync(paths.runOutputDir,{recursive:false});for(const folder of ['screenshots','pages','errors'])fs.mkdirSync(path.join(paths.runOutputDir,folder));
  const summary={run_id:checked.run_id,git_commit:git.commit,machine_role:checked.role,machine_name:checked.machine_name,started_at:now,finished_at:null,status:'RUNNING',input_count:input.goods.length,processed_count:0,candidates_captured:0,manual_capture_required:0,captcha_wait:0,login_wait:0};
  fs.writeFileSync(path.join(paths.runOutputDir,'run-summary.json'),`${JSON.stringify(summary,null,2)}\n`);fs.writeFileSync(path.join(paths.runOutputDir,'candidates.jsonl'),'');
  const log=createStructuredLogger(path.join(paths.runOutputDir,'runner.log'),{runId:checked.run_id});log({step:'SESSION_INITIALIZED',status:'RUNNING'});
  const db=openDatabase(checked.sourcing_database,{allowRunnerWrite:true});try{transaction(db,()=>{db.prepare(`INSERT INTO sourcing_runs(run_id,git_commit_sha,machine_role,machine_name,started_at,status,input_count,processed_count,target_count,input_manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,'RUNNING',?,0,?,?,?,?)`).run(checked.run_id,git.commit,checked.role,checked.machine_name,now,input.goods.length,checked.target,input.manifestSha256,now,now);const insert=db.prepare(`INSERT INTO sourcing_run_items(run_id,temu_goods_id,temu_title,temu_image_path,level1,level2,level3,similar_cluster,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'PENDING',?)`);for(const item of input.goods)insert.run(checked.run_id,item.temu_goods_id,item.temu_title,item.temu_image_path,item.level1,item.level2,item.level3,item.similar_cluster,now);});}catch(error){throw new Error(`运行已加锁且不会自动删除；初始化数据库失败：${error.message}`);}finally{db.close();}
  return {...summary,lock_path:paths.lockPath,output_dir:paths.runOutputDir,next_action:'在真实 Chrome 中由人工/RPA 执行官方采购助手；遇到验证必须置 WAITING_FOR_HUMAN。'};
}
