import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createJobRepository } from '../../src/db/repositories/job-repository.mjs';
import { createJobService } from '../../src/jobs/job-service.mjs';
import { createProductService } from '../../src/modules/products/product-service.mjs';

test('a 300 item catalog job resumes after interruption without duplicate items or snapshots', t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-resume-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  const databasePath=path.join(directory,'v2.db'); migrateDatabase({ databasePath });
  let db=openDatabase(databasePath);
  let repository=createJobRepository(db);
  let service=createJobService(repository);
  const job=service.create({ jobType:'catalog',siteCountry:'德国',language:'en',currency:'EUR',primaryCategory:'Automotive',subcategory:'Motorcycle',sourceUrl:'https://www.temu.com/category',sortOrder:'Top Sales',targetCount:300 });
  service.start(job.id);
  for (const product of makeProducts(150)) repository.upsertJobItem(job.id,{ sequenceNo:product.listing_rank,itemKey:product.goods_id,productUrl:product.canonical_url,checkpoint:{ product } });
  repository.heartbeat(job.id,{ phase:'listing_scroll',round:7,discoveredGoodsIds:makeProducts(150).map(item => item.goods_id),currentCount:150,lastEvent:'listing_round_completed' });
  db.close();

  db=openDatabase(databasePath);
  repository=createJobRepository(db);
  service=createJobService(repository);
  assert.equal(service.get(job.id).status,'running','hard process exit leaves a recoverable running row');
  service.interrupt(job.id,{ ...service.get(job.id).checkpoint,lastEvent:'process_restart_detected' });
  service.resume(job.id);
  const result=createProductService(db).persistCatalogBatch(service.get(job.id),makeProducts(300),{ minSafeCount:300 });
  assert.equal(result.insertedSnapshots,300);
  repository.updateCounts(job.id,{ totalItems:300,processedItems:300,successItems:300,failedItems:0,discoveredCount:300,storedCount:300,errorCount:0 });
  service.complete(job.id);
  assert.equal(service.get(job.id).status,'completed');
  assert.equal(service.get(job.id).resumeCount,1);
  assert.equal(repository.listJobItems(job.id).length,300);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count,300);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM product_snapshots WHERE job_id=?').get(job.id).count,300);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM crawl_job_items WHERE job_id=?').get(job.id).count,300);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships').get().count,300);
  assert.equal(new Set(repository.listJobItems(job.id).map(item => item.sequenceNo)).size,300);

  const retry=createProductService(db).persistCatalogBatch(service.get(job.id),makeProducts(300),{ minSafeCount:300 });
  assert.equal(retry.insertedSnapshots,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM product_snapshots WHERE job_id=?').get(job.id).count,300);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM crawl_job_items WHERE job_id=?').get(job.id).count,300);
  db.close();
});

function makeProducts(count) { return Array.from({ length:count },(_,index) => { const goodsId=String(900000000000000 + index); return { goods_id:goodsId,canonical_url:`https://www.temu.com/goods.html?goods_id=${goodsId}`,title:`Resume Product ${index + 1}`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:20 + index/100,sales_count:index + 1,rating:4.7,review_count:index + 5,listing_rank:index + 1,currency:'EUR',captured_at:'2026-08-21T03:00:00.000Z',extraction_quality:1,raw:{ fixture:true } }; }); }
