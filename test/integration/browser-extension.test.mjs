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

  let response=await fetch(`${address.url}/api/browser-extension/context?goods_id=123456`,{ headers:{ Origin:'chrome-extension://fixture' } });
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'*');
  let body=await response.json();assert.equal(body.context.matched,true);assert.equal(body.context.cutoffDate,'2026-07-25');

  const payload={ goodsId:'123456',sourceUrl:'https://www.temu.com/goods.html?goods_id=123456',pageIndex:1,cards:[{
    reviewId:'review-1',ratingText:'5 out of 5 stars',contentText:'Strong fixture review',dateText:'August 20, 2026',rawText:'5 out of 5 stars Strong fixture review August 20, 2026',imageUrls:[]
  }] };
  response=await fetch(`${address.url}/api/browser-extension/capture-page`,{ method:'POST',headers:{ 'Content-Type':'application/json',Origin:'chrome-extension://fixture' },body:JSON.stringify(payload) });
  assert.equal(response.status,200);body=await response.json();assert.equal(body.result.inserted,1);assert.equal(body.result.valid,1);
  response=await fetch(`${address.url}/api/browser-extension/capture-page`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(payload) });
  body=await response.json();assert.equal(body.result.inserted,0);assert.equal(body.result.deduplicated,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count,1);

  response=await fetch(`${address.url}/api/browser-extension/context?goods_id=999999`);body=await response.json();assert.equal(body.context.matched,false);
  response=await fetch(`${address.url}/api/browser-extension/capture-page`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ ...payload,goodsId:'999999',sourceUrl:'https://www.temu.com/goods.html?goods_id=999999' }) });
  assert.equal(response.status,409);
});
