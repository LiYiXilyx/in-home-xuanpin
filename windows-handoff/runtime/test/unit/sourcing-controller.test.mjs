import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourcingController,SOURCING_STATES } from '../../src/server/controllers/sourcing-controller.mjs';

function setup({workbookValid=true}={}) {
  let settings={sourceDir:'/raw',imageCacheDir:'/cache',selectedWorkbookPath:'/analysis.xlsx'};
  const candidate={run_id:'run-1',temu_goods_id:'601',supplier_product_id:'p1',candidate_rank:1,original_rank:7,image_download_status:'FAILED'};
  const run={run_id:'run-1',import_status:'COMPLETED_WITH_WARNINGS',source_dir:'/raw',image_cache_dir:'/cache',selected_workbook_path:'/analysis.xlsx',source_manifest_sha256:'manifest',candidate_count:1,failed_image_count:1,candidates:[candidate]};
  const repository={getImport:id=>id==='run-1'?run:null};
  const service={
    scan:async()=>({status:'SCAN_VALID',scanToken:'token',sourceExportFiles:1,uniqueTemuGoodsId:1,invalidFiles:[],duplicateGoodsId:[],totalSourceCandidates:6,sourceManifestSha256:'manifest',files:[{filename:'601.xlsx',temu_goods_id:'601'}],candidates:Array.from({length:6},(_,i)=>({temu_goods_id:'601','1688_product_id':`p${i}`}))}),
    startImport:async({runId})=>({run_id:runId,status:'COMPLETED',import_status:'COMPLETED'}),
    retryFailedImages:async()=>({run_id:'run-1',import_status:'COMPLETED'}),
  };
  const controller=createSourcingController({service,repository,settingsStore:{load:async()=>settings,save:async value=>(settings=value)},pathDialog:async({currentPath})=>({cancelled:true,path:currentPath}),validatePaths:async value=>value,validateWorkbook:async()=>{if(!workbookValid)throw Object.assign(new Error('missing'),{code:'WORKBOOK_SHEET05_REQUIRED'});},runIdFactory:()=> 'generated-run'});
  return {controller,run};
}

test('state set is complete and import is enabled only by current SCAN_VALID token',async()=>{
  assert.equal(SOURCING_STATES.length,11);
  const {controller}=setup();
  assert.equal((await controller.settings()).state,'READY_TO_SCAN');
  await assert.rejects(()=>controller.startImport({scanToken:'token'}),error=>error.code==='SCAN_STALE');
  const scanned=await controller.scan();
  assert.equal(scanned.state,'SCAN_VALID');assert.equal(scanned.random5_candidates,5);
  await assert.rejects(()=>controller.startImport({scanToken:'old'}),error=>error.code==='SCAN_STALE');
  const imported=await controller.startImport({scanToken:'token'});
  assert.equal(imported.state,'COMPLETED');assert.equal(imported.current_run_id,'generated-run');
});

test('scan locks path mutations until its result is committed',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  let settings={sourceDir:'/raw',imageCacheDir:'/cache',selectedWorkbookPath:'/analysis.xlsx'};
  const controller=createSourcingController({repository:{getImport:()=>null},settingsStore:{load:async()=>settings,save:async value=>(settings=value)},pathDialog:async()=>({cancelled:true}),validatePaths:async value=>value,validateWorkbook:async()=>{},service:{scan:async()=>{await gate;return {status:'SCAN_VALID',scanToken:'token',sourceExportFiles:0,uniqueTemuGoodsId:0,invalidFiles:[],duplicateGoodsId:[],totalSourceCandidates:0,sourceManifestSha256:'x',files:[],candidates:[]};},startImport:async()=>{},retryFailedImages:async()=>{}}});
  const scanning=controller.scan();
  await assert.rejects(()=>controller.saveSettings({sourceDir:'/new-raw'}),error=>error.code==='IMPORT_IN_PROGRESS');
  release();assert.equal((await scanning).state,'SCAN_VALID');
});

test('an in-flight settings save locks scan before its first await',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});let settings={sourceDir:'/old',imageCacheDir:'/cache',selectedWorkbookPath:'/analysis.xlsx'};
  const controller=createSourcingController({repository:{getImport:()=>null},settingsStore:{load:async()=>settings,save:async value=>{await gate;return settings=value;}},pathDialog:async()=>({cancelled:true}),validatePaths:async value=>value,validateWorkbook:async()=>{},service:{scan:async()=>({status:'SCAN_VALID',scanToken:'token',sourceExportFiles:0,uniqueTemuGoodsId:0,invalidFiles:[],duplicateGoodsId:[],totalSourceCandidates:0,sourceManifestSha256:'x',files:[],candidates:[]}),startImport:async()=>{},retryFailedImages:async()=>{}}});
  const saving=controller.saveSettings({sourceDir:'/new'});
  await assert.rejects(()=>controller.scan(),error=>error.code==='IMPORT_IN_PROGRESS');
  release();await saving;assert.equal((await controller.settings()).settings.sourceDir,'/new');
});

test('first settings load is single-flight and cannot overwrite a concurrent save',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});let settings={sourceDir:'/old',imageCacheDir:'/cache',selectedWorkbookPath:'/analysis.xlsx'};
  const controller=createSourcingController({repository:{getImport:()=>null},settingsStore:{load:async()=>{await gate;return settings;},save:async value=>(settings=value)},pathDialog:async()=>({cancelled:true}),validatePaths:async value=>value,validateWorkbook:async()=>{},service:{scan:async()=>{},startImport:async()=>{},retryFailedImages:async()=>{}}});
  const reading=controller.settings();const saving=controller.saveSettings({sourceDir:'/new'});release();await Promise.all([reading,saving]);
  assert.equal((await controller.settings()).settings.sourceDir,'/new');
});

test('incomplete settings remain UNCONFIGURED and first complete configuration is READY_TO_SCAN',async()=>{
  let settings={sourceDir:null,imageCacheDir:null,selectedWorkbookPath:null};
  const controller=createSourcingController({repository:{getImport:()=>null},settingsStore:{load:async()=>settings,save:async value=>(settings=value)},pathDialog:async()=>({cancelled:true}),validatePaths:async value=>value,validateWorkbook:async()=>{},service:{scan:async()=>{},startImport:async()=>{},retryFailedImages:async()=>{}}});
  assert.equal((await controller.saveSettings({sourceDir:'/raw'})).state,'UNCONFIGURED');
  assert.equal((await controller.saveSettings({imageCacheDir:'/cache'})).state,'UNCONFIGURED');
  assert.equal((await controller.saveSettings({selectedWorkbookPath:'/analysis.xlsx'})).state,'READY_TO_SCAN');
});

test('duplicate run ID is a 409-compatible conflict and leaves the scan reusable',async()=>{
  let settings={sourceDir:'/raw',imageCacheDir:'/cache',selectedWorkbookPath:'/analysis.xlsx'};
  const controller=createSourcingController({repository:{getImport:()=>null},settingsStore:{load:async()=>settings,save:async value=>(settings=value)},pathDialog:async()=>({cancelled:true}),validatePaths:async value=>value,validateWorkbook:async()=>{},service:{scan:async()=>({status:'SCAN_VALID',scanToken:'token',sourceExportFiles:0,uniqueTemuGoodsId:0,invalidFiles:[],duplicateGoodsId:[],totalSourceCandidates:0,sourceManifestSha256:'x',files:[],candidates:[]}),startImport:async()=>{throw new Error('run_id 已存在，禁止覆盖或追加：same-run');},retryFailedImages:async()=>{}}});
  await controller.scan();
  await assert.rejects(()=>controller.startImport({scanToken:'token',runId:'same-run'}),error=>error.code==='RUN_ID_CONFLICT');
  const current=await controller.settings();assert.equal(current.state,'SCAN_VALID');assert.equal(current.current_run_id,null);
});

test('path change invalidates token and cancel preserves paths',async()=>{
  const {controller}=setup();await controller.scan();
  const cancelled=await controller.choosePath({kind:'RAW_DIRECTORY'});
  assert.equal(cancelled.cancelled,true);assert.equal(cancelled.state,'SCAN_VALID');
  const changed=await controller.saveSettings({sourceDir:'/raw two'});
  assert.equal(changed.state,'SCAN_STALE');assert.equal(changed.scan_token,null);
});

test('missing Sheet05 blocks scan and retry exposes stable identity fields',async()=>{
  const invalid=setup({workbookValid:false}).controller;
  await assert.rejects(()=>invalid.scan(),error=>error.code==='WORKBOOK_SHEET05_REQUIRED');
  assert.equal((await invalid.settings()).state,'SCAN_BLOCKED');
  const {controller}=setup();
  const before=await controller.getImport('run-1');
  const retry=await controller.retryFailedImages('run-1');
  assert.equal(retry.state,'COMPLETED');
  const after=await controller.getImport('run-1');
  assert.deepEqual(after.sampled_product_ids,before.sampled_product_ids);
  assert.equal(after.manifest,before.manifest);assert.equal(after.candidate_count,before.candidate_count);
});
