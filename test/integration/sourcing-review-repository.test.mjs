import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { createSourcingReviewRepository } from '../../src/db/repositories/sourcing-review-repository.mjs';
import { migrateSourcingDatabase } from '../../src/modules/sourcing/sourcing-db.mjs';

const now='2026-08-31T08:00:00.000Z';

function setup(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-review-repo-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const databasePath=path.join(directory,'review.db');
  migrateSourcingDatabase({databasePath});
  const db=openDatabase(databasePath,{allowRunnerWrite:true});
  t.after(()=>db.close());
  seed(db);
  return {db,directory,repository:createSourcingReviewRepository(db,{now:()=>now})};
}

function seed(db) {
  insertRun(db,'run-a',['601','602']);
  insertRun(db,'run-b',['601']);
  insertCandidate(db,'run-a','601',2,'a2',20);
  insertCandidate(db,'run-a','601',1,'a1',10);
  insertCandidate(db,'run-a','601',3,'a3',30);
  insertCandidate(db,'run-a','602',1,'a4',40);
  insertCandidate(db,'run-b','601',1,'b1',50);
}

function insertRun(db,runId,goodsIds) {
  db.prepare(`INSERT INTO sourcing_runs(
    run_id,git_commit_sha,machine_role,machine_name,started_at,status,input_count,
    processed_count,target_count,input_manifest_sha256,created_at,updated_at,method,
    import_status,source_manifest_sha256,sample_method
  ) VALUES(?,?,?,?,?,'COMPLETED',?,?,5,?,?,?,?,?,?,?)`).run(
    runId,'abc','1688_RUNNER','fixture',now,goodsIds.length,goodsIds.length,
    `manifest-${runId}`,now,now,'YINGDAO_1688_ASSISTANT','COMPLETED',
    `manifest-${runId}`,'SHA256_STABLE_ORDER_V1',
  );
  for(const goodsId of goodsIds) db.prepare(`INSERT INTO sourcing_run_items(
    run_id,temu_goods_id,temu_title,temu_image_path,status,updated_at,
    source_export_file,source_file_sha256,source_candidate_count,sampled_count,temu_context_status
  ) VALUES(?,?,?,?, 'COMPLETED',?,?,?,?,?,'MISSING')`).run(
    runId,goodsId,'','',now,`${goodsId}.xlsx`,`sha-${goodsId}`,30,goodsId==='601'&&runId==='run-a'?3:1,
  );
}

function insertCandidate(db,runId,goodsId,rank,productId,originalRank) {
  db.prepare(`INSERT INTO supplier_match_candidates(
    run_id,temu_goods_id,candidate_rank,supplier_product_id,supplier_title,supplier_url,
    supplier_image_url,supplier_image_local_path,price_raw,captured_at,capture_status,
    original_rank,sample_seed,sample_method,image_download_status,imported_at,selected_candidate
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
    runId,goodsId,rank,productId,`title-${productId}`,
    `https://detail.1688.com/offer/${productId}.html`,`https://img.example/${productId}.jpg`,
    `${goodsId}/${productId}.jpg`,'9.90',now,'SEARCH_SUCCESS',originalRank,goodsId,
    'SHA256_STABLE_ORDER_V1','SUCCESS',now,
  );
}

test('lists goods and candidates in stable Random5 rank order',t=>{
  const {repository}=setup(t);
  const goods=repository.listReviewGoods('run-a');
  assert.deepEqual(goods.map(row=>row.temu_goods_id),['601','602']);
  assert.deepEqual(goods.map(row=>row.review_status),['PENDING','PENDING']);
  assert.deepEqual(goods.map(row=>row.review_revision),[0,0]);

  const detail=repository.getReviewGoods('run-a','601');
  assert.deepEqual(detail.candidates.map(row=>row.random_sample_rank),[1,2,3]);
  assert.deepEqual(detail.candidates.map(row=>row['1688_product_id']),['a1','a2','a3']);
  assert.deepEqual(detail.candidates.map(row=>row.original_rank),[10,20,30]);
});

test('select is transactional, clears the old choice and increments revision once',t=>{
  const {db,repository}=setup(t);
  let detail=repository.selectCandidate({runId:'run-a',temuGoodsId:'601',productId:'a1',expectedRevision:0});
  assert.equal(detail.review_status,'CONFIRMED');
  assert.equal(detail.review_revision,1);
  assert.deepEqual(detail.candidates.filter(row=>row.selected_candidate===1).map(row=>row['1688_product_id']),['a1']);

  detail=repository.selectCandidate({runId:'run-a',temuGoodsId:'601',productId:'a2',expectedRevision:1});
  assert.equal(detail.review_revision,2);
  assert.deepEqual(detail.candidates.filter(row=>row.selected_candidate===1).map(row=>row['1688_product_id']),['a2']);
  assert.equal(detail.candidates.find(row=>row['1688_product_id']==='a2').review_excluded,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM supplier_match_candidates WHERE run_id='run-a' AND temu_goods_id='601' AND selected_candidate=1").get().n,1);
});

test('clear, exclude and restore derive PENDING and NO_SELECTION without auto-selecting',t=>{
  const {repository}=setup(t);
  let detail=repository.selectCandidate({runId:'run-a',temuGoodsId:'601',productId:'a1',expectedRevision:0});
  detail=repository.clearSelection({runId:'run-a',temuGoodsId:'601',expectedRevision:1});
  assert.equal(detail.review_status,'PENDING');
  assert.equal(detail.review_revision,2);
  assert.equal(detail.candidates.filter(row=>row.selected_candidate===1).length,0);

  detail=repository.excludeCandidate({runId:'run-a',temuGoodsId:'601',productId:'a1',expectedRevision:2});
  detail=repository.excludeCandidate({runId:'run-a',temuGoodsId:'601',productId:'a2',expectedRevision:3});
  detail=repository.excludeCandidate({runId:'run-a',temuGoodsId:'601',productId:'a3',expectedRevision:4});
  assert.equal(detail.review_status,'NO_SELECTION');
  assert.equal(detail.review_revision,5);
  assert.equal(detail.candidates.every(row=>row.review_excluded===1),true);

  detail=repository.restoreCandidate({runId:'run-a',temuGoodsId:'601',productId:'a2',expectedRevision:5});
  assert.equal(detail.review_status,'PENDING');
  assert.equal(detail.review_revision,6);
  assert.equal(detail.candidates.filter(row=>row.selected_candidate===1).length,0);
  assert.equal(detail.candidates.find(row=>row['1688_product_id']==='a2').review_excluded,0);
});

test('notes enforce 2000 Unicode characters and stale revisions write nothing',t=>{
  const {db,repository}=setup(t);
  const accepted='测'.repeat(2000);
  let detail=repository.saveCandidateNote({
    runId:'run-a',temuGoodsId:'601',productId:'a1',operatorNote:accepted,expectedRevision:0,
  });
  assert.equal(detail.review_revision,1);
  assert.equal(detail.candidates.find(row=>row['1688_product_id']==='a1').operator_note,accepted);

  const beforeRows=db.prepare("SELECT * FROM supplier_match_candidates WHERE run_id='run-a' AND temu_goods_id='601' ORDER BY candidate_rank").all();
  const beforeReview=db.prepare("SELECT * FROM sourcing_goods_reviews WHERE run_id='run-a' AND temu_goods_id='601'").get();
  assert.throws(()=>repository.saveCandidateNote({
    runId:'run-a',temuGoodsId:'601',productId:'a1',operatorNote:'🙂'.repeat(2001),expectedRevision:1,
  }),error=>error.code==='OPERATOR_NOTE_TOO_LONG');
  assert.throws(()=>repository.excludeCandidate({
    runId:'run-a',temuGoodsId:'601',productId:'a1',expectedRevision:0,
  }),error=>error.code==='REVIEW_CONFLICT');
  assert.deepEqual(db.prepare("SELECT * FROM supplier_match_candidates WHERE run_id='run-a' AND temu_goods_id='601' ORDER BY candidate_rank").all(),beforeRows);
  assert.deepEqual(db.prepare("SELECT * FROM sourcing_goods_reviews WHERE run_id='run-a' AND temu_goods_id='601'").get(),beforeReview);
});

test('identity guards reject unknown, cross-run and cross-goods candidates with rollback',t=>{
  const {db,repository}=setup(t);
  const beforeCandidates=db.prepare('SELECT * FROM supplier_match_candidates ORDER BY run_id,temu_goods_id,candidate_rank').all();
  const beforeReviews=db.prepare('SELECT * FROM sourcing_goods_reviews').all();
  for(const input of [
    {runId:'missing',temuGoodsId:'601',productId:'a1',expectedRevision:0},
    {runId:'run-a',temuGoodsId:'missing',productId:'a1',expectedRevision:0},
    {runId:'run-a',temuGoodsId:'601',productId:'b1',expectedRevision:0},
    {runId:'run-a',temuGoodsId:'602',productId:'a1',expectedRevision:0},
  ]) assert.throws(()=>repository.selectCandidate(input),error=>/^REVIEW_/.test(error.code));
  assert.deepEqual(db.prepare('SELECT * FROM supplier_match_candidates ORDER BY run_id,temu_goods_id,candidate_rank').all(),beforeCandidates);
  assert.deepEqual(db.prepare('SELECT * FROM sourcing_goods_reviews').all(),beforeReviews);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('current V1 database copy reads exactly 50 goods and 250 rank-ordered candidates',t=>{
  const sourcePath=fileURLToPath(new URL('../../data/1688_sourcing.db',import.meta.url));
  assert.ok(fs.existsSync(sourcePath));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-review-current-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const databasePath=path.join(directory,'current-copy.db');
  fs.copyFileSync(sourcePath,databasePath);
  migrateSourcingDatabase({databasePath});
  const db=openDatabase(databasePath,{readOnly:true});
  try {
    const repository=createSourcingReviewRepository(db);
    const goods=repository.listReviewGoods('yingdao_random5_v1_20260831_001');
    assert.equal(goods.length,50);
    const details=goods.map(item=>repository.getReviewGoods('yingdao_random5_v1_20260831_001',item.temu_goods_id));
    assert.equal(details.reduce((sum,item)=>sum+item.candidates.length,0),250);
    assert.equal(details.every(item=>item.candidates.every((candidate,index)=>candidate.random_sample_rank===index+1)),true);
  } finally { db.close(); }
});
