import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateSourcingDatabase } from '../../src/modules/sourcing/sourcing-db.mjs';

const migrationsDir=fileURLToPath(new URL('../../db/sourcing-migrations',import.meta.url));
const through003='003_yingdao_export_random5_v1.sql';
const now='2026-08-31T00:00:00.000Z';

function tempDatabase(t,name='review.db') {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-review-v1-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return path.join(directory,name);
}

function insertRun(db,runId,{goodsIds=['601'],manifest=`manifest-${runId}`}={}) {
  db.prepare(`INSERT INTO sourcing_runs(
    run_id,git_commit_sha,machine_role,machine_name,started_at,status,input_count,
    processed_count,target_count,input_manifest_sha256,created_at,updated_at,method,
    import_status,source_manifest_sha256,sample_method
  ) VALUES(?,?,?,?,?,'COMPLETED',?,?,5,?,?,?,?,?,?,?)`).run(
    runId,'abc','1688_RUNNER','fixture',now,goodsIds.length,goodsIds.length,
    manifest,now,now,'YINGDAO_1688_ASSISTANT','COMPLETED',manifest,'SHA256_STABLE_ORDER_V1',
  );
  for(const goodsId of goodsIds) {
    db.prepare(`INSERT INTO sourcing_run_items(
      run_id,temu_goods_id,temu_title,temu_image_path,status,updated_at,
      source_export_file,source_file_sha256,source_candidate_count,sampled_count,temu_context_status
    ) VALUES(?,?,?,?, 'COMPLETED',?,?,?,?,5,'MISSING')`).run(
      runId,goodsId,'','',now,`${goodsId}.xlsx`,`sha-${goodsId}`,30,
    );
  }
}

function insertCandidate(db,{runId,goodsId,rank,productId,selected=null}) {
  db.prepare(`INSERT INTO supplier_match_candidates(
    run_id,temu_goods_id,candidate_rank,supplier_product_id,supplier_title,supplier_url,
    supplier_image_url,supplier_image_local_path,price_raw,captured_at,capture_status,
    original_rank,sample_seed,sample_method,image_download_status,image_downloaded_at,
    image_sha256,image_response_sha256,imported_at,selected_candidate
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    runId,goodsId,rank,productId,`title-${productId}`,
    `https://detail.1688.com/offer/${productId}.html`,`https://img.example/${productId}.jpg`,
    `${goodsId}/${productId}.jpg`,'9.90',now,'SEARCH_SUCCESS',rank,goodsId,
    'SHA256_STABLE_ORDER_V1','SUCCESS',now,`jpeg-${productId}`,`response-${productId}`,now,selected,
  );
}

function evidenceSnapshot(db) {
  const candidates=db.prepare(`SELECT
    run_id,temu_goods_id,candidate_rank,supplier_product_id,original_rank,
    supplier_image_url,supplier_image_local_path,image_download_status,
    image_downloaded_at,image_sha256,image_response_sha256,selected_candidate
    FROM supplier_match_candidates ORDER BY run_id,temu_goods_id,candidate_rank`).all();
  const evidence={
    runCount:Number(db.prepare('SELECT COUNT(*) n FROM sourcing_runs').get().n),
    goodsCount:Number(db.prepare('SELECT COUNT(*) n FROM sourcing_run_items').get().n),
    candidateCount:candidates.length,
    manifests:db.prepare('SELECT run_id,source_manifest_sha256 FROM sourcing_runs ORDER BY run_id').all(),
    candidates,
  };
  return {
    ...evidence,
    sha256:crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
  };
}

test('migration 003 lacks review schema and permits two selected candidates for one run goods',t=>{
  const databasePath=tempDatabase(t,'red.db');
  migrateSourcingDatabase({databasePath,migrationsDir,through:through003});
  const db=openDatabase(databasePath,{allowRunnerWrite:true});
  try {
    const columns=new Set(db.prepare("PRAGMA table_info('supplier_match_candidates')").all().map(row=>row.name));
    assert.equal(columns.has('review_excluded'),false);
    assert.equal(columns.has('operator_note'),false);
    assert.equal(columns.has('review_updated_at'),false);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sourcing_goods_reviews'").get(),undefined);

    insertRun(db,'legacy-red');
    insertCandidate(db,{runId:'legacy-red',goodsId:'601',rank:1,productId:'p1',selected:1});
    insertCandidate(db,{runId:'legacy-red',goodsId:'601',rank:2,productId:'p2',selected:1});
    assert.equal(db.prepare("SELECT COUNT(*) n FROM supplier_match_candidates WHERE run_id='legacy-red' AND temu_goods_id='601' AND selected_candidate=1").get().n,2);
  } finally { db.close(); }
});

test('004 additively preserves evidence and enforces one selected candidate per run goods',t=>{
  const databasePath=tempDatabase(t,'green.db');
  migrateSourcingDatabase({databasePath,migrationsDir,through:through003});
  let db=openDatabase(databasePath,{allowRunnerWrite:true});
  insertRun(db,'run-a',{goodsIds:['601','602']});
  insertRun(db,'run-b',{goodsIds:['601']});
  insertCandidate(db,{runId:'run-a',goodsId:'601',rank:1,productId:'a1'});
  insertCandidate(db,{runId:'run-a',goodsId:'601',rank:2,productId:'a2'});
  insertCandidate(db,{runId:'run-a',goodsId:'602',rank:1,productId:'a3'});
  insertCandidate(db,{runId:'run-b',goodsId:'601',rank:1,productId:'b1'});
  const before=evidenceSnapshot(db);
  db.close();

  const upgraded=migrateSourcingDatabase({databasePath,migrationsDir});
  const repeated=migrateSourcingDatabase({databasePath,migrationsDir});
  db=openDatabase(databasePath,{allowRunnerWrite:true});
  try {
    assert.deepEqual(upgraded.applied,['004_sourcing_review_console_v1.sql']);
    assert.deepEqual(repeated.applied,[]);
    const columns=new Map(db.prepare("PRAGMA table_info('supplier_match_candidates')").all().map(row=>[row.name,row]));
    assert.equal(columns.get('review_excluded').notnull,1);
    assert.equal(columns.get('review_excluded').dflt_value,'0');
    assert.ok(columns.has('operator_note'));
    assert.ok(columns.has('review_updated_at'));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sourcing_goods_reviews'").get());
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sourcing_goods_reviews').get().n,0);

    const after=evidenceSnapshot(db);
    assert.deepEqual(after,before);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM supplier_match_candidates WHERE selected_candidate=1').get().n,0);

    db.prepare("UPDATE supplier_match_candidates SET selected_candidate=1 WHERE run_id='run-a' AND temu_goods_id='601' AND supplier_product_id='a1'").run();
    assert.throws(
      ()=>db.prepare("UPDATE supplier_match_candidates SET selected_candidate=1 WHERE run_id='run-a' AND temu_goods_id='601' AND supplier_product_id='a2'").run(),
      /UNIQUE constraint failed/,
    );
    db.prepare("UPDATE supplier_match_candidates SET selected_candidate=1 WHERE run_id='run-a' AND temu_goods_id='602' AND supplier_product_id='a3'").run();
    db.prepare("UPDATE supplier_match_candidates SET selected_candidate=1 WHERE run_id='run-b' AND temu_goods_id='601' AND supplier_product_id='b1'").run();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM supplier_match_candidates WHERE selected_candidate=1').get().n,3);

    db.prepare("INSERT INTO sourcing_goods_reviews(run_id,temu_goods_id) VALUES('run-a','601')").run();
    const review=db.prepare("SELECT review_status,review_revision,review_updated_at FROM sourcing_goods_reviews WHERE run_id='run-a' AND temu_goods_id='601'").get();
    assert.deepEqual({...review},{review_status:'PENDING',review_revision:0,review_updated_at:null});
    assert.throws(()=>db.prepare("UPDATE sourcing_goods_reviews SET review_status='INVALID' WHERE run_id='run-a' AND temu_goods_id='601'").run(),/CHECK constraint failed/);
    assert.throws(()=>db.prepare("UPDATE sourcing_goods_reviews SET review_revision=-1 WHERE run_id='run-a' AND temu_goods_id='601'").run(),/CHECK constraint failed/);

    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('004 upgrades a copy of the current 50 goods 250 candidate database without evidence drift',t=>{
  const sourcePath=fileURLToPath(new URL('../../data/1688_sourcing.db',import.meta.url));
  assert.ok(fs.existsSync(sourcePath),'current V1 sourcing database is required for R1 characterization');
  const databasePath=tempDatabase(t,'current-v1-copy.db');
  fs.copyFileSync(sourcePath,databasePath);

  let db=openDatabase(databasePath,{readOnly:true});
  const before=evidenceSnapshot(db);
  assert.equal(before.runCount,1);
  assert.equal(before.goodsCount,50);
  assert.equal(before.candidateCount,250);
  db.close();

  migrateSourcingDatabase({databasePath,migrationsDir});
  db=openDatabase(databasePath,{readOnly:true});
  try {
    const after=evidenceSnapshot(db);
    assert.deepEqual(after,before);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sourcing_goods_reviews').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM supplier_match_candidates WHERE selected_candidate=1').get().n,0);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});
