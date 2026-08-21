import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';
import { createJobControl } from '../../src/jobs/job-control.mjs';
import { operatorMessage } from '../../src/server/status-service.mjs';

test('operator messages hide developer errors and explain recovery actions',() => {
  assert.match(operatorMessage('ECONNRESET','TypeError: socket failed'),/网络|VPN/);
  assert.match(operatorMessage('CDP_UNREACHABLE','browser closed'),/Chrome/);
  assert.match(operatorMessage('CAPTCHA_OR_LOGIN','captcha'),/人工|验证/);
  assert.doesNotMatch(operatorMessage('UNKNOWN','TypeError: C:\\secret\\source.mjs failed'),/TypeError|C:\\secret/);
});

test('Day 6 server controls jobs through SQLite and survives a server restart',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-server-jobs-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  const config=makeConfig(directory);
  const launches=[];
  let app=await makeServer(config,launches);
  let address=await app.listen({ port:0 });
  let base=address.url;

  let response=await request(base,'/api/jobs/start',{ targetCount:100 });
  assert.equal(response.status,202);
  const jobId=response.body.job.id;
  assert.equal(response.body.job.status,'pending');
  assert.deepEqual(launches.at(-1),{ jobId,action:'resume' });
  app.service.start(jobId);

  response=await request(base,'/api/jobs/start',{ targetCount:300 });
  assert.equal(response.status,409,'a second catalog job is rejected');
  assert.equal(response.body.error.code,'BROWSER_JOB_CONFLICT');
  assert.equal(JSON.stringify(response.body).includes('config'),false);

  response=await request(base,`/api/jobs/${jobId}/pause`,{});
  assert.equal(response.status,202);
  assert.equal(app.service.get(jobId).pauseRequested,true);
  assert.throws(() => createJobControl(app.repository).checkpointBoundary(jobId,{ phase:'listing_scroll',round:3,currentCount:41,lastEvent:'listing_round_completed' }),error => error.code === 'JOB_PAUSED');
  assert.equal(app.service.get(jobId).status,'paused');
  assert.ok(app.repository.listEvents(jobId).some(event => event.eventType === 'checkpoint_saved'));
  await app.close();

  app=await makeServer(config,launches);
  address=await app.listen({ port:0 });
  base=address.url;
  response=await request(base,'/api/status');
  assert.equal(response.body.currentJob.id,jobId);
  assert.equal(response.body.currentJob.status,'paused');
  assert.equal(response.body.checkpoint.currentCount,41);
  assert.ok(response.body.events.some(event => event.type === 'paused'));
  assert.equal(JSON.stringify(response.body).includes('browser-profile'),false);
  assert.equal(JSON.stringify(response.body).includes('token'),false);

  response=await request(base,`/api/jobs/${jobId}/resume`,{});
  assert.equal(response.status,202);
  assert.deepEqual(launches.at(-1),{ jobId,action:'resume' });
  app.service.resume(jobId);
  assert.equal(app.service.get(jobId).resumeCount,1);
  response=await request(base,`/api/jobs/${jobId}/cancel`,{});
  assert.equal(response.status,202);
  assert.equal(app.service.get(jobId).cancelRequested,true);
  assert.throws(() => createJobControl(app.repository).checkpointBoundary(jobId,{ round:4,currentCount:52 }),error => error.code === 'JOB_CANCELLED');
  assert.equal(app.service.get(jobId).status,'cancelled');
  await app.close();
});

test('retry only accepts retriable failed items and export records an event',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-server-retry-'));
  const launches=[];
  const app=await makeServer(makeConfig(directory),launches);
  t.after(async () => {
    await app.close();
    fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 });
  });
  const address=await app.listen({ port:0 });
  const base=address.url;

  const retriable=app.service.create({ jobType:'catalog',targetCount:100 });
  app.service.start(retriable.id);
  app.repository.upsertJobItem(retriable.id,{ sequenceNo:1,itemKey:'network-item' });
  app.repository.transitionJobItem(retriable.id,'network-item','running');
  app.repository.transitionJobItem(retriable.id,'network-item','failed',{ errorCode:'NETWORK_ERROR',errorMessage:'socket reset',checkpoint:{ retriable:true } });
  app.service.complete(retriable.id,{ failedItems:1 });
  let response=await request(base,`/api/jobs/${retriable.id}/retry`,{});
  assert.equal(response.status,202);
  assert.deepEqual(launches.at(-1),{ jobId:retriable.id,action:'retry' });

  app.service.retry(retriable.id);
  app.repository.transitionJobItem(retriable.id,'network-item','running');
  app.repository.transitionJobItem(retriable.id,'network-item','completed');
  app.service.complete(retriable.id);

  const permanent=app.service.create({ jobType:'catalog',targetCount:100 });
  app.service.start(permanent.id);
  app.repository.upsertJobItem(permanent.id,{ sequenceNo:1,itemKey:'permanent-item' });
  app.repository.transitionJobItem(permanent.id,'permanent-item','running');
  app.repository.transitionJobItem(permanent.id,'permanent-item','failed',{ errorCode:'INVALID_PRODUCT',checkpoint:{ permanent:true,retriable:false } });
  app.service.complete(permanent.id,{ failedItems:1 });
  response=await request(base,`/api/jobs/${permanent.id}/retry`,{});
  assert.equal(response.status,400);
  assert.equal(response.body.error.code,'NO_RETRIABLE_ITEMS');

  response=await request(base,'/api/export',{});
  assert.equal(response.status,200);
  const exportJob=app.service.get(response.body.result.jobId);
  assert.equal(exportJob.status,'completed');
  assert.ok(app.repository.listEvents(exportJob.id).some(event => event.eventType === 'export_completed'));
});

test('clear Excel requires confirmation and archives the workbook without touching SQLite',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-server-clear-excel-'));
  const config=makeConfig(directory);
  fs.mkdirSync(config.export.outputDir,{ recursive:true });
  const workbook=path.join(config.export.outputDir,'Temu运营商品池.xlsx');
  fs.writeFileSync(workbook,Buffer.from([0x50,0x4b,0x03,0x04]));
  const app=await makeServer(config,[]);
  t.after(async () => { await app.close(); fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const { url }=await app.listen({ port:0 });
  let response=await request(url,'/api/clear/excel',{});
  assert.equal(response.status,400);
  assert.equal(response.body.error.code,'CLEAR_EXCEL_CONFIRMATION_REQUIRED');
  response=await request(url,'/api/clear/excel',{ confirmed:true });
  assert.equal(response.status,200);
  assert.equal(response.body.archived,1);
  assert.equal(fs.existsSync(workbook),false);
  assert.equal(fs.readdirSync(path.join(config.export.outputDir,'.excel-history')).length,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM crawl_jobs').get().count,0);
});

async function makeServer(config,launches) {
  return createOperationsServer({ config,port:0,runProcess:({ jobId,action }) => launches.push({ jobId,action }),
    browserDependencies:{ ready:async () => true,openSession:async () => ({}) },openTarget:async () => {},
    exportWorkbook:async (_config,{ jobId }) => ({ jobId,savedPath:path.join(config.export.outputDir,'Temu运营商品池.xlsx'),products:300,embeddedImages:300,hyperlinks:300,timestampFallback:false }),
    logError:() => {}
  });
}

function makeConfig(directory) {
  return {
    configPath:path.join(directory,'config.json'),app:{ databasePath:path.join(directory,'v2.db') },
    browser:{ debugPort:9237,heartbeatTimeoutMs:30_000 },
    catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[{ primaryCategory:'Automotive',subcategory:'Motorcycles & Powersports Accessories',url:'https://www.temu.com/category',sortOrder:'Top Sales' }] },
    export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') }
  };
}

async function request(base,pathname,body) {
  const response=await fetch(`${base}${pathname}`,{ method:body === undefined ? 'GET':'POST',headers:{ 'Content-Type':'application/json' },body:body === undefined ? undefined:JSON.stringify(body) });
  return { status:response.status,body:await response.json() };
}
