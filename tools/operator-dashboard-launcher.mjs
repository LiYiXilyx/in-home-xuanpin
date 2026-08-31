import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DASHBOARD_SERVICE='temu-operator-dashboard';
export const DASHBOARD_API_VERSION=1;

export async function probeDashboardHealth({ healthUrl,fetchImpl=fetch,requestTimeoutMs=1_000 }) {
  let response;
  try {
    response=await fetchImpl(healthUrl,{ signal:AbortSignal.timeout(requestTimeoutMs) });
  } catch (error) {
    return { state:'unreachable',details:{ code:error?.code ?? error?.name ?? 'UNREACHABLE' } };
  }
  if (!response.ok) return { state:'foreign',details:{ status:response.status } };
  const contentType=response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return { state:'foreign',details:{ contentType } };
  let body;
  try { body=await response.json(); } catch { return { state:'foreign',details:{ malformedJson:true } }; }
  if (body?.ok === true && body?.service === DASHBOARD_SERVICE && body?.apiVersion === DASHBOARD_API_VERSION
    && typeof body.environment === 'string' && body.environment.length>0 && typeof body.testMode === 'boolean') {
    return { state:'ready',details:body };
  }
  return { state:'foreign',details:body };
}

export async function isTcpPortOccupied({ host='127.0.0.1',port,connectTimeoutMs=500 }) {
  return new Promise(resolve => {
    const socket=net.createConnection({ host,port });
    let settled=false;
    const finish=value => {
      if (settled) return;
      settled=true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(connectTimeoutMs,() => finish(true));
    socket.once('connect',() => finish(true));
    socket.once('error',error => finish(error?.code !== 'ECONNREFUSED'));
  });
}

export async function launchOperatorDashboard(options) {
  const health=await probeDashboardHealth(options);
  if (health.state === 'ready') {
    await options.openDashboard(options.dashboardUrl);
    return { action:'opened-existing',dashboardUrl:options.dashboardUrl,pid:null };
  }
  if (await isTcpPortOccupied(options)) {
    throw launcherError('PORT_OCCUPIED_BY_OTHER_SERVICE','端口已被非 Temu 运营台服务占用。');
  }
  const lock=acquireLaunchLock({ lockPath:options.lockPath,metadata:{ launcherPid:process.pid,port:options.port,worktree:options.cwd ?? null },
    staleAfterMs:options.staleAfterMs,isProcessAlive:options.isProcessAlive });
  if (!lock.owned) return waitForExistingLaunch(options);
  try {
    const lockedHealth=await probeDashboardHealth(options);
    if (lockedHealth.state === 'ready') {
      await options.openDashboard(options.dashboardUrl);
      return { action:'opened-existing',dashboardUrl:options.dashboardUrl,pid:null };
    }
    if (lockedHealth.state === 'foreign' || await isTcpPortOccupied(options)) {
      throw launcherError('PORT_OCCUPIED_BY_OTHER_SERVICE','端口已被非 Temu 运营台服务占用。');
    }
    const child=options.spawnDashboard ? await options.spawnDashboard():spawnDashboardProcess(options);
    await waitForDashboardHealth({ ...options,child });
    await options.openDashboard(options.dashboardUrl);
    return { action:'started-and-opened',dashboardUrl:options.dashboardUrl,pid:child?.pid ?? null };
  } catch (error) {
    if (options.logPath) {
      appendLauncherLog(options.logPath,error);
      if (!error.logPath) error.logPath=options.logPath;
    }
    throw error;
  } finally {
    lock.release();
  }
}

async function waitForExistingLaunch(options) {
  const timeoutMs=options.healthTimeoutMs ?? 30_000;
  const intervalMs=options.healthPollIntervalMs ?? 200;
  const deadline=Date.now()+timeoutMs;
  while (Date.now()<deadline) {
    const health=await probeDashboardHealth(options);
    if (health.state === 'ready') {
      await options.openDashboard(options.dashboardUrl);
      return { action:'opened-existing',dashboardUrl:options.dashboardUrl,pid:null };
    }
    if (health.state === 'foreign') throw launcherError('PORT_OCCUPIED_BY_OTHER_SERVICE','端口已被非 Temu 运营台服务占用。');
    await (options.sleep ?? defaultSleep)(intervalMs);
  }
  throw launcherError('DASHBOARD_HEALTH_TIMEOUT','等待另一个启动器启动 Temu 运营台超时。');
}

export function acquireLaunchLock({ lockPath,metadata={},now=Date.now,isProcessAlive=defaultIsProcessAlive,staleAfterMs=30_000 }) {
  fs.mkdirSync(path.dirname(lockPath),{ recursive:true });
  for (let attempt=0;attempt<2;attempt+=1) {
    const ownershipToken=randomUUID();
    try {
      fs.mkdirSync(lockPath);
      const owner={ ...metadata,launcherPid:metadata.launcherPid ?? process.pid,createdAt:new Date(now()).toISOString(),ownershipToken };
      fs.writeFileSync(path.join(lockPath,'owner.json'),JSON.stringify(owner));
      return { owned:true,ownershipToken,owner,release:() => releaseOwnedLock(lockPath,ownershipToken) };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const existing=readLockOwner(lockPath);
    const createdAt=Number.isFinite(Date.parse(existing?.createdAt)) ? Date.parse(existing.createdAt):lockMtime(lockPath);
    const age=Math.max(0,now()-createdAt);
    const alive=Number.isInteger(existing?.launcherPid) && isProcessAlive(existing.launcherPid);
    if (alive || age <= staleAfterMs) return { owned:false,reason:alive ? 'owner-alive':'lock-fresh',owner:existing };
    if (attempt > 0) return { owned:false,reason:'stale-recovery-raced',owner:existing };

    const stalePath=`${lockPath}.stale-${randomUUID()}`;
    try {
      fs.renameSync(lockPath,stalePath);
      fs.rmSync(stalePath,{ recursive:true,force:true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { owned:false,reason:'lock-unavailable' };
}

export function createProductionLaunchOptions({ worktree,config,npm,port },dependencies={}) {
  if (!fs.existsSync(worktree) || !fs.statSync(worktree).isDirectory()) {
    throw launcherError('OPERATOR_WORKTREE_NOT_FOUND','运行目录不存在。');
  }
  if (!fs.existsSync(config) || !fs.statSync(config).isFile()) {
    throw launcherError('OPERATOR_CONFIG_NOT_FOUND','配置文件不存在。');
  }
  if (!path.isAbsolute(npm) || !isExecutable(npm)) {
    throw launcherError('NPM_RUNTIME_NOT_FOUND','npm 路径无效。');
  }
  const numericPort=Number(port);
  if (!Number.isInteger(numericPort) || numericPort<1 || numericPort>65_535) {
    throw launcherError('INVALID_DASHBOARD_PORT','Dashboard 端口无效。');
  }
  const logsDirectory=path.join(worktree,'logs');
  return {
    dashboardUrl:`http://127.0.0.1:${numericPort}/`,healthUrl:`http://127.0.0.1:${numericPort}/api/health`,
    host:'127.0.0.1',port:numericPort,cwd:worktree,env:{ TEMU_CONFIG_PATH:config },
    dashboardCommand:[npm,['run','dashboard']],
    lockPath:path.join(logsDirectory,'operator-dashboard-launcher.lock'),
    logPath:path.join(logsDirectory,'operator-dashboard.log'),pidPath:path.join(logsDirectory,'operator-dashboard.pid'),
    healthTimeoutMs:30_000,healthPollIntervalMs:200,staleAfterMs:30_000,
    openDashboard:dependencies.openDashboard ?? openSystemBrowser
  };
}

export async function runLauncherCli(args,dependencies={}) {
  const parsed=parseLauncherArgs(args);
  const options=createProductionLaunchOptions(parsed,dependencies);
  return (dependencies.launchImpl ?? launchOperatorDashboard)(options);
}

function readLockOwner(lockPath) {
  try { return JSON.parse(fs.readFileSync(path.join(lockPath,'owner.json'),'utf8')); } catch { return null; }
}

function lockMtime(lockPath) {
  try { return fs.statSync(lockPath).mtimeMs; } catch { return Date.now(); }
}

function releaseOwnedLock(lockPath,ownershipToken) {
  const owner=readLockOwner(lockPath);
  if (owner?.ownershipToken !== ownershipToken) return false;
  const releasedPath=`${lockPath}.released-${ownershipToken}`;
  try {
    fs.renameSync(lockPath,releasedPath);
    fs.rmSync(releasedPath,{ recursive:true,force:true });
    return true;
  } catch { return false; }
}

function defaultIsProcessAlive(pid) {
  try { process.kill(pid,0);return true; } catch (error) { return error?.code === 'EPERM'; }
}

function spawnDashboardProcess(options) {
  const [executable,args=[]]=options.dashboardCommand ?? [];
  if (!executable) throw launcherError('DASHBOARD_COMMAND_MISSING','缺少 Dashboard 启动命令。');
  fs.mkdirSync(path.dirname(options.logPath),{ recursive:true });
  rotateDashboardLog(options.logPath,options.maxLogBytes ?? 5*1024*1024);
  const output=fs.openSync(options.logPath,'a');
  let child;
  try {
    child=spawn(executable,args,{ cwd:options.cwd,env:{ ...process.env,...options.env },detached:true,stdio:['ignore',output,output] });
  } finally {
    fs.closeSync(output);
  }
  child.unref();
  if (options.pidPath) writePidDiagnostic(options.pidPath,{ pid:child.pid,startedAt:new Date().toISOString() });
  return child;
}

async function waitForDashboardHealth(options) {
  const timeoutMs=options.healthTimeoutMs ?? 30_000;
  const intervalMs=options.healthPollIntervalMs ?? 200;
  const deadline=Date.now()+timeoutMs;
  while (Date.now()<deadline) {
    const health=await probeDashboardHealth(options);
    if (health.state === 'ready') return;
    if (health.state === 'foreign') throw launcherError('PORT_OCCUPIED_BY_OTHER_SERVICE','启动期间端口出现非 Temu 运营台服务。');
    if (options.child?.exitCode != null) throw launcherError('DASHBOARD_START_FAILED','Temu 运营台进程启动失败。',{ exitCode:options.child.exitCode });
    await (options.sleep ?? defaultSleep)(intervalMs);
  }
  throw launcherError('DASHBOARD_HEALTH_TIMEOUT','等待 Temu 运营台就绪超时。');
}

function defaultSleep(milliseconds) { return new Promise(resolve => setTimeout(resolve,milliseconds)); }

function rotateDashboardLog(logPath,maxBytes) {
  let size=0;
  try { size=fs.statSync(logPath).size; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (size <= maxBytes) return;
  const previous=`${logPath}.1`;
  fs.rmSync(previous,{ force:true });
  fs.renameSync(logPath,previous);
}

function writePidDiagnostic(pidPath,data) {
  fs.mkdirSync(path.dirname(pidPath),{ recursive:true });
  const temporary=`${pidPath}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary,JSON.stringify(data));
  fs.renameSync(temporary,pidPath);
}

function appendLauncherLog(logPath,error) {
  fs.mkdirSync(path.dirname(logPath),{ recursive:true });
  fs.appendFileSync(logPath,`\n[launcher] ${new Date().toISOString()} ${error?.code ?? 'ERROR'} ${error?.message ?? String(error)}\n`);
}

function isExecutable(file) {
  try { fs.accessSync(file,fs.constants.X_OK);return true; } catch { return false; }
}

function parseLauncherArgs(args) {
  const parsed={};
  for (let index=0;index<args.length;index+=2) {
    const flag=args[index];
    const value=args[index+1];
    if (!flag?.startsWith('--') || value == null) throw launcherError('INVALID_LAUNCHER_ARGUMENTS','启动参数无效。');
    parsed[flag.slice(2)]=value;
  }
  for (const required of ['worktree','config','npm','port']) {
    if (!parsed[required]) throw launcherError('INVALID_LAUNCHER_ARGUMENTS',`缺少启动参数：${required}。`);
  }
  return parsed;
}

async function openSystemBrowser(url) {
  const child=spawn('/usr/bin/open',[url],{ detached:true,stdio:'ignore' });
  child.unref();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runLauncherCli(process.argv.slice(2)).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    process.stderr.write(`${error?.code ?? 'OPERATOR_DASHBOARD_LAUNCH_FAILED'}: ${error?.message ?? String(error)}${error?.logPath ? `\n日志：${error.logPath}`:''}\n`);
    process.exitCode=1;
  });
}

function launcherError(code,message,details={}) {
  return Object.assign(new Error(message),{ code,...details });
}
