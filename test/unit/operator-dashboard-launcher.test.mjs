import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireLaunchLock,
  createProductionLaunchOptions,
  isTcpPortOccupied,
  launchOperatorDashboard,
  probeDashboardHealth,
  runLauncherCli
} from '../../tools/operator-dashboard-launcher.mjs';

test('HTTP 200 is accepted only with exact Temu service identity',async t => {
  const good=await healthServer(t,{ ok:true,service:'temu-operator-dashboard',apiVersion:1,environment:'development',testMode:false });
  assert.equal((await probeDashboardHealth({ healthUrl:good.url })).state,'ready');
  const foreign=await healthServer(t,{ ok:true,service:'another-service',apiVersion:1,environment:'development',testMode:false });
  assert.equal((await probeDashboardHealth({ healthUrl:foreign.url })).state,'foreign');
});

test('health probe rejects malformed, non-JSON, incomplete, and non-200 responses',async t => {
  const malformed=await healthServer(t,'{',{ contentType:'application/json' });
  assert.equal((await probeDashboardHealth({ healthUrl:malformed.url })).state,'foreign');
  const text=await healthServer(t,'ok',{ contentType:'text/plain' });
  assert.equal((await probeDashboardHealth({ healthUrl:text.url })).state,'foreign');
  const incomplete=await healthServer(t,{ ok:true,service:'temu-operator-dashboard' });
  assert.equal((await probeDashboardHealth({ healthUrl:incomplete.url })).state,'foreign');
  const notFound=await healthServer(t,{ ok:false },{ status:404 });
  assert.equal((await probeDashboardHealth({ healthUrl:notFound.url })).state,'foreign');
});

test('health probe reports an unused port as unreachable',async () => {
  const port=await unusedPort();
  assert.equal((await probeDashboardHealth({ healthUrl:`http://127.0.0.1:${port}/api/health` })).state,'unreachable');
});

test('TCP probe distinguishes occupied and unused loopback ports',async t => {
  const server=await healthServer(t,{ ok:true });
  assert.equal(await isTcpPortOccupied({ host:'127.0.0.1',port:server.port }),true);
  assert.equal(await isTcpPortOccupied({ host:'127.0.0.1',port:await unusedPort() }),false);
});

test('healthy dashboard opens without spawn',async t => {
  const server=await healthServer(t,{ ok:true,service:'temu-operator-dashboard',apiVersion:1,environment:'development',testMode:false });
  let spawns=0;
  const opened=[];
  const dashboardUrl=`http://127.0.0.1:${server.port}/`;
  const result=await launchOperatorDashboard({
    dashboardUrl,healthUrl:server.url,host:'127.0.0.1',port:server.port,
    spawnDashboard:async () => { spawns+=1;throw new Error('must not spawn'); },
    openDashboard:async url => opened.push(url)
  });
  assert.equal(result.action,'opened-existing');
  assert.equal(spawns,0);
  assert.deepEqual(opened,[dashboardUrl]);
});

test('foreign listener hard fails without kill spawn or open',async t => {
  const server=await healthServer(t,{ ok:true,service:'foreign',apiVersion:1,environment:'x',testMode:false });
  let spawns=0;
  let opens=0;
  await assert.rejects(() => launchOperatorDashboard({
    dashboardUrl:`http://127.0.0.1:${server.port}/`,healthUrl:server.url,host:'127.0.0.1',port:server.port,
    spawnDashboard:async () => { spawns+=1; },openDashboard:async () => { opens+=1; }
  }),error => error.code === 'PORT_OCCUPIED_BY_OTHER_SERVICE');
  assert.equal(spawns,0);
  assert.equal(opens,0);
  const stillServing=await fetch(server.url);
  assert.equal(stillServing.status,200);
});

test('dead old launch lock is recovered once with a new ownership token',t => {
  const fixture=lockFixture(t);
  fixture.write({ launcherPid:999999,createdAt:'2026-08-31T00:00:00.000Z',ownershipToken:'old' });
  const acquired=acquireLaunchLock({ lockPath:fixture.lockPath,metadata:{ launcherPid:123 },
    now:() => Date.parse('2026-08-31T00:01:00.000Z'),staleAfterMs:5_000,isProcessAlive:() => false });
  assert.equal(acquired.owned,true);
  assert.notEqual(acquired.ownershipToken,'old');
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.lockPath,'owner.json'),'utf8')).ownershipToken,acquired.ownershipToken);
  acquired.release();
  assert.equal(fs.existsSync(fixture.lockPath),false);
});

test('live or fresh launch lock is preserved and never stolen',t => {
  const live=lockFixture(t);
  live.write({ launcherPid:234,createdAt:'2026-08-31T00:00:00.000Z',ownershipToken:'live' });
  const liveResult=acquireLaunchLock({ lockPath:live.lockPath,metadata:{ launcherPid:123 },
    now:() => Date.parse('2026-08-31T00:01:00.000Z'),staleAfterMs:5_000,isProcessAlive:pid => pid === 234 });
  assert.equal(liveResult.owned,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(live.lockPath,'owner.json'),'utf8')).ownershipToken,'live');

  const fresh=lockFixture(t);
  fresh.write({ launcherPid:999999,createdAt:'2026-08-31T00:00:59.000Z',ownershipToken:'fresh' });
  const freshResult=acquireLaunchLock({ lockPath:fresh.lockPath,metadata:{ launcherPid:123 },
    now:() => Date.parse('2026-08-31T00:01:00.000Z'),staleAfterMs:5_000,isProcessAlive:() => false });
  assert.equal(freshResult.owned,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fresh.lockPath,'owner.json'),'utf8')).ownershipToken,'fresh');
});

test('lock release removes only the matching ownership token',t => {
  const fixture=lockFixture(t);
  const acquired=acquireLaunchLock({ lockPath:fixture.lockPath,metadata:{ launcherPid:123 },isProcessAlive:() => true });
  fixture.write({ launcherPid:456,createdAt:new Date().toISOString(),ownershipToken:'replacement' });
  acquired.release();
  assert.equal(fs.existsSync(fixture.lockPath),true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.lockPath,'owner.json'),'utf8')).ownershipToken,'replacement');
});

test('free port starts detached dashboard, waits for health, then opens exact URL',async t => {
  const fixture=await processFixture(t);
  const opened=[];
  let launchedPid;
  t.after(async () => stopFixture(launchedPid));
  const result=await launchOperatorDashboard({
    ...fixture.options,
    dashboardCommand:[process.execPath,[fixture.script,'--port',String(fixture.port),'--mode','valid']],
    openDashboard:async url => opened.push(url)
  });
  launchedPid=result.pid;

  assert.equal(result.action,'started-and-opened');
  assert.deepEqual(opened,[fixture.dashboardUrl]);
  assert.equal((await probeDashboardHealth({ healthUrl:fixture.healthUrl })).state,'ready');
  assert.equal(processAlive(result.pid),true,'dashboard survives after launcher call returns');
});

test('two concurrent launchers spawn exactly one dashboard',async t => {
  const fixture=await processFixture(t);
  const counter=path.join(fixture.directory,'spawn-counter.txt');
  let launchedPid;
  t.after(async () => stopFixture(launchedPid));
  const options={
    ...fixture.options,
    dashboardCommand:[process.execPath,[fixture.script,'--port',String(fixture.port),'--mode','valid','--counter',counter]],
    openDashboard:async () => {}
  };

  const results=await Promise.all([launchOperatorDashboard(options),launchOperatorDashboard(options)]);
  launchedPid=results.find(result => result.pid)?.pid;

  assert.equal(fs.readFileSync(counter,'utf8').trim().split('\n').length,1);
  assert.deepEqual(new Set(results.map(result => result.action)),new Set(['started-and-opened','opened-existing']));
});

test('dashboard startup failure writes evidence and never opens the browser',async t => {
  const fixture=await processFixture(t);
  let opens=0;
  let failure;
  try {
    await launchOperatorDashboard({
      ...fixture.options,
      dashboardCommand:[process.execPath,[fixture.script,'--port',String(fixture.port),'--mode','exit']],
      openDashboard:async () => { opens+=1; }
    });
  } catch (error) { failure=error; }
  assert.equal(failure?.code,'DASHBOARD_START_FAILED');
  assert.equal(failure?.logPath,fixture.options.logPath);
  assert.equal(opens,0);
  assert.equal(fs.existsSync(fixture.options.logPath),true);
  assert.match(fs.readFileSync(fixture.options.logPath,'utf8'),/startup failure/);
});

test('dashboard log rotates at 5 MiB and PID file remains diagnostic only',async t => {
  const fixture=await processFixture(t);
  fs.writeFileSync(fixture.options.logPath,Buffer.alloc(5*1024*1024+1,0x61));
  let launchedPid;
  t.after(async () => stopFixture(launchedPid));
  const result=await launchOperatorDashboard({
    ...fixture.options,
    dashboardCommand:[process.execPath,[fixture.script,'--port',String(fixture.port),'--mode','valid']],
    openDashboard:async () => {}
  });
  launchedPid=result.pid;

  assert.equal(fs.statSync(`${fixture.options.logPath}.1`).size,5*1024*1024+1);
  assert.ok(fs.statSync(fixture.options.logPath).size<5*1024*1024);
  assert.deepEqual(fs.readdirSync(fixture.directory).filter(name => name.startsWith('operator-dashboard.log')).sort(),
    ['operator-dashboard.log','operator-dashboard.log.1']);
  assert.equal(JSON.parse(fs.readFileSync(fixture.options.pidPath,'utf8')).pid,result.pid);
});

test('launcher CLI maps explicit worktree config npm and port without fallback',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-launch-cli-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:20 }));
  const configPath=path.join(directory,'config.json');
  const npmPath=path.join(directory,'npm');
  fs.writeFileSync(configPath,'{}');
  fs.writeFileSync(npmPath,'#!/bin/sh\nexit 0\n');
  fs.chmodSync(npmPath,0o755);
  let captured;
  const result=await runLauncherCli([
    '--worktree',directory,'--config',configPath,'--npm',npmPath,'--port','43127'
  ],{ launchImpl:async options => { captured=options;return { action:'opened-existing',dashboardUrl:options.dashboardUrl,pid:null }; },
    openDashboard:async () => {} });

  assert.equal(result.action,'opened-existing');
  assert.equal(captured.cwd,directory);
  assert.equal(captured.env.TEMU_CONFIG_PATH,configPath);
  assert.deepEqual(captured.dashboardCommand,[npmPath,['run','dashboard']]);
  assert.equal(captured.dashboardUrl,'http://127.0.0.1:43127/');
  assert.equal(captured.healthUrl,'http://127.0.0.1:43127/api/health');
  assert.equal(captured.lockPath,path.join(directory,'logs/operator-dashboard-launcher.lock'));
  assert.equal(captured.logPath,path.join(directory,'logs/operator-dashboard.log'));
  assert.equal(captured.pidPath,path.join(directory,'logs/operator-dashboard.pid'));
});

test('production launch options hard fail missing explicit paths',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-launch-options-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:20 }));
  assert.throws(() => createProductionLaunchOptions({ worktree:path.join(directory,'missing'),config:path.join(directory,'missing.json'),npm:'/missing/npm',port:37821 }),
    error => error.code === 'OPERATOR_WORKTREE_NOT_FOUND');
});

async function healthServer(t,body,{ status=200,contentType='application/json' }={}) {
  const server=http.createServer((_request,response) => {
    response.writeHead(status,{ 'Content-Type':contentType });
    response.end(typeof body === 'string' ? body:JSON.stringify(body));
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',() => { server.off('error',reject);resolve(); });
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port }=server.address();
  return { server,port,url:`http://127.0.0.1:${port}/api/health` };
}

async function unusedPort() {
  const server=net.createServer();
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',() => { server.off('error',reject);resolve(); });
  });
  const { port }=server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function lockFixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-launch-lock-'));
  const lockPath=path.join(directory,'launcher.lock');
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:20 }));
  return {
    lockPath,
    write(metadata) {
      fs.mkdirSync(lockPath,{ recursive:true });
      fs.writeFileSync(path.join(lockPath,'owner.json'),JSON.stringify(metadata));
    }
  };
}

async function processFixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-launch-process-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:20 }));
  const port=await unusedPort();
  return {
    directory,port,
    script:fileURLToPath(new URL('../fixtures/operator-dashboard-fixture.mjs',import.meta.url)),
    dashboardUrl:`http://127.0.0.1:${port}/`,
    healthUrl:`http://127.0.0.1:${port}/api/health`,
    options:{
      dashboardUrl:`http://127.0.0.1:${port}/`,healthUrl:`http://127.0.0.1:${port}/api/health`,
      host:'127.0.0.1',port,lockPath:path.join(directory,'launcher.lock'),
      logPath:path.join(directory,'operator-dashboard.log'),pidPath:path.join(directory,'operator-dashboard.pid'),
      healthTimeoutMs:5_000,healthPollIntervalMs:20
    }
  };
}

function processAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid,0);return true; } catch { return false; }
}

async function stopFixture(pid) {
  if (!processAlive(pid)) return;
  process.kill(pid,'SIGTERM');
  const deadline=Date.now()+2_000;
  while (processAlive(pid) && Date.now()<deadline) await new Promise(resolve => setTimeout(resolve,20));
}
