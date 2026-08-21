import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importV1Data } from '../../scripts/import-v1-data.mjs';
import { openDatabase } from '../../src/db/client.mjs';

test('v1 import uses goods_id, is idempotent, and never changes the source database', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'v1.db');
  const targetPath = path.join(directory, 'v2.db');
  const configPath = path.join(directory, 'config.json');
  const source = new DatabaseSync(sourcePath);
  source.exec(`CREATE TABLE products (
    id INTEGER PRIMARY KEY, product_url TEXT, site_country TEXT, currency TEXT,
    primary_category TEXT, subcategory TEXT, sort_order TEXT, title TEXT, image_url TEXT, price_eur REAL,
    sales_count INTEGER, rating REAL, total_review_count INTEGER, catalog_active INTEGER,
    listing_rank INTEGER, first_seen_at TEXT, last_seen_at TEXT, raw_json TEXT
  )`);
  source.prepare(`INSERT INTO products VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'https://www.temu.com/de-en/item-g-123456.html?refer=abc', '德国', 'EUR', 'Automotive',
    'Accessories', 'Top Sales', 'Item', 'https://img.example/item.jpg', 9.9, 50, 4.8, 10, 1, 1,
    '2026-08-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '{}'
  );
  source.prepare(`INSERT INTO products VALUES(2,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'https://www.temu.com/category', '德国', 'EUR', 'Automotive', 'Accessories', 'Top Sales',
    'No id', null, null, null, null, null, 1, 2, '2026-08-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '{}'
  );
  source.close();
  const config = JSON.parse(fs.readFileSync(new URL('../../config.example.json', import.meta.url), 'utf8'));
  config.app.databasePath = './v2.db';
  config.app.legacyDatabasePath = './v1.db';
  config.export.outputDir = './outputs';
  config.catalog.jobs[0].url = 'https://www.temu.com/category';
  fs.writeFileSync(configPath, JSON.stringify(config));
  const before = sha256(sourcePath);
  const first = await importV1Data({ configPath, databasePath: targetPath });
  const second = await importV1Data({ configPath, databasePath: targetPath });
  assert.equal(sha256(sourcePath), before);
  assert.equal(first.sourceRows, 2);
  assert.equal(first.productsImported, 1);
  assert.equal(first.productsUnmapped, 1);
  assert.deepEqual(first.unmappedReasons, { missing_goods_id: 1 });
  assert.deepEqual(first.unmappedRecords, [{ legacyProductId: 2, sourceUrl: 'https://www.temu.com/category', reason: 'missing_goods_id' }]);
  assert.equal(first.missingFieldCounts.image_url, 1);
  assert.equal(first.imagesImported, 1);
  assert.equal(second.membershipsImported, 0);
  assert.equal(second.snapshotsImported, 0);
  const target = openDatabase(targetPath, { readOnly: true });
  try {
    assert.equal(target.prepare('SELECT COUNT(*) AS count FROM products').get().count, 1);
    assert.equal(target.prepare('SELECT external_product_id AS goodsId FROM products').get().goodsId, '123456');
    assert.equal(target.prepare('SELECT COUNT(*) AS count FROM catalog_memberships').get().count, 1);
    assert.equal(target.prepare('SELECT COUNT(*) AS count FROM product_snapshots').get().count, 1);
    assert.equal(target.prepare('SELECT COUNT(*) AS count FROM product_images').get().count, 1);
  } finally {
    target.close();
  }
});

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
