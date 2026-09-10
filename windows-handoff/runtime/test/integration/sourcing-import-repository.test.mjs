import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openDatabase } from '../../src/db/client.mjs';
import { createSourcingRepository } from '../../src/db/repositories/sourcing-repository.mjs';
import { migrateSourcingDatabase } from '../../src/modules/sourcing/sourcing-db.mjs';
import { createYingdaoImportService } from '../../src/modules/sourcing/yingdao-import-service.mjs';
import { REQUIRED_YINGDAO_HEADERS } from '../../src/modules/sourcing/yingdao-export-parser.mjs';

function setup(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-import-repo-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const databasePath=path.join(directory,'1688_sourcing.db');
  migrateSourcingDatabase({ databasePath });
  const db=openDatabase(databasePath,{ allowRunnerWrite:true });
  t.after(()=>db.close());
  return { db,directory,repository:createSourcingRepository(db) };
}

function fixtureImport({ runId='run-1',duplicatePair=false }={}) {
  const importedAt='2026-08-31T00:00:00.000Z';
  const candidate={
    temu_goods_id:'601',random_sample_rank:1,original_rank:7,
    '1688_product_id':'168801','1688_title':'Supplier A',
    '1688_product_url':'https://detail.1688.com/offer/168801.html',
    '1688_image_url':'https://cbu01.alicdn.com/168801.jpg',
    '1688_image_local_path':null,price_raw:'3.50',price_rmb:3.5,
    shipping_text:'不包邮',sales_amount_raw:'200+',moq:1,moq_shipping_raw:null,
    monthly_sales:93,cumulative_sales:370,repurchase_rate:0.125,shipping_48h_rate:0.99,
    first_listed_at:'2025-12-12 19:42:54',updated_at:'2026-08-17 00:06:08',
    shop_name:'Shop',shop_qualification:'实力商家',sample_seed:'601',
    sample_method:'SHA256_STABLE_ORDER_V1',selected_candidate:null,
    source_export_file:'601.xlsx',imported_at:importedAt,
  };
  const candidates=[candidate];
  if(duplicatePair) candidates.push({
    ...candidate,random_sample_rank:2,original_rank:9,
    '1688_product_url':'https://detail.1688.com/offer/168801-duplicate.html',
  });
  return {
    run:{
      runId,gitCommitSha:'abc123',machineName:'test-machine',startedAt:importedAt,
      importedAt,sourceDir:'/selected/raw',sourceFileCount:1,
      sourceManifestSha256:'manifest-sha',imageCacheDir:'/selected/cache',
      selectedWorkbookPath:'/selected/opportunity-analysis-with-1688.xlsx',
      sampleMethod:'SHA256_STABLE_ORDER_V1',
    },
    files:[{
      temu_goods_id:'601',filename:'601.xlsx',source_export_file:'601.xlsx',
      file_sha256:'file-sha',row_count:8,parse_status:'PARSED',parse_error:null,
    }],
    items:[{
      temu_goods_id:'601',temu_title:null,temu_image_path:null,
      source_export_file:'601.xlsx',source_file_sha256:'file-sha',
      source_candidate_count:8,sampled_count:candidates.length,temu_context_status:'MISSING',
    }],
    candidates,
  };
}

function officialRows(count=6) {
  return Array.from({ length:count },(_,offset)=>{
    const index=offset+1;
    const values={
      '标题':`title-${index}`,'产品ID':`p${index}`,
      '产品链接':`https://detail.1688.com/offer/p${index}.html`,
      '图片链接':`https://cbu01.alicdn.com/p${index}.jpg`,'价格':'3.50',
      '是否包邮':'不包邮','销售额':'200+','起批量':'1','起批量运费':'-',
      '月销件数':'93','累计销售件数':'370','复购率':'12.5%','48h发货率':'99%',
      '最早上架时间':'2025-12-12 19:42:54','最新更新时间':'2026-08-17 00:06:08',
      '店铺名称':'Shop','店铺资质':'实力商家',
    };
    return REQUIRED_YINGDAO_HEADERS.map(header=>values[header]);
  });
}

function imageResult(candidate,status) {
  const productId=candidate['1688_product_id']??candidate.supplier_product_id;
  const imageUrl=candidate['1688_image_url']??candidate.supplier_image_url;
  const success=status==='SUCCESS';
  return {
    temu_goods_id:String(candidate.temu_goods_id),'1688_product_id':String(productId),'1688_image_url':imageUrl,
    '1688_image_local_path':success?`${candidate.temu_goods_id}/${productId}.jpg`:null,
    image_download_status:status,image_downloaded_at:success?'2026-08-31T01:00:00.000Z':null,
    image_sha256:success?'image-sha':null,image_response_sha256:success?'response-sha':null,
  };
}

test('insertStructuredImport writes explicit legacy-compatible and authoritative fields', t => {
  const { db,repository }=setup(t);
  const result=repository.insertStructuredImport(fixtureImport());

  assert.deepEqual(result,{ runId:'run-1',inputCount:1,candidateCount:1 });
  const run=db.prepare(`SELECT method,status,import_status,source_manifest_sha256,sample_method FROM sourcing_runs WHERE run_id='run-1'`).get();
  assert.deepEqual({ ...run },{
    method:'YINGDAO_1688_ASSISTANT',status:'RUNNING',import_status:'RUNNING',
    source_manifest_sha256:'manifest-sha',sample_method:'SHA256_STABLE_ORDER_V1',
  });
  const item=db.prepare(`SELECT temu_title,temu_image_path,temu_context_status,source_candidate_count,sampled_count FROM sourcing_run_items WHERE run_id='run-1'`).get();
  assert.deepEqual({ ...item },{
    temu_title:'',temu_image_path:'',temu_context_status:'MISSING',source_candidate_count:8,sampled_count:1,
  });
  const candidate=db.prepare(`SELECT candidate_rank,original_rank,supplier_product_id,captured_at,imported_at,
      supplier_image_local_path,selected_candidate,image_download_status
    FROM supplier_match_candidates WHERE run_id='run-1'`).get();
  assert.deepEqual({ ...candidate },{
    candidate_rank:1,original_rank:7,supplier_product_id:'168801',
    captured_at:'2026-08-31T00:00:00.000Z',imported_at:'2026-08-31T00:00:00.000Z',
    supplier_image_local_path:null,selected_candidate:null,image_download_status:'PENDING',
  });
});

test('duplicate run ID is rejected before transaction and counts remain unchanged', t => {
  const { db,repository }=setup(t);
  const model=fixtureImport({ runId:'run-duplicate' });
  repository.insertStructuredImport(model);

  assert.throws(()=>repository.insertStructuredImport(model),/run_id 已存在/);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sourcing_runs WHERE run_id='run-duplicate'`).get().n,1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sourcing_run_items WHERE run_id='run-duplicate'`).get().n,1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM supplier_match_candidates WHERE run_id='run-duplicate'`).get().n,1);
});

test('database run-local product pair constraint rolls back the complete import', t => {
  const { db,repository }=setup(t);
  const model=fixtureImport({ runId:'run-pair',duplicatePair:true });

  assert.throws(
    ()=>repository.insertStructuredImport(model),
    /UNIQUE constraint failed: supplier_match_candidates\.run_id, supplier_match_candidates\.temu_goods_id, supplier_match_candidates\.supplier_product_id/,
  );
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sourcing_runs WHERE run_id='run-pair'`).get().n,0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM sourcing_run_items WHERE run_id='run-pair'`).get().n,0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM supplier_match_candidates WHERE run_id='run-pair'`).get().n,0);
});

test('result and image methods update only the requested import candidate', t => {
  const { db,repository }=setup(t);
  repository.insertStructuredImport(fixtureImport({ runId:'run-images' }));
  repository.updateImageResult('run-images',{ temuGoodsId:'601',productId:'168801' },{
    status:'FAILED',localPath:null,downloadedAt:null,imageSha256:null,responseSha256:null,
  });
  assert.equal(repository.failedImages('run-images').length,1);
  repository.updateImageResult('run-images',{ temuGoodsId:'601',productId:'168801' },{
    status:'SUCCESS',localPath:'601/168801.jpg',downloadedAt:'2026-08-31T00:01:00.000Z',
    imageSha256:'image-sha',responseSha256:'response-sha',
  });
  assert.deepEqual(repository.failedImages('run-images'),[]);
  repository.markImportResult('run-images',{
    status:'COMPLETED',finishedAt:'2026-08-31T00:02:00.000Z',qa:{ images:1 },
  });

  const imported=repository.getImport('run-images');
  assert.equal(imported.import_status,'COMPLETED');
  assert.equal(imported.item_count,1);
  assert.equal(imported.candidate_count,1);
  assert.equal(imported.failed_image_count,0);
  assert.equal(imported.candidates[0].supplier_image_local_path,'601/168801.jpg');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('real SQLite structured transaction is queryable before the injected image stage', async t => {
  const { db,directory,repository }=setup(t);
  const sourceDir=path.join(directory,'raw');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir,'601.xlsx'),'read-only-fixture');
  const rows=officialRows();
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>({ headers:REQUIRED_YINGDAO_HEADERS,rows }),
    imageStage:async({ runId })=>{
      const committed=repository.getImport(runId);
      assert.equal(committed.import_status,'RUNNING');
      assert.equal(committed.item_count,1);
      assert.equal(committed.candidate_count,5);
      return { status:'COMPLETED',qa:{ image_stage:'stubbed' } };
    },
    workbookStage:async()=>({ sheetName:'test-workbook-stage' }),
    now:()=> '2026-08-31T00:00:00.000Z',gitCommitSha:'abc123',machineName:'test-machine',
  });
  const preview=await service.scan({
    sourceDir,imageCacheDir:path.join(directory,'cache'),
    selectedWorkbookPath:path.join(directory,'opportunity-analysis-with-1688.xlsx'),
  });

  const result=await service.startImport({ scanToken:preview.scanToken,runId:'run-end-to-end' });

  assert.equal(result.status,'COMPLETED');
  assert.equal(repository.getImport('run-end-to-end').import_status,'COMPLETED');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('real SQLite retry updates only FAILED rows and preserves structured identity', async t => {
  const { db,directory,repository }=setup(t);
  const sourceDir=path.join(directory,'retry-raw');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir,'601.xlsx'),'read-only-fixture');
  const batchSizes=[];
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>({ headers:REQUIRED_YINGDAO_HEADERS,rows:officialRows() }),
    cacheImages:async candidates=>{
      batchSizes.push(candidates.length);
      const results=candidates.map((candidate,index)=>imageResult(candidate,batchSizes.length===1 && index===4?'FAILED':'SUCCESS'));
      return {
        success:results.filter(result=>result.image_download_status==='SUCCESS').length,
        failed:results.filter(result=>result.image_download_status==='FAILED').length,
        results,
      };
    },
    workbookStage:async()=>({ sheetName:'test-workbook-stage' }),
    now:()=> '2026-08-31T00:00:00.000Z',gitCommitSha:'abc123',machineName:'test-machine',
  });
  const preview=await service.scan({
    sourceDir,imageCacheDir:path.join(directory,'cache'),
    selectedWorkbookPath:path.join(directory,'opportunity-analysis-with-1688.xlsx'),
  });
  const initial=await service.startImport({ scanToken:preview.scanToken,runId:'run-real-retry' });
  assert.equal(initial.import_status,'COMPLETED_WITH_WARNINGS');
  const before=repository.getImport('run-real-retry');
  const identities=before.candidates.map(candidate=>[
    candidate.temu_goods_id,candidate.candidate_rank,candidate.original_rank,
    candidate.supplier_product_id,candidate.sample_seed,candidate.sample_method,candidate.selected_candidate,
  ]);
  fs.rmSync(sourceDir,{ recursive:true,force:true });

  const retried=await service.retryFailedImages('run-real-retry');
  const after=repository.getImport('run-real-retry');

  assert.deepEqual(batchSizes,[5,1]);
  assert.equal(retried.import_status,'COMPLETED');
  assert.equal(after.candidate_count,5);
  assert.equal(after.source_manifest_sha256,before.source_manifest_sha256);
  assert.deepEqual(after.candidates.map(candidate=>[
    candidate.temu_goods_id,candidate.candidate_rank,candidate.original_rank,
    candidate.supplier_product_id,candidate.sample_seed,candidate.sample_method,candidate.selected_candidate,
  ]),identities);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
