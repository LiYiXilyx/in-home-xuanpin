import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';

const projectMigrations = fileURLToPath(new URL('../../db/migrations', import.meta.url));

function temporaryDatabase(t, prefix = 'temu-initial-migration-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, databasePath: path.join(directory, 'catalog.db') };
}

function insertHistoricalCampaigns(db) {
  const insert = db.prepare(`INSERT INTO catalog_campaigns(
    id,name,campaign_type,category_key,category_profile_version,target_count,
    baseline_pool_count,status,config_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [index, type] of ['smoke', 'refresh', 'expansion', 'test'].entries()) {
    insert.run(`historical-${type}`, `Historical ${type}`, type, 'motorcycle-accessories',
      'motorcycle-accessories-v1', type === 'refresh' ? 2000 : 10,
      type === 'refresh' ? 2135 : 0, type === 'refresh' ? 'paused' : 'pending',
      JSON.stringify({ marker: type, progress: type === 'refresh' ? 1208 : 0 }),
      `2026-08-3${index}T00:00:00.000Z`, `2026-08-3${index}T00:00:00.000Z`);
  }
  db.prepare(`INSERT INTO catalog_sources(
    id,campaign_id,category_key,source_key,source_type,sort_order,status,created_at,updated_at
  ) VALUES('historical-source','historical-refresh','motorcycle-accessories','top-sales','category',
    'Top Sales','pending','2026-08-31T00:00:00.000Z','2026-08-31T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO catalog_rpa_queue(
    id,campaign_id,source_id,status,checkpoint_json,created_at,updated_at
  ) VALUES('historical-queue','historical-refresh','historical-source','manual_required',
    '{"progress":1208}','2026-08-31T00:00:00.000Z','2026-08-31T00:00:00.000Z')`).run();
}

function snapshotHistorical(db) {
  return {
    campaigns: db.prepare(`SELECT * FROM catalog_campaigns WHERE id LIKE 'historical-%' ORDER BY id`).all(),
    source: db.prepare(`SELECT * FROM catalog_sources WHERE id='historical-source'`).get(),
    queue: db.prepare(`SELECT * FROM catalog_rpa_queue WHERE id='historical-queue'`).get(),
    migrations: db.prepare(`SELECT filename,checksum FROM schema_migrations WHERE filename<'026_' ORDER BY filename`).all()
  };
}

test('026 adds Initial schema without changing historical Campaigns', t => {
  const { databasePath } = temporaryDatabase(t);
  migrateDatabase({ databasePath });
  const db = openDatabase(databasePath);
  try {
    insertHistoricalCampaigns(db);
    const before = snapshotHistorical(db);
    assert.doesNotThrow(() => db.prepare(`INSERT INTO catalog_campaigns(
      id,name,campaign_type,category_key,category_profile_version,target_count,status,config_json,created_at,updated_at
    ) VALUES('initial-1','Fixture Initial','initial','fixture-category-b','fixture-category-b-v1',2147483647,
      'running','{"quantityMode":"OPEN_ENDED"}','2026-08-31T01:00:00.000Z','2026-08-31T01:00:00.000Z')`).run());
    assert.deepEqual(snapshotHistorical(db), before);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const name of [
      'catalog_initial_pool_eligibility_audits', 'catalog_initial_pool_candidate_state',
      'catalog_initial_pool_candidate_items', 'catalog_initial_pool_batch_contexts',
      'catalog_initial_pool_qa_runs', 'catalog_initial_pool_qa_candidate_items',
      'catalog_initial_pool_activation_requests'
    ]) assert.ok(names.has(name), `${name} should exist`);
    assert.equal(db.prepare(`SELECT target_quota FROM catalog_sources LIMIT 1`).get().target_quota, null);
  } finally {
    db.close();
  }
});

test('026 failure rolls back Campaign rebuild and schema_migrations row', t => {
  const { directory, databasePath } = temporaryDatabase(t, 'temu-initial-rollback-');
  const migrationsDir = path.join(directory, 'migrations');
  fs.mkdirSync(migrationsDir);
  for (const filename of fs.readdirSync(projectMigrations).filter(name => name < '026_')) {
    fs.copyFileSync(path.join(projectMigrations, filename), path.join(migrationsDir, filename));
  }
  migrateDatabase({ databasePath, migrationsDir });
  const db = openDatabase(databasePath);
  insertHistoricalCampaigns(db);
  const before = snapshotHistorical(db);
  db.close();

  const migration026 = fs.readFileSync(path.join(projectMigrations, '026_initial_category_pool.sql'), 'utf8');
  fs.writeFileSync(path.join(migrationsDir, '026_initial_category_pool.sql'), `${migration026}\nTHIS IS INVALID;\n`);
  assert.throws(() => migrateDatabase({ databasePath, migrationsDir }), error => error.code === 'MIGRATION_FAILED');

  const checked = openDatabase(databasePath);
  try {
    assert.deepEqual(snapshotHistorical(checked), before);
    assert.equal(checked.prepare(`SELECT COUNT(*) AS count FROM schema_migrations WHERE filename='026_initial_category_pool.sql'`).get().count, 0);
    assert.equal(checked.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(checked.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    checked.close();
  }
});
