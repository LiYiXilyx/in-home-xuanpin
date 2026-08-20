import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildQualityReport } from '../../src/modules/catalog/capture-current-page.mjs';
import { normalizeProduct } from '../../src/modules/catalog/product-normalizer.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { createJobRepository } from '../../src/db/repositories/job-repository.mjs';
import { createJobService } from '../../src/jobs/job-service.mjs';

test('100 normalized catalog items satisfy identity contract and persist as Day 3 staging job items', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'temu-catalog-100-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'catalog.db');
  migrateDatabase({ databasePath });
  let db = openDatabase(databasePath);
  let repository = createJobRepository(db, { now: () => '2026-08-20T00:00:00.000Z' });
  const service = createJobService(repository);
  const job = service.create({ jobType: 'catalog', targetCount: 100, sortOrder: 'Top Sales' });
  service.start(job.id);
  const products = Array.from({ length: 100 }, (_, index) => normalizeProduct({
    href: `https://www.temu.com/item-g-${800000000000000 + index}.html?utm_source=fixture-${index}`,
    titleCandidates: [`Motorcycle Fixture ${index + 1}`], imageCandidates: [`https://img.test/${index + 1}.jpg`],
    cardText: `€${10 + index}.99 ${index + 1} sold 4.8 out of 5 stars ${index + 10} reviews`,
    visibleLabels: ['4.8 out of 5 stars']
  }, {
    listingRank: index + 1, siteCountry: '德国', language: 'en', currency: 'EUR', primaryCategory: 'Automotive',
    subcategory: 'Motorcycles & Powersports Accessories', sortOrder: 'Top Sales', capturedAt: '2026-08-20T00:00:00.000Z'
  }));
  const quality = buildQualityReport(products, { totalOccurrences: 103, duplicateOccurrences: 3 });
  assert.equal(quality.product_count, 100);
  assert.equal(quality.unique_goods_id_count, 100);
  assert.equal(quality.completeness_percent.goods_id, 100);
  assert.equal(quality.completeness_percent.canonical_url, 100);
  for (const product of products) {
    repository.upsertJobItem(job.id, { sequenceNo: product.listing_rank, itemKey: product.goods_id,
      productUrl: product.canonical_url, checkpoint: { product } });
    repository.transitionJobItem(job.id, product.goods_id, 'running');
    repository.transitionJobItem(job.id, product.goods_id, 'completed', { checkpoint: { product } });
  }
  repository.updateCounts(job.id, { totalItems: 100, processedItems: 100, successItems: 100, failedItems: 0,
    discoveredCount: 100, storedCount: 100, errorCount: 0 });
  service.complete(job.id);
  db.close();

  db = openDatabase(databasePath);
  repository = createJobRepository(db);
  const restored = repository.getJob(job.id);
  const items = repository.listJobItems(job.id);
  assert.equal(restored.status, 'completed');
  assert.equal(restored.storedCount, 100);
  assert.equal(items.length, 100);
  assert.deepEqual(items.map(item => item.sequenceNo), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(new Set(items.map(item => item.itemKey)).size, 100);
  assert.ok(items.every(item => item.productUrl === `https://www.temu.com/goods.html?goods_id=${item.itemKey}`));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 0, 'Day 4 formal product persistence must not start early');
  db.close();
});
