import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {backup} from 'node:sqlite';
import {openDatabase} from '../../src/db/client.mjs';
import {createSourcingReviewRepository} from '../../src/db/repositories/sourcing-review-repository.mjs';
import {scanYingdaoDirectory} from '../../src/modules/sourcing/yingdao-directory-scanner.mjs';
import {selectManualAuditGoods} from '../../src/modules/sourcing/sourcing-import-qa.mjs';
import {compareReviewConsoleSafety,verifyReviewConsoleSafety} from '../../scripts/1688/verify-sourcing-safety.mjs';

const RUN='yingdao_random5_v1_20260831_001';
const SOURCING=path.resolve('data/1688_sourcing.db');
const TEMU=path.resolve('data/temu_research_v2.db');
const RAW='/Users/chuangyangdianzi/Desktop/1688导出excel';
const realAvailable=fs.existsSync(SOURCING)&&fs.existsSync(TEMU);

test('real Review Console snapshot is read-only, complete and stable',{skip:!realAvailable},async()=>{
  const temuBefore=sha256(fs.readFileSync(TEMU));
  const before=await verifyReviewConsoleSafety({sourcingDatabasePath:SOURCING,temuDatabasePath:TEMU,runId:RUN,projectRoot:process.cwd()});
  const after=await verifyReviewConsoleSafety({sourcingDatabasePath:SOURCING,temuDatabasePath:TEMU,runId:RUN,projectRoot:process.cwd()});
  assert.equal(before.pass,true);
  assert.equal(before.goods,50); assert.equal(before.candidates,250);
  assert.equal(before.temu_context_matched,50); assert.equal(before.temu_context_missing,0);
  assert.equal(before.temu_images_ok,50); assert.equal(before.supplier_images_local,250);
  assert.equal(before.supplier_images_url_fallback,0); assert.equal(before.image_mapping_error,0);
  assert.equal(before.awaiting_review,50); assert.equal(before.confirmed,0); assert.equal(before.no_selection,0);
  assert.ok(before.selected_candidate_max_per_goods<=1);
  assert.equal(before.temu_db_read_only,true); assert.equal(before.active_pool,2135);
  assert.equal(before.sourcing_integrity,'ok'); assert.equal(before.sourcing_foreign_key_violations,0);
  assert.equal(compareReviewConsoleSafety(before,after).pass,true);
  assert.equal(sha256(fs.readFileSync(TEMU)),temuBefore);
});

test('all review mutations and conflict protection operate only on a sourcing copy',{skip:!realAvailable},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-acceptance-'));
  try {
    const copy=path.join(dir,'1688_sourcing.db'),source=openDatabase(SOURCING,{readOnly:true});
    try { await backup(source,copy); } finally { source.close(); }
    const db=openDatabase(copy,{allowRunnerWrite:true});
    try {
      const repo=createSourcingReviewRepository(db,{now:()=>new Date().toISOString()});
      const goods=repo.listReviewGoods(RUN)[0],goodsId=String(goods.temu_goods_id);
      let detail=repo.getReviewGoods(RUN,goodsId); const [first,second]=detail.candidates;
      detail=repo.selectCandidate({runId:RUN,temuGoodsId:goodsId,productId:first['1688_product_id'],expectedRevision:0});
      detail=repo.selectCandidate({runId:RUN,temuGoodsId:goodsId,productId:second['1688_product_id'],expectedRevision:1});
      assert.equal(detail.candidates.filter(row=>row.selected_candidate===1).length,1);
      detail=repo.clearSelection({runId:RUN,temuGoodsId:goodsId,expectedRevision:2});
      detail=repo.excludeCandidate({runId:RUN,temuGoodsId:goodsId,productId:first['1688_product_id'],expectedRevision:3});
      detail=repo.restoreCandidate({runId:RUN,temuGoodsId:goodsId,productId:first['1688_product_id'],expectedRevision:4});
      detail=repo.saveCandidateNote({runId:RUN,temuGoodsId:goodsId,productId:first['1688_product_id'],operatorNote:'R8 fixture',expectedRevision:5});
      assert.equal(detail.review_revision,6);
      assert.throws(()=>repo.selectCandidate({runId:RUN,temuGoodsId:goodsId,productId:first['1688_product_id'],expectedRevision:5}),error=>error.code==='REVIEW_CONFLICT');
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    } finally { db.close(); }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('stable 10-goods audit maps every displayed supplier field back to raw evidence',{skip:!realAvailable||!fs.existsSync(RAW)},async()=>{
  const scanned=await scanYingdaoDirectory({sourceDir:RAW});
  assert.equal(scanned.sourceExportFiles,50); assert.equal(scanned.totalSourceCandidates,1499);
  const db=openDatabase(SOURCING,{readOnly:true});
  try {
    const repository=createSourcingReviewRepository(db);
    const selected=selectManualAuditGoods(repository.listReviewGoods(RUN).map(row=>row.temu_goods_id));
    assert.equal(selected.length,10);
    for(const goodsId of selected) {
      const detail=repository.getReviewGoods(RUN,goodsId);
      assert.equal(detail.candidates.length,5);
      for(const row of detail.candidates) {
        const source=scanned.candidates.find(item=>String(item.temu_goods_id)===goodsId&&String(item['1688_product_id'])===String(row.supplier_product_id)&&Number(item.original_rank)===Number(row.original_rank));
        assert.ok(source,`${goodsId}/${row.supplier_product_id} missing from raw evidence`);
        assert.equal(row.supplier_title,source['1688_title']);
        assert.equal(row.price_rmb,source.price_rmb);
        assert.equal(row.moq,source.moq);
        assert.equal(row.monthly_sales,source.monthly_sales);
        assert.equal(row.cumulative_sales,source.cumulative_sales);
        assert.equal(row.shop_name,source.shop_name);
        assert.equal(row.shop_qualification,source.shop_qualification);
        assert.equal(row.supplier_url,source['1688_product_url']);
        assert.equal(row.supplier_image_url,source['1688_image_url']);
      }
    }
  } finally { db.close(); }
});

test('review safety comparison detects Random5 identity drift',()=>{
  const base={identity_sha256:'a',temu_logical_sha256:'b',active_pool:2135,goods:50,candidates:250};
  assert.equal(compareReviewConsoleSafety(base,{...base}).pass,true);
  assert.equal(compareReviewConsoleSafety(base,{...base,identity_sha256:'changed'}).checks.random5_identity,false);
});

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
