import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateSourcingDatabase } from '../../src/modules/sourcing/sourcing-db.mjs';

const migrationsDir=fileURLToPath(new URL('../../db/sourcing-migrations',import.meta.url));

test('through applies only the requested sourcing migration prefix',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-through-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const databasePath=path.join(directory,'through.db');

  const result=migrateSourcingDatabase({databasePath,migrationsDir,through:'001_dual_machine_sourcing.sql'});

  assert.deepEqual(result.applied,['001_dual_machine_sourcing.sql']);
  const db=openDatabase(databasePath,{readOnly:true});
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('sourcing_runs') WHERE name='method'").get(),undefined);
  } finally { db.close(); }
});

test('003 upgrades populated legacy sourcing schema without losing history',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-v3-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const databasePath=path.join(directory,'legacy.db');
  migrateSourcingDatabase({databasePath,migrationsDir,through:'002_candidate_scoring_and_fx.sql'});
  const before=openDatabase(databasePath,{allowRunnerWrite:true});
  try {
    before.prepare(`INSERT INTO sourcing_runs(run_id,git_commit_sha,machine_role,machine_name,started_at,status,input_count,processed_count,target_count,input_manifest_sha256,created_at,updated_at,method)
      VALUES('legacy-run','abc','1688_RUNNER','legacy','2026-08-30T00:00:00.000Z','COMPLETED',1,1,1,'manifest','2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z','YINGDAO_1688_ASSISTANT')`).run();
    before.prepare(`INSERT INTO sourcing_run_items(run_id,temu_goods_id,temu_title,temu_image_path,status,updated_at)
      VALUES('legacy-run','601','Legacy title','/legacy/601.jpg','COMPLETED','2026-08-30T00:00:00.000Z')`).run();
    before.prepare(`INSERT INTO supplier_match_candidates(run_id,temu_goods_id,candidate_rank,supplier_product_id,supplier_title,supplier_url,supplier_image_url,price_raw,captured_at,capture_status)
      VALUES('legacy-run','601',1,'168801','Legacy supplier','https://detail.1688.com/offer/168801.html','https://cbu01.alicdn.com/legacy.jpg','9.90','2026-08-30T00:00:00.000Z','SEARCH_SUCCESS')`).run();
  } finally { before.close(); }

  const upgraded=migrateSourcingDatabase({databasePath,migrationsDir});
  const repeated=migrateSourcingDatabase({databasePath,migrationsDir});
  const after=openDatabase(databasePath,{allowRunnerWrite:true});
  try {
    assert.deepEqual(upgraded.applied,['003_yingdao_export_random5_v1.sql']);
    assert.deepEqual(repeated.applied,[]);
    assert.deepEqual({...after.prepare(`SELECT run_id,machine_name,status,method FROM sourcing_runs WHERE run_id='legacy-run'`).get()},{
      run_id:'legacy-run',machine_name:'legacy',status:'COMPLETED',method:'YINGDAO_1688_ASSISTANT',
    });
    assert.deepEqual({...after.prepare(`SELECT temu_goods_id,temu_title,temu_image_path,status FROM sourcing_run_items WHERE run_id='legacy-run'`).get()},{
      temu_goods_id:'601',temu_title:'Legacy title',temu_image_path:'/legacy/601.jpg',status:'COMPLETED',
    });
    assert.deepEqual({...after.prepare(`SELECT supplier_product_id,supplier_title,price_raw,capture_status FROM supplier_match_candidates WHERE run_id='legacy-run'`).get()},{
      supplier_product_id:'168801',supplier_title:'Legacy supplier',price_raw:'9.90',capture_status:'SEARCH_SUCCESS',
    });
    assert.ok(after.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sourcing_run_files'").get());
    const indexes=after.prepare("PRAGMA index_list('supplier_match_candidates')").all();
    assert.ok(indexes.some(index=>index.name==='uq_supplier_candidates_run_goods_product'&&index.unique===1));
    assert.throws(()=>after.prepare(`INSERT INTO supplier_match_candidates(
      run_id,temu_goods_id,candidate_rank,supplier_product_id,supplier_title,captured_at,capture_status
    ) VALUES('legacy-run','601',2,'168801','duplicate','2026-08-30T00:00:00.000Z','SEARCH_SUCCESS')`).run(),/UNIQUE constraint failed/);
    assert.equal(after.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(after.prepare('PRAGMA user_version').get().user_version,3);
  } finally { after.close(); }
});
