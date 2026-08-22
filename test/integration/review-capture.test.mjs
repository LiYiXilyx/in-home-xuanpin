import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { createJobRepository } from '../../src/db/repositories/job-repository.mjs';
import { createReviewRepository } from '../../src/db/repositories/review-repository.mjs';
import { createJobService } from '../../src/jobs/job-service.mjs';
import { runReviewCaptureJob } from '../../src/jobs/review-job-runner.mjs';
import { reviewCaptureQa } from '../../src/jobs/review-job-runner.mjs';
import { AppError } from '../../src/shared/errors.mjs';

test('review persistence deduplicates stable ids and fallback fingerprints while preserving coverage checkpoints',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-review-capture-'));t.after(() => fs.rmSync(directory,{ recursive:true,force:true }));
  const databasePath=path.join(directory,'v2.db');migrateDatabase({ databasePath });const db=openDatabase(databasePath);
  try {
    db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at)
      VALUES('temu','123','https://www.temu.com/goods.html?goods_id=123','test','2026-08-01','2026-08-22')`).run();
    const productId=Number(db.prepare("SELECT id FROM products WHERE external_product_id='123'").get().id);
    const jobs=createJobRepository(db,{ now:() => '2026-08-22T00:00:00.000Z' });const job=jobs.createJob({ jobType:'reviews',targetCount:1,config:{} });
    const repository=createReviewRepository(db,{ now:() => '2026-08-22T00:00:00.000Z' });repository.initializeCoverage(job.id,[{ productId,goodsId:'123' }],'2026-07-23');
    repository.startProduct(job.id,productId);
    const base={ productId,goodsId:'123',rating:5,content:'good',reviewDate:'2026-08-20',sku:null,country:'DE',hasImage:false,imageUrls:[],sourceUrl:'https://www.temu.com/goods.html?goods_id=123',capturedAt:'2026-08-22T00:00:00.000Z',contentFingerprint:'fingerprint',fallbackKey:'2026-08-20|5|fingerprint',raw:{} };
    const first=repository.saveReviews(job.id,[{ ...base,reviewId:'r1',dedupeKey:'id:r1' }]);
    const duplicate=repository.saveReviews(job.id,[{ ...base,reviewId:'r1',dedupeKey:'id:r1' },{ ...base,reviewId:null,dedupeKey:'fp:2026-08-20|5|fingerprint' }]);
    assert.equal(first.inserted,1);assert.equal(duplicate.inserted,0);assert.equal(duplicate.deduplicated,2);assert.equal(repository.countReviews(),1);
    repository.savePage(job.id,productId,{ pageIndex:2,reviewsCaptured:1,newestReviewDate:'2026-08-20',oldestReviewDate:'2026-08-20',checkpoint:{ pageIndex:2 } });
    repository.finishProduct(job.id,productId,{ taskStatus:'completed',crawlCompleteness:'complete',stopReason:'NO_MORE_REVIEWS',reviewsCaptured:1,pagesScanned:2,newestCapturedReviewDate:'2026-08-20',oldestCapturedReviewDate:'2026-08-20',checkpoint:{ pageIndex:2 } });
    const coverage=repository.getCoverage(job.id,productId);assert.equal(coverage.taskStatus,'completed');assert.equal(coverage.pagesScanned,2);assert.equal(coverage.checkpoint.pageIndex,2);
    assert.deepEqual(repository.qa(job.id),{ invalidRating:0,invalidDate:0,goodsMismatch:0,duplicateReviewId:0,duplicateFingerprint:0,invalidComplete:0,partialWithoutReason:0 });
  } finally { db.close(); }
});

test('review runner resumes page checkpoints after pause, CAPTCHA and browser closure',async t => {
  await t.test('unhealthy listing blocks before any product capture',async t => {
    const fixture=createRunnerFixture(t);let calls=0;
    const capture=async () => { calls+=1;return completedResult(); };
    await assert.rejects(() => runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,
      dependencies:fakeDependencies(capture,{ status:'NOT_READY',code:'STALE_CATEGORY_PAGE',checks:{ PAGE_HEALTH:'STALE_CATEGORY_PAGE' } }) }),error => error.code === 'JOB_PAUSED');
    assert.equal(calls,0);assert.equal(readJob(fixture.databasePath,fixture.jobId).status,'paused');
    const db=openDatabase(fixture.databasePath,{ readOnly:true });
    try { const coverage=createReviewRepository(db).listCoverage(fixture.jobId);assert.equal(coverage[0].taskStatus,'blocked');assert.equal(coverage[0].stopReason,'STALE_CATEGORY_PAGE'); }
    finally { db.close(); }
  });

  await t.test('pause and resume',async t => {
    const fixture=createRunnerFixture(t);let pauseOnce=true;
    const capture=async (_page,target,_config,hooks) => {
      if (pauseOnce) { pauseOnce=false;const other=openDatabase(fixture.databasePath);createJobService(createJobRepository(other)).pause(fixture.jobId);other.close(); }
      await hooks.onCheckpoint({ pageIndex:1,reviewsCaptured:0,newestCapturedReviewDate:null,oldestCapturedReviewDate:null });
      return completedResult();
    };
    await assert.rejects(() => runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,dependencies:fakeDependencies(capture) }),error => error.code === 'JOB_PAUSED');
    assert.equal(readJob(fixture.databasePath,fixture.jobId).status,'paused');
    const resumed=await runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,dependencies:fakeDependencies(capture) });
    assert.equal(resumed.job.status,'completed');assert.equal(resumed.coverage[0].taskStatus,'completed');assert.ok(resumed.coverage[0].retryCount >= 1);
  });

  await t.test('CAPTCHA manual gate and resume',async t => {
    const fixture=createRunnerFixture(t);let blocked=true;
    const capture=async () => { if (blocked) { blocked=false;throw new AppError('captcha',{ code:'CAPTCHA',retriable:true }); }return completedResult(); };
    await assert.rejects(() => runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,dependencies:fakeDependencies(capture) }),error => error.code === 'JOB_PAUSED');
    const paused=readJob(fixture.databasePath,fixture.jobId);assert.equal(paused.status,'paused');assert.equal(paused.checkpoint.manualGate.reason,'CAPTCHA');
    const resumed=await runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,dependencies:fakeDependencies(capture) });assert.equal(resumed.job.status,'completed');
  });

  await t.test('browser closed becomes interrupted and resumes',async t => {
    const fixture=createRunnerFixture(t);let closed=true;
    const capture=async () => { if (closed) { closed=false;throw new AppError('closed',{ code:'BROWSER_CLOSED',retriable:true }); }return completedResult(); };
    await assert.rejects(() => runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,dependencies:fakeDependencies(capture) }),error => error.code === 'JOB_INTERRUPTED');
    assert.equal(readJob(fixture.databasePath,fixture.jobId).status,'interrupted');
    const resumed=await runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,dependencies:fakeDependencies(capture) });assert.equal(resumed.job.status,'completed');
  });
});

test('Day9 QA never passes a finished batch containing failed or blocked coverage',async t => {
  const fixture=createRunnerFixture(t);
  await runReviewCaptureJob(fixture.config,{ jobId:fixture.jobId,dependencies:fakeDependencies(async () => ({
    taskStatus:'failed',crawlCompleteness:'failed',stopReason:'PAGE_CHANGED',reviewsCaptured:0,pagesScanned:0,
    newestCapturedReviewDate:null,oldestCapturedReviewDate:null,checkpoint:{}
  })) });
  const result=reviewCaptureQa(fixture.config,fixture.jobId);
  assert.equal(result.captureFinished,true);assert.equal(result.actionableFailures,1);assert.equal(result.pass,false);
});

function createRunnerFixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-review-runner-'));t.after(() => fs.rmSync(directory,{ recursive:true,force:true }));
  const databasePath=path.join(directory,'v2.db');migrateDatabase({ databasePath });const db=openDatabase(databasePath);
  db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at)
    VALUES('temu','123','https://www.temu.com/goods.html?goods_id=123','test','2026-08-01','2026-08-22')`).run();
  const productId=Number(db.prepare("SELECT id FROM products WHERE external_product_id='123'").get().id);const jobs=createJobRepository(db);
  const job=jobs.createJob({ jobType:'reviews',targetCount:1,config:{ runDate:'2026-08-22T00:00:00.000Z' } });
  jobs.upsertJobItem(job.id,{ sequenceNo:1,itemKey:'123',productId,productUrl:'https://www.temu.com/goods.html?goods_id=123',checkpoint:{ reviewCount:10 } });
  createReviewRepository(db).initializeCoverage(job.id,[{ productId,goodsId:'123' }],'2026-07-23');db.close();
  return { databasePath,jobId:job.id,config:{ app:{ databasePath },browser:{ mode:'external_cdp' },catalog:{ siteCountry:'DE',language:'en',currency:'EUR' },reviews:{ maxPagesPerProduct:200 } } };
}
function fakeDependencies(captureRecentReviews,health={ status:'READY',code:'READY',checks:{ PAGE_HEALTH:'READY' } }) { const page={ isClosed:() => false,close:async () => {} };return { captureRecentReviews,validateSessionHealth:async () => health,openBrowserSession:async () => ({ context:{ newPage:async () => page },external:true }),closeBrowserSession:async () => {} }; }
function completedResult() { return { taskStatus:'completed',crawlCompleteness:'complete',stopReason:'NO_MORE_REVIEWS',reviewsCaptured:0,pagesScanned:1,newestCapturedReviewDate:null,oldestCapturedReviewDate:null,checkpoint:{ pageIndex:1 } }; }
function readJob(databasePath,jobId) { const db=openDatabase(databasePath,{ readOnly:true });try { return createJobRepository(db).getJob(jobId); } finally { db.close(); } }
