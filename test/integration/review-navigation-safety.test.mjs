import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';
import { createReviewRepository } from '../../src/db/repositories/review-repository.mjs';

test('Day9.8 queue API circuit blocks new claims and resumes only after an explicit healthy recovery gate',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-review-safety-'));
  const config={ configPath:path.join(directory,'config.json'),app:{ environment:'development',databasePath:path.join(directory,'v2.db') },
    browser:{ mode:'external_cdp',profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000 },
    catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[] },
    reviews:{ navigationSafety:{ enabled:true,cooldownMs:0,minimumNavigationIntervalMs:0,maxNavigationAttemptsPerSession:5,maxProductsPerSession:2 } },
    export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') } };
  const app=await createOperationsServer({ config,runProcess:() => {},openTarget:async () => {},logError:() => {},browserDependencies:{ ready:async () => true } });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const job=app.repository.createJob({ jobType:'reviews',targetCount:2,config:{ cutoffDate:'2026-07-27' } });const coverage=[];
  for (const goodsId of ['111111','222222']) {
    app.db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at) VALUES('temu',?,?,?,?,?)`)
      .run(goodsId,`https://www.temu.com/de-en/fixture-g-${goodsId}.html`,`fixture-${goodsId}`,'2026-08-01','2026-08-26');
    const productId=Number(app.db.prepare('SELECT id FROM products WHERE external_product_id=?').get(goodsId).id);
    app.repository.upsertJobItem(job.id,{ sequenceNo:coverage.length+1,itemKey:goodsId,productId });coverage.push({ productId,goodsId });
  }
  createReviewRepository(app.db).initializeCoverage(job.id,coverage,'2026-07-27');
  const address=await app.listen({ port:0 });const post=async (route,payload) => {
    const response=await fetch(`${address.url}${route}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(payload) });
    return { response,body:await response.json() };
  };
  await post('/api/rpa/review-queue/enqueue',{ jobId:job.id,goodsIds:['111111','222222'] });
  let result=await post('/api/rpa/review-queue/claim-next',{ jobId:job.id });const first=result.body.result.item;
  let response=await fetch(`${address.url}/api/rpa/review-queue/current`);let body=await response.json();
  assert.equal(body.result.item.id,first.id);assert.equal(body.result.safety.state.circuitState,'closed');
  result=await post(`/api/rpa/review-queue/${first.id}/safety/signal`,{ goodsId:first.goodsId,code:'ITEMS_GONE',evidence:{ productCards:0 } });
  assert.equal(result.response.status,200);assert.equal(result.body.result.state.circuitState,'open');
  result=await post('/api/rpa/review-queue/claim-next',{ jobId:job.id });assert.equal(result.response.status,400);assert.equal(result.body.error.code,'REVIEW_SAFETY_GATE_OPEN');
  response=await fetch(`${address.url}/api/rpa/review-safety?job_id=${job.id}`);body=await response.json();
  assert.equal(body.result.state.reason,'ITEMS_GONE');assert.equal(body.result.state.manualRecoveryRequired,true);
  result=await post('/api/rpa/review-safety/recover',{ jobId:job.id,operatorConfirmed:true,health:{ loggedIn:true,productCardsVisible:false,captcha:false,siteCountry:'德国',language:'en',currency:'EUR' } });
  assert.equal(result.response.status,400);assert.equal(result.body.error.code,'REVIEW_SAFETY_RECOVERY_NOT_VALIDATED');
  result=await post('/api/rpa/review-safety/recover',{ jobId:job.id,operatorConfirmed:true,health:{ loggedIn:true,productCardsVisible:true,captcha:false,siteCountry:'德国',language:'en',currency:'EUR' } });
  assert.equal(result.response.status,200);assert.equal(result.body.result.state.circuitState,'closed');
  assert.equal(app.db.prepare('SELECT json_extract(checkpoint_json,\'$.safetyGate\') AS safetyGate FROM review_queue WHERE id=?').get(first.id).safetyGate,null);
  result=await post('/api/rpa/review-queue/claim-next',{ jobId:job.id });assert.equal(result.response.status,200);assert.notEqual(result.body.result.item.goodsId,first.goodsId);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM products').get().count,2);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,0);
});
