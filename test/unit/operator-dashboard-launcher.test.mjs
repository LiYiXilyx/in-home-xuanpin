import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  acquireLaunchLock,
  isTcpPortOccupied,
  launchOperatorDashboard,
  probeDashboardHealth
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
