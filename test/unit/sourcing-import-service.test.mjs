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
      imports.set(model.run.runId,{ model,import_status:'RUNNING' });
      return { runId:model.run.runId,inputCount:model.items.length,candidateCount:model.candidates.length };
    },
    markImportResult(runId,result) {
      const record=imports.get(runId);
      record.import_status=result.status;
      return record;
    },
    getImport(runId) { return imports.get(runId)??null; },
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
