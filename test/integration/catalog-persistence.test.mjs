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

test('catalog persistence separates identity, membership and per-job snapshots for 300 products', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-persistence-'));
  const db = openDay4Database(directory);
  t.after(() => db.close());
  t.after(() => fs.rmSync(directory,{ recursive: true,force: true,maxRetries: 5,retryDelay: 50 }));
  const jobs = createJobRepository(db,{ now: () => '2026-08-21T00:00:00.000Z' });
  const service = createJobService(jobs);
  const productService = createProductService(db,{ now: () => '2026-08-21T00:00:00.000Z' });
  const first = createCatalogJob(service);
  service.start(first.id);
  const initial = makeProducts(300);
  const saved = productService.persistCatalogBatch(service.get(first.id),initial,{ minSafeCount: 300 });
  assert.equal(saved.products,300);
  assert.equal(saved.insertedSnapshots,300);
  assert.equal(saved.activeCount,300);
  assertCounts(db,{ products: 300,memberships: 300,snapshots: 300,items: 300 });
  assert.equal(db.prepare('SELECT COUNT(DISTINCT product_id) AS count FROM crawl_job_items WHERE job_id=?').get(first.id).count,300);

  const changed = initial.map(item => ({ ...item,title: `Changed ${item.goods_id}`,
    source_url: `${item.source_url}&title_changed=1`,canonical_url: `${item.canonical_url}&title_changed=1` }));
  const sameJob = productService.persistCatalogBatch(service.get(first.id),changed,{ minSafeCount: 300 });
  assert.equal(sameJob.insertedSnapshots,0,'same product+job must not add snapshots');
  assertCounts(db,{ products: 300,memberships: 300,snapshots: 300,items: 300 });
  assert.equal(db.prepare('SELECT source_url FROM products WHERE external_product_id=?').get(initial[0].goods_id).source_url,changed[0].source_url);
  service.complete(first.id);

  const second = createCatalogJob(service,'2026-08-21T01:00:00.000Z');
  service.start(second.id);
  const nextJob = productService.persistCatalogBatch(service.get(second.id),makeProducts(300,'2026-08-21T01:00:00.000Z'),{ minSafeCount: 300 });
  assert.equal(nextJob.insertedSnapshots,300);
  assertCounts(db,{ products: 300,memberships: 300,snapshots: 600,items: 600 });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM data_quality_checks WHERE job_id=?').get(second.id).count,15);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count,300);
  assert.deepEqual(db.prepare('SELECT current_rank AS rank FROM catalog_memberships WHERE active=1 ORDER BY current_rank').all().map(row => row.rank),
    Array.from({ length: 300 },(_,index) => index + 1));
});

test('safe pool switch rejects a low batch and only inactivates replaced memberships after an accepted batch', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-safety-'));
  const db = openDay4Database(directory);
  t.after(() => db.close());
  t.after(() => fs.rmSync(directory,{ recursive: true,force: true,maxRetries: 5,retryDelay: 50 }));
  const jobs = createJobRepository(db);
  const service = createJobService(jobs);
  const productService = createProductService(db);
  const first = createCatalogJob(service); service.start(first.id);
  productService.persistCatalogBatch(service.get(first.id),makeProducts(300),{ minSafeCount: 300 });
  service.complete(first.id);
  const activeBefore = activeIds(db);

  const low = createCatalogJob(service); service.start(low.id);
  assert.throws(() => productService.persistCatalogBatch(service.get(low.id),makeProducts(5),{ minSafeCount: 300 }),
    error => error.code === 'CATALOG_POOL_SAFETY_REJECTED');
  service.fail(low.id,Object.assign(new Error('low safety count'),{ code:'CATALOG_POOL_SAFETY_REJECTED' }));
  assert.deepEqual(activeIds(db),activeBefore,'rejected batch must not change the current pool');
  assertCounts(db,{ products: 300,memberships: 300,snapshots: 300,items: 300 });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM data_quality_checks WHERE job_id=?').get(low.id).count,15);

  const replacement = createCatalogJob(service); service.start(replacement.id);
  const products = makeProducts(299,'2026-08-21T02:00:00.000Z',2);
  products.push(makeProduct(999999,300,'2026-08-21T02:00:00.000Z'));
  const switched = productService.persistCatalogBatch(service.get(replacement.id),products,{ minSafeCount: 300 });
  assert.equal(switched.deactivated,1);
  assert.equal(db.prepare("SELECT active FROM catalog_memberships m JOIN products p ON p.id=m.product_id WHERE p.external_product_id='800000000000001'").get().active,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM product_snapshots s JOIN products p ON p.id=s.product_id WHERE p.external_product_id='800000000000001'").get().count,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products WHERE external_product_id='800000000000001'").get().count,1);
});

function openDay4Database(directory) { const databasePath=path.join(directory,'v2.db'); migrateDatabase({ databasePath }); return openDatabase(databasePath); }
function createCatalogJob(service) { return service.create({ jobType:'catalog',siteCountry:'德国',language:'en',currency:'EUR',primaryCategory:'Automotive',subcategory:'Motorcycle',sourceUrl:'https://www.temu.com/category',sortOrder:'Top Sales',targetCount:300 }); }
function makeProducts(count,capturedAt='2026-08-21T00:00:00.000Z',start=1) { return Array.from({ length: count },(_,index) => makeProduct(index + start,index + 1,capturedAt)); }
function makeProduct(index,rank,capturedAt) { const goodsId=String(800000000000000 + index); return { goods_id:goodsId,source_url:`https://www.temu.com/motorcycle-part-g-${goodsId}.html?refer_page=top_sales`,canonical_url:`https://www.temu.com/goods.html?goods_id=${goodsId}`,title:`Motorcycle Product ${index}`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:10 + index/100,sales_count:index,rating:4.8,review_count:index + 10,listing_rank:rank,site_country:'德国',language:'en',currency:'EUR',primary_category:'Automotive',subcategory:'Motorcycle',sort_order:'Top Sales',captured_at:capturedAt,extraction_quality:1,raw:{ fixture:true } }; }
function activeIds(db) { return db.prepare('SELECT product_id AS productId FROM catalog_memberships WHERE active=1 ORDER BY product_id').all().map(row => row.productId); }
function assertCounts(db,expected) { const tables={ products:'products',memberships:'catalog_memberships',snapshots:'product_snapshots',items:'crawl_job_items' }; for (const [name,count] of Object.entries(expected)) { const actual=db.prepare(`SELECT COUNT(*) AS count FROM ${tables[name]}`).get().count; assert.equal(actual,count,name); } }
