import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';

const projectMigrations = fileURLToPath(new URL('../../db/migrations', import.meta.url));

test('all migrations apply once and a repeated run has no side effects', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-migrations-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'v2.db');
  const first = migrateDatabase({ databasePath });
  const sizeAfterFirst = fs.statSync(databasePath).size;
  const second = migrateDatabase({ databasePath });
  assert.deepEqual(first.applied, ['001_core.sql', '002_catalog.sql', '003_quality_and_classification.sql', '004_job_control.sql', '005_catalog_persistence.sql', '006_image_cache_stability.sql', '007_source_url.sql', '008_rule_classification.sql']);
  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped.length, 8);
  assert.equal(fs.statSync(databasePath).size, sizeAfterFirst);

  const db = openDatabase(databasePath);
  try {
    const objects = db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','view')").all();
    const names = new Set(objects.map(item => item.name));
    for (const name of ['schema_migrations', 'crawl_jobs', 'crawl_events', 'crawl_job_items', 'products', 'catalog_memberships', 'product_snapshots', 'product_images', 'scrape_errors', 'data_quality_checks', 'product_classifications', 'v_current_products']) {
      assert.ok(names.has(name), `${name} should exist`);
    }
    assert.ok(db.prepare('PRAGMA table_info(products)').all().some(column => column.name === 'source_url'));
    const classificationColumns=new Set(db.prepare('PRAGMA table_info(product_classifications)').all().map(column => column.name));
    for (const name of ['level1','level2','level3','method','reasons_json']) assert.ok(classificationColumns.has(name));
    db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,first_seen_at,last_seen_at)
      VALUES('temu','same','https://www.temu.com/goods.html?goods_id=same','2026-01-01','2026-01-01')`).run();
    assert.throws(() => db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,first_seen_at,last_seen_at)
      VALUES('temu','same','https://www.temu.com/another-url','2026-01-01','2026-01-01')`).run(), /UNIQUE/);
    db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,first_seen_at,last_seen_at)
      VALUES('other','same','https://example.test/same','2026-01-01','2026-01-01')`).run();
  } finally {
    db.close();
  }
});

test('an applied migration cannot be edited silently', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-checksum-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const migrationsDir = path.join(directory, 'migrations');
  fs.mkdirSync(migrationsDir);
  for (const filename of fs.readdirSync(projectMigrations)) {
    fs.copyFileSync(path.join(projectMigrations, filename), path.join(migrationsDir, filename));
  }
  const databasePath = path.join(directory, 'v2.db');
  migrateDatabase({ databasePath, migrationsDir });
  fs.appendFileSync(path.join(migrationsDir, '001_core.sql'), '\n-- changed\n');
  assert.throws(() => migrateDatabase({ databasePath, migrationsDir }), error => error.code === 'MIGRATION_CHECKSUM_MISMATCH');
});

test('migration checksums tolerate Windows line endings and trailing blank lines only', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-checksum-eol-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const migrationsDir = path.join(directory, 'migrations');
  fs.mkdirSync(migrationsDir);
  fs.writeFileSync(path.join(migrationsDir, '001_sample.sql'), 'CREATE TABLE sample(id INTEGER);\n');
  const databasePath = path.join(directory, 'v2.db');
  migrateDatabase({ databasePath, migrationsDir });

  fs.writeFileSync(path.join(migrationsDir, '001_sample.sql'), 'CREATE TABLE sample(id INTEGER);\r\n\r\n');
  const repeated = migrateDatabase({ databasePath, migrationsDir });
  assert.deepEqual(repeated.applied, []);
  assert.deepEqual(repeated.skipped, ['001_sample.sql']);
});

test('a failed migration is rolled back completely', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-rollback-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const migrationsDir = path.join(directory, 'migrations');
  fs.mkdirSync(migrationsDir);
  fs.writeFileSync(path.join(migrationsDir, '001_bad.sql'), 'CREATE TABLE temporary_table(id INTEGER); THIS IS INVALID;');
  const databasePath = path.join(directory, 'v2.db');
  assert.throws(() => migrateDatabase({ databasePath, migrationsDir }), error => error.code === 'MIGRATION_FAILED');
  const db = openDatabase(databasePath, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='temporary_table'").get(), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 0);
  } finally {
    db.close();
  }
});
