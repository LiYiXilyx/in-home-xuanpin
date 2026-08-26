import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';
import { createReviewRepository } from '../../src/db/repositories/review-repository.mjs';

test('Day9.5 localhost API matches the current task and saves through the existing review repository',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-extension-api-'));
  const config={
    configPath:path.join(directory,'config.json'),app:{ environment:'development',databasePath:path.join(directory,'v2.db') },
    browser:{ mode:'external_cdp',profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000 },
    catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[] },reviews:{},
    export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') }
  };
  const app=await createOperationsServer({ config,runProcess:() => {},openTarget:async () => {},logError:() => {},
    browserDependencies:{ ready:async () => true,openSession:async () => ({ context:{} }),connectSession:async () => ({ context:{} }),currentPage:async () => ({}),inspectPage:async () => ({ status:'READY',code:'READY',checks:{} }) } });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const job=app.repository.createJob({ jobType:'reviews',targetCount:1,config:{ cutoffDate:'2026-07-25' } });
  app.db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at)
    VALUES('temu','123456','https://www.temu.com/goods.html?goods_id=123456','fixture','2026-07-01','2026-08-24')`).run();
  const productId=Number(app.db.prepare("SELECT id FROM products WHERE external_product_id='123456'").get().id);
  app.repository.upsertJobItem(job.id,{ sequenceNo:1,itemKey:'123456',productId,productUrl:'https://www.temu.com/goods.html?goods_id=123456' });
  createReviewRepository(app.db).initializeCoverage(job.id,[{ productId,goodsId:'123456' }],'2026-07-25');
  const address=await app.listen({ port:0 });
  await prepareVerifiedQueue(address.url,job.id,'123456');

  let response=await fetch(`${address.url}/api/browser-extension/context?goods_id=123456`,{ headers:{ Origin:'chrome-extension://fixture' } });
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'*');
  let body=await response.json();assert.equal(body.context.matched,true);assert.equal(body.context.cutoffDate,'2026-07-25');

  const payload={ goodsId:'123456',sourceUrl:'https://www.temu.com/goods.html?goods_id=123456',pageIndex:1,cards:[{
    reviewId:'review-1',ratingText:'5 out of 5 stars',contentText:'Strong fixture review',dateText:'August 20, 2026',rawText:'5 out of 5 stars Strong fixture review August 20, 2026',imageUrls:[]
  }] };
  response=await fetch(`${address.url}/api/browser-extension/capture-page`,{ method:'POST',headers:{ 'Content-Type':'application/json',Origin:'chrome-extension://fixture' },body:JSON.stringify(payload) });
  assert.equal(response.status,200);body=await response.json();assert.equal(body.result.inserted,1);assert.equal(body.result.valid,1);
  assert.equal(app.repository.getJob(job.id).storedCount,1);
  assert.equal(app.repository.listJobItems(job.id)[0].status,'running');
  assert.equal(createReviewRepository(app.db).getCoverage(job.id,productId).taskStatus,'running');
  response=await fetch(`${address.url}/api/browser-extension/capture-page`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(payload) });
  body=await response.json();assert.equal(body.result.inserted,0);assert.equal(body.result.deduplicated,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,1);

  response=await fetch(`${address.url}/api/browser-extension/capture-page`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ ...payload,pageIndex:2,cards:[] }) });
  body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'INVALID_REVIEW_BATCH');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,1);

  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=999999`);body=await response.json();assert.equal(body.context.matched,false);
  response=await fetch(`${address.url}/api/browser-extension/capture-page`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ ...payload,goodsId:'999999',sourceUrl:'https://www.temu.com/goods.html?goods_id=999999' }) });
  assert.equal(response.status,409);
});

test('Day9.6 localhost API stores review batches, deduplicates across pages, and stops at cutoff',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-review-scroll-api-'));
  const config={ configPath:path.join(directory,'config.json'),app:{ environment:'development',databasePath:path.join(directory,'v2.db') },browser:{ mode:'external_cdp',profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000 },catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[] },reviews:{},export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') } };
  const app=await createOperationsServer({ config,runProcess:() => {},openTarget:async () => {},logError:() => {},browserDependencies:{ ready:async () => true,openSession:async () => ({ context:{} }),connectSession:async () => ({ context:{} }),currentPage:async () => ({}),inspectPage:async () => ({ status:'READY',code:'READY',checks:{} }) } });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const job=app.repository.createJob({ jobType:'reviews',targetCount:1,config:{ cutoffDate:'2026-07-25' } });
  app.db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at) VALUES('temu','987654','https://www.temu.com/goods.html?goods_id=987654','fixture','2026-07-01','2026-08-24')`).run();
  const productId=Number(app.db.prepare("SELECT id FROM products WHERE external_product_id='987654'").get().id);
  app.repository.upsertJobItem(job.id,{ sequenceNo:1,itemKey:'987654',productId,productUrl:'https://www.temu.com/goods.html?goods_id=987654' });
  createReviewRepository(app.db).initializeCoverage(job.id,[{ productId,goodsId:'987654' }],'2026-07-25');
  const address=await app.listen({ port:0 });
  await prepareVerifiedQueue(address.url,job.id,'987654');
  const sourceUrl='https://www.temu.com/goods.html?goods_id=987654';
  const card=(reviewId,dateText,contentText) => ({ reviewId,ratingText:'5 out of 5 stars',dateText,contentText,rawText:`5 out of 5 stars ${contentText} ${dateText}`,imageUrls:[] });
  const post=payload => fetch(`${address.url}/api/browser-extension/capture-batch`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(payload) });

  let response=await post({ goodsId:'987654',sourceUrl,pageIndex:1,cards:[card('new-1','August 20, 2026','new review one'),card('new-2','August 10, 2026','new review two')] });
  let body=await response.json();assert.equal(response.status,200);assert.equal(body.result.inserted,2);assert.equal(body.result.cutoffReached,false);
  response=await post({ goodsId:'987654',sourceUrl,pageIndex:2,cards:[card('new-2','August 10, 2026','new review two'),card('old-1','July 1, 2026','old review outside cutoff')] });
  body=await response.json();assert.equal(response.status,200);assert.equal(body.result.inserted,0);assert.equal(body.result.deduplicated,1);assert.equal(body.result.cutoffReached,true);assert.equal(body.result.eligible,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,2);
  const checkpoint=createReviewRepository(app.db).getCoverage(job.id,productId).checkpoint;
  assert.equal(checkpoint.source,'browser_extension_scroll');assert.equal(checkpoint.cutoffReached,true);assert.equal(checkpoint.pageIndex,2);
  response=await post({ goodsId:'987654',sourceUrl,pageIndex:3,cards:[] });body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'INVALID_REVIEW_BATCH');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,2);
  response=await fetch(`${address.url}/api/browser-extension/complete-scroll`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ goodsId:'987654',sourceUrl,stopReason:'CUTOFF_REACHED',cutoffReached:true,lastPageIndex:2 }) });
  body=await response.json();assert.equal(response.status,200);assert.equal(body.result.stopReason,'CUTOFF_REACHED');assert.equal(body.result.coverage.crawlCompleteness,'complete');assert.equal(body.result.coverage.taskStatus,'completed');
  assert.equal(app.repository.listJobItems(job.id)[0].status,'completed');
});

test('Day9.7 RPA queue claims three products and Extension advances one item to completed',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-review-queue-api-'));
  const config={ configPath:path.join(directory,'config.json'),app:{ environment:'development',databasePath:path.join(directory,'v2.db') },browser:{ mode:'managed_profile',profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000 },catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[] },reviews:{},export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') } };
  const app=await createOperationsServer({ config,runProcess:() => {},openTarget:async () => {},logError:() => {},browserDependencies:{ ready:async () => true,openSession:async () => ({ context:{} }),connectSession:async () => ({ context:{} }),currentPage:async () => ({}),inspectPage:async () => ({ status:'READY',code:'READY',checks:{} }) } });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const job=app.repository.createJob({ jobType:'reviews',targetCount:3,config:{ cutoffDate:'2026-07-25' } });
  const goodsIds=['111111','222222','333333'];const coverage=[];
  for (const [index,goodsId] of goodsIds.entries()) {
    const sourceUrl=`https://www.temu.com/de-en/fixture-g-${goodsId}.html`;
    app.db.prepare(`INSERT INTO products(platform,external_product_id,source_url,canonical_url,title,first_seen_at,last_seen_at) VALUES('temu',?,?,?,?,?,?)`).run(goodsId,sourceUrl,`https://www.temu.com/goods.html?goods_id=${goodsId}`,`fixture-${goodsId}`,'2026-07-01','2026-08-24');
    const productId=Number(app.db.prepare('SELECT id FROM products WHERE external_product_id=?').get(goodsId).id);
    app.repository.upsertJobItem(job.id,{ sequenceNo:index+1,itemKey:goodsId,productId,productUrl:sourceUrl });coverage.push({ productId,goodsId });
  }
  createReviewRepository(app.db).initializeCoverage(job.id,coverage,'2026-07-25');
  const poolBefore=app.db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  const address=await app.listen({ port:0 });const post=(route,payload) => fetch(`${address.url}${route}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(payload) });

  let response=await post('/api/rpa/review-queue/enqueue',{ jobId:job.id,goodsIds });let body=await response.json();
  assert.equal(response.status,200);assert.equal(body.result.items.length,3);assert.deepEqual(body.result.counts,{ pending:3 });
  response=await post('/api/rpa/review-queue/claim-next',{ jobId:job.id });body=await response.json();
  const first=body.result.item;assert.ok(goodsIds.includes(first.goodsId));assert.equal(first.status,'opening');assert.equal(first.sourceUrl,undefined);assert.equal(first.navigationRequired,true);
  const firstFreshUrl=`https://www.temu.com/de-en/fresh-category-card-g-${first.goodsId}.html?refer_page_name=category`;
  response=await fetch(`${address.url}/api/rpa/review-queue/${first.id}`);body=await response.json();assert.equal(response.status,200);assert.equal(body.result.item.id,first.id);assert.equal(body.result.terminal,false);
  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=${first.goodsId}`);body=await response.json();
  assert.equal(body.context.matched,false);assert.equal(body.context.queueId,first.id);assert.equal(body.context.jobId,job.id);
  assert.equal(body.context.goodsId,first.goodsId);assert.equal(body.context.cutoffDate,'2026-07-25');assert.equal(body.context.queueStatus,'opening');assert.equal(body.context.navigationVerified,false);
  response=await post('/api/browser-extension/capture-batch',{ goodsId:first.goodsId,sourceUrl:firstFreshUrl,pageIndex:1,cards:[{ reviewId:'blocked',ratingText:'5 out of 5 stars',contentText:'must not save before verification',dateText:'August 20, 2026',rawText:'blocked',imageUrls:[] }] });body=await response.json();assert.equal(response.status,409);assert.equal(body.error.code,'REVIEW_TASK_MISMATCH');
  response=await post(`/api/rpa/review-queue/${first.id}/navigation/resolve`,{ goodsId:first.goodsId,sourcePageUrl:'https://www.temu.com/de-en/motorcycles--accessories.html',currentCategoryCards:[{ href:'https://www.temu.com/de-en/wrong-g-999999.html' },{ href:firstFreshUrl }] });body=await response.json();assert.equal(body.result.resolution.resolutionMethod,'CURRENT_CATEGORY_CARD');
  response=await post(`/api/rpa/review-queue/${first.id}/navigation/verify`,{ goodsId:first.goodsId,detailUrl:firstFreshUrl,detailText:'Add to cart Item reviews' });body=await response.json();assert.equal(body.result.item.status,'waiting_operator');assert.equal(body.result.resolution.errorCode,'FRESH_DETAIL_VERIFIED');
  const oldJob=app.repository.createJob({ jobType:'reviews',targetCount:1,config:{ cutoffDate:'2026-01-01',purpose:'old-job-must-not-steal-context' } });
  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=${first.goodsId}`);body=await response.json();
  assert.equal(body.context.matched,true);assert.equal(body.context.queueId,first.id);assert.equal(body.context.jobId,job.id);assert.notEqual(body.context.jobId,oldJob.id);
  assert.equal(body.context.goodsId,first.goodsId);assert.equal(body.context.cutoffDate,'2026-07-25');assert.equal(body.context.queueStatus,'waiting_operator');assert.equal(body.context.navigationVerified,true);
  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=999999`);body=await response.json();assert.equal(body.context.matched,false);assert.equal(body.context.queueId,first.id);assert.equal(body.context.goodsId,first.goodsId);
  response=await post('/api/browser-extension/capture-batch',{ goodsId:'999999',sourceUrl:'https://www.temu.com/de-en/wrong-g-999999.html',pageIndex:1,cards:[{ reviewId:'wrong',ratingText:'5 out of 5 stars',contentText:'wrong goods',dateText:'August 20, 2026',rawText:'wrong',imageUrls:[] }] });body=await response.json();assert.equal(response.status,409);assert.equal(app.db.prepare('SELECT status FROM review_queue WHERE id=?').get(first.id).status,'waiting_operator');
  response=await post('/api/browser-extension/capture-batch',{ goodsId:first.goodsId,sourceUrl:firstFreshUrl,pageIndex:1,cards:[{ reviewId:'rpa-1',ratingText:'5 out of 5 stars',contentText:'RPA queue fixture review',dateText:'August 20, 2026',rawText:'5 out of 5 stars RPA queue fixture review August 20, 2026',imageUrls:[] }] });body=await response.json();assert.equal(body.result.inserted,1);
  assert.equal(app.db.prepare('SELECT status FROM review_queue WHERE id=?').get(first.id).status,'capturing');
  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=${first.goodsId}`);body=await response.json();assert.equal(body.context.matched,true);assert.equal(body.context.queueStatus,'capturing');
  response=await post('/api/browser-extension/capture-failed',{ goodsId:first.goodsId,errorCode:'MANUAL_VERIFICATION_REQUIRED',errorMessage:'采集中等待人工完成 Temu 安全验证。' });body=await response.json();
  assert.equal(response.status,200);assert.equal(body.result.recoverable,true);assert.equal(body.result.queueStatus,'capturing');
  assert.equal(app.db.prepare('SELECT status FROM review_queue WHERE id=?').get(first.id).status,'capturing');assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,1);
  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=${first.goodsId}`);body=await response.json();assert.equal(body.context.matched,true);assert.equal(body.context.queueStatus,'capturing');
  response=await post('/api/browser-extension/complete-scroll',{ goodsId:first.goodsId,sourceUrl:firstFreshUrl,stopReason:'CUTOFF_REACHED',cutoffReached:true,lastPageIndex:1 });body=await response.json();assert.equal(response.status,200);
  assert.equal(app.db.prepare('SELECT status FROM review_queue WHERE id=?').get(first.id).status,'completed');
  response=await fetch(`${address.url}/api/rpa/review-queue/${first.id}`);body=await response.json();assert.equal(body.result.item.status,'completed');assert.equal(body.result.terminal,true);
  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=${first.goodsId}`);body=await response.json();assert.equal(body.context.matched,false);assert.equal(body.context.queueId,null);

  response=await post('/api/rpa/review-queue/claim-next',{ jobId:job.id });body=await response.json();const second=body.result.item;assert.ok(goodsIds.includes(second.goodsId));assert.notEqual(second.goodsId,first.goodsId);
  response=await post(`/api/rpa/review-queue/${second.id}/waiting-operator`,{ goodsId:'999999' });assert.equal(response.status,400);assert.equal(app.db.prepare('SELECT status FROM review_queue WHERE id=?').get(second.id).status,'opening');
  response=await post(`/api/rpa/review-queue/${second.id}/waiting-operator`,{ goodsId:second.goodsId });body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'NAVIGATION_NOT_RESOLVED');
  response=await post(`/api/rpa/review-queue/${second.id}/navigation/resolve`,{ goodsId:second.goodsId,currentCategoryCards:[],siteSearchCards:[] });body=await response.json();assert.equal(body.result.resolution.errorCode,'NAVIGATION_NOT_RESOLVED');
  const secondFreshUrl=`https://www.temu.com/de-en/fresh-search-card-g-${second.goodsId}.html`;
  response=await post(`/api/rpa/review-queue/${second.id}/navigation/resolve`,{ goodsId:second.goodsId,sourcePageUrl:'https://www.temu.com/de-en/search_result.html',currentCategoryCards:[`https://www.temu.com/de-en/wrong-g-999999.html`],siteSearchCards:[secondFreshUrl] });body=await response.json();assert.equal(body.result.resolution.resolutionMethod,'SITE_SEARCH_CARD');
  response=await post(`/api/rpa/review-queue/${second.id}/navigation/verify`,{ goodsId:second.goodsId,detailUrl:'https://www.temu.com/de-en/wrong-g-999999.html',detailText:'Add to cart' });body=await response.json();assert.equal(body.result.resolution.errorCode,'NAVIGATION_CONTEXT_MISMATCH');assert.equal(body.result.item.status,'opening');
  response=await post(`/api/rpa/review-queue/${second.id}/navigation/verify`,{ goodsId:second.goodsId,detailUrl:secondFreshUrl,detailText:'Add to cart' });body=await response.json();assert.equal(body.result.item.status,'waiting_operator');
  response=await post('/api/browser-extension/capture-failed',{ goodsId:second.goodsId,errorCode:'MANUAL_VERIFICATION_REQUIRED',errorMessage:'等待人工完成 Temu 安全验证超时。' });body=await response.json();
  assert.equal(response.status,200);assert.equal(body.result.recoverable,true);assert.equal(body.result.queueStatus,'waiting_operator');
  assert.equal(app.db.prepare('SELECT status FROM review_queue WHERE id=?').get(second.id).status,'waiting_operator');
  assert.equal(createReviewRepository(app.db).getCoverage(job.id,coverage.find(item => item.goodsId === second.goodsId).productId).taskStatus,'pending');
  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=${second.goodsId}`);body=await response.json();assert.equal(body.context.matched,true);assert.equal(body.context.navigationVerified,true);
  response=await post(`/api/rpa/review-queue/${second.id}/fail`,{ goodsId:second.goodsId,errorCode:'PAGE_TIMEOUT',errorMessage:'页面等待超时' });body=await response.json();assert.equal(body.result.status,'failed');
  response=await post(`/api/rpa/review-queue/${second.id}/retry`,{});body=await response.json();assert.equal(body.result.status,'pending');

  response=await post('/api/browser-extension/capture-failed',{ goodsId:second.goodsId,errorCode:'EXTENSION_CAPTURE_FAILED',errorMessage:'未找到完整评论区域。' });body=await response.json();
  assert.equal(response.status,200);assert.equal(body.result.ignored,true);assert.equal(app.db.prepare('SELECT status FROM review_queue WHERE id=?').get(second.id).status,'pending');
  const third=app.db.prepare("SELECT goods_id AS goodsId FROM review_queue WHERE job_id=? AND status='pending'").get(job.id);
  response=await post('/api/browser-extension/capture-failed',{ goodsId:third.goodsId,errorCode:'EXTENSION_CAPTURE_FAILED',errorMessage:'未找到完整评论区域。' });body=await response.json();
  assert.equal(response.status,200);assert.equal(body.result.ignored,true);

  response=await fetch(`${address.url}/api/rpa/review-queue?job_id=${encodeURIComponent(job.id)}`);body=await response.json();
  assert.equal(body.result.items.length,3);assert.equal(body.result.counts.completed,1);assert.equal(body.result.counts.pending,2);
  assert.equal(app.repository.getJob(job.id).status,'pending');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM products').get().count,poolBefore);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM navigation_resolutions').get().count,3);
  for (const goodsId of goodsIds) assert.equal(app.db.prepare('SELECT source_url AS sourceUrl FROM products WHERE external_product_id=?').get(goodsId).sourceUrl,`https://www.temu.com/de-en/fixture-g-${goodsId}.html`);
});

async function prepareVerifiedQueue(baseUrl,jobId,goodsId) {
  const post=async (route,payload) => {
    const response=await fetch(`${baseUrl}${route}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(payload) });
    const body=await response.json();
    assert.equal(response.status,200,body.error?.message);
    return body.result;
  };
  await post('/api/rpa/review-queue/enqueue',{ jobId,goodsIds:[goodsId] });
  const claimed=await post('/api/rpa/review-queue/claim-next',{ jobId });
  const freshUrl=`https://www.temu.com/de-en/verified-fixture-g-${goodsId}.html`;
  await post(`/api/rpa/review-queue/${claimed.item.id}/navigation/resolve`,{ goodsId,currentCategoryCards:[freshUrl] });
  await post(`/api/rpa/review-queue/${claimed.item.id}/navigation/verify`,{ goodsId,detailUrl:freshUrl,detailText:'Add to cart Item reviews' });
}
