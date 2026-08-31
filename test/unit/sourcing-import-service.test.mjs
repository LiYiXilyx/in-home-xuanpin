import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createYingdaoImportService } from '../../src/modules/sourcing/yingdao-import-service.mjs';

const HEADERS=[
  '标题','产品ID','产品链接','图片链接','价格','是否包邮','销售额','起批量','起批量运费',
  '月销件数','累计销售件数','复购率','48h发货率','最早上架时间','最新更新时间','店铺名称','店铺资质',
];

function workbookRows(count=6) {
  return Array.from({ length:count },(_,index)=>[
    `title-${index+1}`,`p${index+1}`,`https://detail.1688.com/offer/p${index+1}.html`,
    `https://cbu01.alicdn.com/p${index+1}.jpg`,'3.50','不包邮','200+','1','-',
    '93','370','12.5%','99%','2025-12-12 19:42:54','2026-08-17 00:06:08','Shop','实力商家',
  ]);
}

async function setupSource(t) {
  const sourceDir=await fs.mkdtemp(path.join(os.tmpdir(),'yingdao-import-service-'));
  t.after(()=>fs.rm(sourceDir,{ recursive:true,force:true }));
  await fs.writeFile(path.join(sourceDir,'601.xlsx'),'raw-v1');
  return sourceDir;
}

function config(sourceDir) {
  return {
    sourceDir,
    imageCacheDir:path.join(sourceDir,'cache-output'),
    selectedWorkbookPath:path.join(sourceDir,'opportunity-analysis-with-1688.xlsx'),
  };
}

function memoryRepository() {
  const imports=new Map();
  return {
    writes:0,
    insertStructuredImport(model) {
      this.writes+=1;
      const candidates=model.candidates.map(candidate=>({
        run_id:model.run.runId,temu_goods_id:candidate.temu_goods_id,
        candidate_rank:candidate.random_sample_rank,original_rank:candidate.original_rank,
        supplier_product_id:candidate['1688_product_id'],supplier_image_url:candidate['1688_image_url'],
        supplier_image_local_path:null,image_download_status:'PENDING',image_downloaded_at:null,
        image_sha256:null,image_response_sha256:null,sample_method:candidate.sample_method,
      }));
      imports.set(model.run.runId,{
        model,run_id:model.run.runId,import_status:'RUNNING',
        source_manifest_sha256:model.run.sourceManifestSha256,image_cache_dir:model.run.imageCacheDir,
        candidate_count:candidates.length,failed_image_count:0,candidates,
      });
      return { runId:model.run.runId,inputCount:model.items.length,candidateCount:model.candidates.length };
    },
    markImportResult(runId,result) {
      const record=imports.get(runId);
      record.import_status=result.status;
      record.failed_image_count=record.candidates.filter(candidate=>candidate.image_download_status==='FAILED').length;
      return record;
    },
    failedImages(runId) {
      return imports.get(runId).candidates.filter(candidate=>candidate.image_download_status==='FAILED');
    },
    updateImageResult(runId,key,result) {
      const candidate=imports.get(runId).candidates.find(item=>item.temu_goods_id===String(key.temuGoodsId) && item.supplier_product_id===String(key.productId));
      candidate.supplier_image_local_path=result.localPath;
      candidate.image_download_status=result.status;
      candidate.image_downloaded_at=result.downloadedAt;
      candidate.image_sha256=result.imageSha256;
      candidate.image_response_sha256=result.responseSha256;
    },
    getImport(runId) { return imports.get(runId)??null; },
  };
}

function cachedResult(candidate,status) {
  const success=status==='SUCCESS';
  return {
    temu_goods_id:candidate.temu_goods_id,
    '1688_product_id':candidate['1688_product_id']??candidate.supplier_product_id,
    '1688_image_url':candidate['1688_image_url']??candidate.supplier_image_url,
    '1688_image_local_path':success?`${candidate.temu_goods_id}/${candidate['1688_product_id']??candidate.supplier_product_id}.jpg`:null,
    image_download_status:status,
    image_downloaded_at:success?'2026-08-31T01:00:00.000Z':null,
    image_sha256:success?'image-sha':null,
    image_response_sha256:success?'response-sha':null,
  };
}

test('startImport refuses a stale scan token before repository write', async t => {
  const sourceDir=await setupSource(t);
  const repository=memoryRepository();
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>({ headers:HEADERS,rows:workbookRows(1) }),
    now:()=> '2026-08-31T00:00:00.000Z',
  });
  const preview=await service.scan(config(sourceDir));
  await fs.appendFile(path.join(sourceDir,'601.xlsx'),'changed');

  await assert.rejects(
    ()=>service.startImport({ scanToken:preview.scanToken,runId:'run-stale' }),
    error=>error?.code==='SCAN_STALE',
  );
  assert.equal(repository.writes,0);
  assert.equal(repository.getImport('run-stale'),null);
});

test('structured Random5 commit occurs before image stage begins', async t => {
  const sourceDir=await setupSource(t);
  const repository=memoryRepository();
  const events=[];
  let committedModel=null;
  const originalInsert=repository.insertStructuredImport.bind(repository);
  repository.insertStructuredImport=model=>{
    const result=originalInsert(model);
    committedModel=model;
    events.push('db-commit');
    return result;
  };
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>({ headers:HEADERS,rows:workbookRows(6) }),
    imageStage:async({ runId,candidates })=>{
      assert.equal(runId,'run-ordered');
      assert.equal(repository.getImport(runId).import_status,'RUNNING');
      assert.equal(candidates.length,5);
      events.push('image-stage');
      return { status:'COMPLETED',qa:{ image_stage:'stubbed' } };
    },
    now:()=> '2026-08-31T00:00:00.000Z',
    gitCommitSha:'abc123',machineName:'test-machine',
  });
  const preview=await service.scan(config(sourceDir));

  const result=await service.startImport({
    scanToken:preview.scanToken,
    runId:'run-ordered',
    onStructured:()=>events.push('structured'),
    onImages:()=>events.push('images'),
  });

  assert.deepEqual(events,['db-commit','structured','images','image-stage']);
  assert.equal(committedModel.files.length,1);
  assert.equal(committedModel.items.length,1);
  assert.equal(committedModel.items[0].source_candidate_count,6);
  assert.equal(committedModel.candidates.length,5);
  assert.ok(committedModel.candidates.every(item=>item.sample_method==='SHA256_STABLE_ORDER_V1'));
  assert.ok(committedModel.candidates.every(item=>item.selected_candidate===null));
  assert.equal(result.run_id,'run-ordered');
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.selected_candidate,null);
});

test('a blocked scan cannot start', async t => {
  const sourceDir=await setupSource(t);
  const repository=memoryRepository();
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>({ headers:HEADERS.filter(name=>name!=='图片链接'),rows:workbookRows(1) }),
    now:()=> '2026-08-31T00:00:00.000Z',
  });
  const preview=await service.scan(config(sourceDir));
  assert.equal(preview.status,'SCAN_BLOCKED');

  await assert.rejects(
    ()=>service.startImport({ scanToken:preview.scanToken }),
    error=>error?.code==='SCAN_BLOCKED',
  );
  assert.equal(repository.writes,0);
});

test('a valid import generates a run ID when none is supplied', async t => {
  const sourceDir=await setupSource(t);
  const repository=memoryRepository();
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>({ headers:HEADERS,rows:workbookRows(1) }),
    imageStage:async()=>({ status:'COMPLETED' }),
    runIdFactory:()=> 'generated-run',now:()=> '2026-08-31T00:00:00.000Z',
  });
  const preview=await service.scan(config(sourceDir));

  const result=await service.startImport({ scanToken:preview.scanToken });

  assert.equal(result.run_id,'generated-run');
  assert.equal(repository.writes,1);
});

test('one failed image completes the structured run with warnings and keeps all five candidates', async t => {
  const sourceDir=await setupSource(t);
  const repository=memoryRepository();
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>({ headers:HEADERS,rows:workbookRows(6) }),
    cacheImages:async candidates=>{
      const results=candidates.map((candidate,index)=>cachedResult(candidate,index===4?'FAILED':'SUCCESS'));
      return { success:4,failed:1,results };
    },
    now:()=> '2026-08-31T00:00:00.000Z',
  });
  const preview=await service.scan(config(sourceDir));

  const result=await service.startImport({ scanToken:preview.scanToken,runId:'run-warning' });

  assert.equal(result.import_status,'COMPLETED_WITH_WARNINGS');
  assert.equal(result.image_download_success,4);
  assert.equal(result.image_download_failed,1);
  const imported=repository.getImport('run-warning');
  assert.equal(imported.candidate_count,5);
  assert.equal(imported.failed_image_count,1);
  assert.ok(imported.candidates.every(candidate=>candidate.supplier_image_url));
});

test('retryFailedImages touches only failed candidates and preserves Random5 identity and manifest', async t => {
  const sourceDir=await setupSource(t);
  const repository=memoryRepository();
  const batchSizes=[];
  let workbookAllowed=true;
  const service=createYingdaoImportService({
    repository,
    loadWorkbook:async()=>{
      if(!workbookAllowed) throw new Error('retry must not parse raw workbook');
      return { headers:HEADERS,rows:workbookRows(6) };
    },
    cacheImages:async candidates=>{
      batchSizes.push(candidates.length);
      const results=candidates.map((candidate,index)=>cachedResult(candidate,batchSizes.length===1 && index===4?'FAILED':'SUCCESS'));
      return {
        success:results.filter(result=>result.image_download_status==='SUCCESS').length,
        failed:results.filter(result=>result.image_download_status==='FAILED').length,
        results,
      };
    },
    now:()=> '2026-08-31T00:00:00.000Z',
  });
  const preview=await service.scan(config(sourceDir));
  await service.startImport({ scanToken:preview.scanToken,runId:'run-retry' });
  const before=structuredClone(repository.getImport('run-retry'));
  const identitiesBefore=before.candidates.map(candidate=>[
    candidate.temu_goods_id,candidate.candidate_rank,candidate.original_rank,
    candidate.supplier_product_id,candidate.sample_method,
  ]);
  workbookAllowed=false;
  await fs.rm(sourceDir,{ recursive:true,force:true });

  const result=await service.retryFailedImages('run-retry');
  const after=repository.getImport('run-retry');
  const identitiesAfter=after.candidates.map(candidate=>[
    candidate.temu_goods_id,candidate.candidate_rank,candidate.original_rank,
    candidate.supplier_product_id,candidate.sample_method,
  ]);

  assert.deepEqual(batchSizes,[5,1]);
  assert.equal(result.retried,1);
  assert.equal(result.succeeded,1);
  assert.equal(result.failed,0);
  assert.equal(result.import_status,'COMPLETED');
  assert.equal(after.candidate_count,before.candidate_count);
  assert.equal(after.source_manifest_sha256,before.source_manifest_sha256);
  assert.deepEqual(identitiesAfter,identitiesBefore);
});
