import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileBlob,SpreadsheetFile } from '@oai/artifact-tool';
import { createOperationsServer } from '../../src/server/index.mjs';
import { createJobControl } from '../../src/jobs/job-control.mjs';
import { operatorMessage } from '../../src/server/status-service.mjs';

test('operator messages hide developer errors and explain recovery actions',() => {
  assert.match(operatorMessage('ECONNRESET','TypeError: socket failed'),/网络|VPN/);
  assert.match(operatorMessage('CDP_UNREACHABLE','browser closed'),/Chrome/);
  assert.match(operatorMessage('CAPTCHA_OR_LOGIN','captcha'),/人工|验证/);
  assert.match(operatorMessage('SEARCH_NO_RESULTS','No results'),/无结果|profile/);
  assert.match(operatorMessage('STALE_CATEGORY_PAGE','items gone'),/类目|失效/);
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
  assert.equal(response.body.browser.profileName,'browser-profile-test');
  assert.equal(JSON.stringify(response.body).includes(directory),false);
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
  assert.equal(response.body.emptyWorkbook,true);
  assert.equal(fs.existsSync(workbook),true);
  assert.equal(fs.readdirSync(path.join(config.export.outputDir,'.excel-history')).length,1);
  const emptyWorkbook=await SpreadsheetFile.importXlsx(await FileBlob.load(workbook));
  assert.deepEqual(emptyWorkbook.worksheets.items.map(sheet => sheet.name),['商品池','数据质量','任务记录','字段说明']);
  const emptyProductValues=emptyWorkbook.worksheets.getItem('商品池').getUsedRange(true)?.values ?? [];
  assert.equal(emptyProductValues.length,1);
  assert.equal(emptyProductValues[0].length,19);
  response=await request(url,'/api/status');
  assert.equal(response.body.latestExcel.exists,true,'the archived workbook remains available to open');
  assert.equal(response.body.currentExcelExists,true,'the new empty workbook remains available to open');
  response=await request(url,'/api/open/excel',{});
  assert.equal(response.status,200);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM crawl_jobs').get().count,0);
});

test('NOT_READY blocks capture and a fresh profile uses a new port without exposing its path',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-server-profile-'));
  const config=makeConfig(directory);
  const oldProfile=path.join(directory,'browser-profile-old');
  config.browser.profileDir=oldProfile;
  fs.mkdirSync(oldProfile);
  const launches=[];
  const app=await createOperationsServer({ config,runProcess:({ jobId,action }) => launches.push({ jobId,action }),
    browserDependencies:{ ready:async () => true,connectSession:async () => ({ context:{} }),currentPage:async () => ({}),
      inspectPage:async () => ({ status:'NOT_READY',code:'SEARCH_NO_RESULTS',checks:{ CDP_CONNECTED:true,TEMU_PAGE:true,PAGE_HEALTH:'SEARCH_NO_RESULTS' },
        diagnostics:{ urlHost:'www.temu.com',urlPath:'/search_result.html',queryParamNames:['search_key','_x_sessn_id'],
          sessionParamNames:['_x_sessn_id'],navigatorOnline:true,markers:{ searchNoResults:true } } }),
      createFresh:async () => ({ profileDir:path.join(directory,'browser-profile-fresh-test'),profileName:'browser-profile-fresh-test',debugPort:9238 }),
      openSession:async () => ({ context:{} }),saveRuntime:async () => {} },openTarget:async () => {},exportWorkbook:async () => ({}),logError:() => {} });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const { url }=await app.listen({ port:0 });
  let validation=await request(url,'/api/browser/validate',{});
  assert.equal(validation.body.validation.diagnostics.urlPath,'/search_result.html');
  assert.deepEqual(validation.body.validation.diagnostics.sessionParamNames,['_x_sessn_id']);
  assert.equal(JSON.stringify(validation.body).includes('Cookie'),false);
  let response=await request(url,'/api/jobs/start',{ targetCount:100 });
  assert.equal(response.status,400);
  assert.equal(response.body.error.code,'SEARCH_NO_RESULTS');
  assert.equal(launches.length,0);
  response=await request(url,'/api/browser/new',{});
  assert.equal(response.status,200);
  assert.equal(response.body.profileName,'browser-profile-fresh-test');
  assert.equal(response.body.port,9238);
  assert.equal(fs.existsSync(oldProfile),true,'old profile remains');
  assert.equal(JSON.stringify(response.body).includes(directory),false);
});

test('external Chrome reconnect refreshes a stale session and server shutdown leaves the user browser open',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-server-external-cdp-'));
  const config=makeConfig(directory);
  config.browser.mode='external_cdp';
  config.browser.cdpEndpoint='http://127.0.0.1:9333';
  let connectCalls=0,browserCloseCalls=0;
  const app=await createOperationsServer({ config,runProcess:() => { throw new Error('capture must not start'); },
    browserDependencies:{ ready:async endpoint => endpoint === config.browser.cdpEndpoint,
      connectSession:async supplied => {
        connectCalls+=1;assert.equal(supplied.browser.cdpEndpoint,config.browser.cdpEndpoint);
        return { context:{},external:true,browser:{ close:async () => { browserCloseCalls+=1; } } };
      },currentPage:async () => ({}),inspectPage:async () => ({ status:'READY',code:'READY',checks:{
        CDP_CONNECTED:true,TEMU_PAGE:true,PRODUCT_LIST_VISIBLE:true,CATEGORY_CONFIRMED:true,TOP_SALES_CONFIRMED:true,PAGE_HEALTH:'READY' } }) },
    openTarget:async () => {},exportWorkbook:async () => ({}),logError:() => {} });
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  const { url }=await app.listen({ port:0 });
  let response=await request(url,'/api/status');
  assert.equal(response.body.browser.mode,'external_cdp');
  assert.equal(response.body.browser.modeLabel,'External Chrome');
  assert.equal(response.body.browser.profileName,'不适用');
  assert.equal(response.body.browser.connected,false);
  assert.equal(response.body.browser.endpointAvailable,true);
  response=await request(url,'/api/browser/connect',{});
  assert.equal(response.status,200);
  assert.equal(connectCalls,1);
  response=await request(url,'/api/browser/connect',{});
  assert.equal(response.status,200);
  assert.equal(response.body.alreadyOpen,true);
  assert.equal(connectCalls,2,'explicit reconnect must replace a stale in-memory CDP session');
  response=await request(url,'/api/browser/validate',{});
  assert.equal(response.body.validation.status,'READY');
  assert.equal(JSON.stringify(response.body).includes(directory),false);
  await app.close();
  assert.equal(browserCloseCalls,0);
});

test('production mode refuses the test reset endpoint',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-production-reset-guard-'));
  const app=await makeServer(makeConfig(directory),[]);
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const { url }=await app.listen({ port:0 });
  const response=await request(url,'/api/test/reset',{ confirmed:true,phrase:'RESET_TEST_DATA' });
  assert.equal(response.status,400);
  assert.equal(response.body.error.code,'TEST_MODE_REQUIRED');
});

test('test mode reset clears only isolated test data and creates an empty workbook',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-test-mode-reset-'));
  const config=makeConfig(directory);
  config.configPath=path.join(directory,'config.test.json');
  config.app.environment='test';
  config.app.databasePath=path.join(directory,'data','test','temu_research_test.db');
  config.app.legacyDatabasePath=path.join(directory,'data','test','legacy-unused.db');
  config.app.backupDir=path.join(directory,'backups','test');
  config.app.logDir=path.join(directory,'logs','test');
  config.export.outputDir=path.join(directory,'outputs','test-run');
  config.export.imageCacheDir=path.join(config.export.outputDir,'image-cache');
  const productionSentinel=path.join(directory,'data','temu_research_v2.db');
  fs.mkdirSync(path.dirname(productionSentinel),{ recursive:true });
  fs.writeFileSync(productionSentinel,'PRODUCTION_MUST_NOT_CHANGE');
  fs.mkdirSync(config.export.imageCacheDir,{ recursive:true });
  fs.writeFileSync(path.join(config.export.imageCacheDir,'test-image.webp'),'test image');

  const app=await makeServer(config,[]);
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const oldJob=app.service.create({ jobType:'catalog',targetCount:100 });
  app.service.start(oldJob.id);app.service.complete(oldJob.id);
  const { url }=await app.listen({ port:0 });
  let response=await request(url,'/api/test/reset',{ confirmed:true,phrase:'WRONG' });
  assert.equal(response.status,400);
  assert.equal(response.body.error.code,'TEST_RESET_CONFIRMATION_REQUIRED');

  response=await request(url,'/api/test/reset',{ confirmed:true,phrase:'RESET_TEST_DATA' });
  assert.equal(response.status,200);
  assert.equal(response.body.reset,true);
  assert.equal(response.body.emptyWorkbook,true);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM crawl_jobs').get().count,0);
  assert.equal(fs.readFileSync(productionSentinel,'utf8'),'PRODUCTION_MUST_NOT_CHANGE');
  assert.equal(fs.existsSync(path.join(config.export.outputDir,'Temu运营商品池.xlsx')),true);
  assert.equal(fs.existsSync(config.export.imageCacheDir),true);
  assert.ok(fs.readdirSync(config.app.backupDir).some(name => name.startsWith('test-db-before-reset-')));
  assert.ok(fs.readdirSync(config.app.backupDir).some(name => name.startsWith('test-output-before-reset-')));
  response=await request(url,'/api/status');
  assert.deepEqual(response.body.environment,{ name:'test',testMode:true });
  assert.equal(response.body.activeProducts,0);
});

async function makeServer(config,launches) {
  return createOperationsServer({ config,port:0,runProcess:({ jobId,action }) => launches.push({ jobId,action }),
    browserDependencies:{ ready:async () => true,openSession:async () => ({ context:{} }),connectSession:async () => ({ context:{} }),
      currentPage:async () => ({}),inspectPage:async () => ({ status:'READY',code:'READY',checks:{ CDP_CONNECTED:true,TEMU_PAGE:true,PAGE_HEALTH:'READY' } }) },openTarget:async () => {},
    exportWorkbook:async (_config,{ jobId }) => ({ jobId,savedPath:path.join(config.export.outputDir,'Temu运营商品池.xlsx'),products:300,embeddedImages:300,hyperlinks:300,timestampFallback:false }),
    logError:() => {}
  });
}

function makeConfig(directory) {
  return {
    configPath:path.join(directory,'config.json'),app:{ databasePath:path.join(directory,'v2.db') },
    browser:{ profileDir:path.join(directory,'browser-profile-test'),debugPort:9237,heartbeatTimeoutMs:30_000 },
    catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[{ primaryCategory:'Automotive',subcategory:'Motorcycles & Powersports Accessories',url:'https://www.temu.com/category',sortOrder:'Top Sales' }] },
    export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') }
  };
}

async function request(base,pathname,body) {
  const response=await fetch(`${base}${pathname}`,{ method:body === undefined ? 'GET':'POST',headers:{ 'Content-Type':'application/json' },body:body === undefined ? undefined:JSON.stringify(body) });
  return { status:response.status,body:await response.json() };
}
