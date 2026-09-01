import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { openDatabase } from '../../src/db/client.mjs';
import { createSourcingReviewRepository } from '../../src/db/repositories/sourcing-review-repository.mjs';
import { createTemuSourcingContextRepository,openTemuContextDatabase } from '../../src/db/repositories/temu-sourcing-context-repository.mjs';
import { migrateSourcingDatabase } from '../../src/modules/sourcing/sourcing-db.mjs';
import { createSourcingReviewService } from '../../src/modules/sourcing/sourcing-review-service.mjs';
import { createSourcingReviewImageResolver } from '../../src/modules/sourcing/sourcing-review-images.mjs';
import { createSourcingReviewController } from '../../src/server/controllers/sourcing-review-controller.mjs';
import { createRouter } from '../../src/server/router.mjs';

async function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'review-api-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const supplierRoot=path.join(root,'supplier-cache');
  const temuRoot=path.join(root,'outputs/week1-mvp/image-cache');
  fs.mkdirSync(path.join(supplierRoot,'601'),{recursive:true});
  fs.mkdirSync(temuRoot,{recursive:true});
  const jpeg=await sharp({create:{width:4,height:4,channels:3,background:'#336699'}}).jpeg().toBuffer();
  const avif=await sharp({create:{width:4,height:4,channels:3,background:'#663399'}}).avif().toBuffer();
  fs.writeFileSync(path.join(supplierRoot,'601','p1.jpg'),jpeg);
  fs.writeFileSync(path.join(supplierRoot,'601','p2.jpg'),jpeg);
  fs.writeFileSync(path.join(temuRoot,'601.avif'),avif);

  const sourcingPath=path.join(root,'sourcing.db');
  migrateSourcingDatabase({databasePath:sourcingPath});
  const sourcingDb=openDatabase(sourcingPath,{allowRunnerWrite:true});
  t.after(()=>sourcingDb.close());
  seedSourcing(sourcingDb,supplierRoot,sha256(jpeg));

  const temuPath=path.join(root,'temu.db');
  seedTemu(temuPath);
  const temuHashBefore=sha256(fs.readFileSync(temuPath));
  const temuDb=openTemuContextDatabase(temuPath);
  t.after(()=>temuDb.close());

  const repository=createSourcingReviewRepository(sourcingDb,{now:()=> '2026-08-31T09:00:00.000Z'});
  const temuRepository=createTemuSourcingContextRepository(temuDb,{projectRoot:root, imageCacheRoot:temuRoot});
  const service=createSourcingReviewService({sourcingRepository:repository,temuRepository,runId:'run-api',expectedGoods:1,expectedCandidates:2,
    visualContext:{query:async()=>({index:{status:'READY',index_fingerprint:'visual-f'},search:{match_count:1},matches:[{goods_id:'visual-1',display_image_url:'/api/sourcing/review/visual-index/display-images/visual-1?run_id=run-api&index_fingerprint=visual-f',display_image_kind:'TEMU_LOCAL_ORIGINAL',display_image_width:640,display_image_height:480,display_image_low_resolution:false,display_image_source:'TEMU_IMAGE_CACHE'}]}),displayImage:async()=>({kind:'LOCAL',display_image_kind:'TEMU_LOCAL_ORIGINAL',contentType:'image/jpeg',bytes:jpeg,width:640,height:480})},
    opportunityContext:{itemsByGoodsId:new Map([['601',{temu_goods_id:'601',temu_title:'10pcs Temu clips',temu_listed_price_eur:12,temu_currency:'EUR',temu_price_source:'RUN_SELECTED_WORKBOOK_SHEET05',temu_price_source_id:'fixture',similar_cluster:'夹子',level1:'L1',level2:'L2',level3:'L3'}]]),fx:{status:'AVAILABLE',eur_per_cny:.12,cny_per_eur:8.333333,source:'TEST',as_of:'2026-09-01'}},
  });
  const imageResolver=createSourcingReviewImageResolver({projectRoot:root,temuImageRoot:temuRoot});
  const sourcingReviewController=createSourcingReviewController({service,imageResolver});
  const router=createRouter({
    sourcingReviewController,statusService:{snapshot:async()=>({})},browserController:{},jobController:{},
    reviewController:{},reviewQueueController:{},catalogController:{},exportController:{},testController:{},
    serveStatic:()=>{},logError:()=>{},
  });
  const server=http.createServer(router);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {
    base:`http://127.0.0.1:${server.address().port}`,sourcingDb,temuPath,temuHashBefore,jpeg,avif,
  };
}

function seedSourcing(db,imageCacheDir,imageSha) {
  const now='2026-08-31T00:00:00.000Z';
  db.prepare(`INSERT INTO sourcing_runs(
    run_id,git_commit_sha,machine_role,machine_name,started_at,status,input_count,processed_count,target_count,
    input_manifest_sha256,created_at,updated_at,method,import_status,source_manifest_sha256,sample_method,image_cache_dir
  ) VALUES('run-api','abc','1688_RUNNER','fixture',?,'COMPLETED',1,1,5,'manifest',?,?,'YINGDAO_1688_ASSISTANT','COMPLETED','manifest','SHA256_STABLE_ORDER_V1',?)`).run(now,now,now,imageCacheDir);
  db.prepare(`INSERT INTO sourcing_run_items(
    run_id,temu_goods_id,temu_title,temu_image_path,status,updated_at,source_export_file,source_file_sha256,source_candidate_count,sampled_count,temu_context_status
  ) VALUES('run-api','601','','','COMPLETED',?,'601.xlsx','sha',30,2,'MISSING')`).run(now);
  const insert=db.prepare(`INSERT INTO supplier_match_candidates(
    run_id,temu_goods_id,candidate_rank,supplier_product_id,supplier_title,supplier_url,supplier_image_url,
    supplier_image_local_path,price_raw,captured_at,capture_status,original_rank,sample_seed,sample_method,
    image_download_status,image_sha256,imported_at,selected_candidate
  ) VALUES('run-api','601',?,?,?,?,?,?,?,?,?,?,?,?,'SUCCESS',?,?,NULL)`);
  insert.run(1,'p1','Supplier 1','https://detail.1688.com/offer/p1.html','https://img.example/p1.jpg','601/p1.jpg','9.90',now,'SEARCH_SUCCESS',11,'601','SHA256_STABLE_ORDER_V1',imageSha,now);
  insert.run(2,'p2','Supplier 2','https://1688.com.evil.test/offer/p2','https://img.example/p2.jpg','601/p2.jpg','12.90',now,'SEARCH_SUCCESS',22,'601','SHA256_STABLE_ORDER_V1',imageSha,now);
}

function seedTemu(databasePath) {
  const db=new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY,platform TEXT,external_product_id TEXT,title TEXT);
    CREATE TABLE product_images(id INTEGER PRIMARY KEY,product_id INTEGER,image_kind TEXT,source_url TEXT,local_path TEXT,status TEXT,download_status TEXT,sha256 TEXT,content_sha256 TEXT);
    CREATE TABLE product_classifications(id INTEGER PRIMARY KEY,product_id INTEGER,level1 TEXT,level2 TEXT,level3 TEXT,created_at TEXT);
    CREATE TABLE sourcing_run_items(run_id TEXT,temu_goods_id TEXT,similar_cluster TEXT);
    CREATE TABLE catalog_pool_versions(id TEXT,category_key TEXT,status TEXT,activated_at TEXT,product_count INTEGER);
    INSERT INTO products VALUES(1,'temu','601','Temu title 601');
    INSERT INTO product_images VALUES(1,1,'main','https://img.example/601','outputs/week1-mvp/image-cache/601.avif','downloaded','completed','sha','sha');
    INSERT INTO product_classifications VALUES(1,1,'L1','L2','L3','2026-08-31');
    INSERT INTO catalog_pool_versions VALUES('pool','motorcycle-accessories','active','2026-08-31',2135);
  `);
  db.close();
}

test('bootstrap goods detail images and database-derived 1688 link are served',async t=>{
  const c=await setup(t);
  const bootstrap=await api(c.base,'/api/sourcing/review/bootstrap?run_id=run-api');
  assert.equal(bootstrap.status,200);
  assert.equal(bootstrap.json.total_goods,1);
  assert.equal(bootstrap.json.awaiting_review,1);
  const discovered=await api(c.base,'/api/sourcing/review/bootstrap');
  assert.equal(discovered.status,200);assert.equal(discovered.json.run_id,'run-api');
  const detail=await api(c.base,'/api/sourcing/review/goods/601?run_id=run-api');
  assert.equal(detail.status,200);
  assert.deepEqual(detail.json.candidates.map(x=>x.random_sample_rank),[1,2]);
  assert.equal(detail.json.group_context.group_label,'夹子');
  assert.equal(detail.json.group_context.metrics.group_min_unit_price_eur,1.2);
  assert.equal(detail.json.fx_context.cny_per_eur,8.333333);
  assert.equal(detail.json.temu_context.temu_listed_price_eur,12);
  assert.equal(detail.json.candidates[0].supplier_unit_price_eur,1.188);
  assert.equal(detail.json.candidates[0].opportunity_band,'UNIT_REVIEW_REQUIRED');
  const temuImage=await api(c.base,'/api/sourcing/review/images/temu/601?run_id=run-api',{binary:true});
  assert.equal(temuImage.status,200);
  assert.deepEqual(temuImage.bytes,c.avif);
  const supplierImage=await api(c.base,'/api/sourcing/review/images/supplier/601/p1?run_id=run-api',{binary:true});
  assert.equal(supplierImage.status,200);
  assert.deepEqual(supplierImage.bytes,c.jpeg);
  const link=await api(c.base,'/api/sourcing/review/goods/601/candidates/p1/open-link?run_id=run-api');
  assert.deepEqual(link.json,{url:'https://detail.1688.com/offer/p1.html'});
  const blocked=await api(c.base,'/api/sourcing/review/goods/601/candidates/p2/open-link?run_id=run-api');
  assert.equal(blocked.status,400);
});

test('visual match metadata and dedicated display image endpoint stay run scoped',async t=>{
  const c=await setup(t);
  const matches=await api(c.base,'/api/sourcing/review/goods/601/visual-matches?run_id=run-api');
  assert.equal(matches.status,200);assert.equal(matches.json.matches[0].display_image_kind,'TEMU_LOCAL_ORIGINAL');
  assert.doesNotMatch(JSON.stringify(matches.json),/supplier-cache|temu\.db/);
  const image=await api(c.base,'/api/sourcing/review/visual-index/display-images/visual-1?run_id=run-api&index_fingerprint=visual-f',{binary:true});
  assert.equal(image.status,200);assert.deepEqual(image.bytes,c.jpeg);
  assert.equal((await api(c.base,'/api/sourcing/review/visual-index/display-images/visual-1?run_id=wrong&index_fingerprint=visual-f',{binary:true})).status,400);
});

test('select clear exclude restore and note routes preserve revisions',async t=>{
  const c=await setup(t);
  let result=await mutation(c.base,'/api/sourcing/review/goods/601/select',{run_id:'run-api',product_id:'p1',expected_revision:0});
  assert.equal(result.status,200);assert.equal(result.json.review_revision,1);assert.equal(result.json.review_status,'CONFIRMED');
  result=await mutation(c.base,'/api/sourcing/review/goods/601/clear-selection',{run_id:'run-api',expected_revision:1});
  assert.equal(result.json.review_revision,2);assert.equal(result.json.review_status,'PENDING');
  result=await mutation(c.base,'/api/sourcing/review/goods/601/candidates/p1/exclude',{run_id:'run-api',expected_revision:2});
  assert.equal(result.json.review_revision,3);
  result=await mutation(c.base,'/api/sourcing/review/goods/601/candidates/p1/restore',{run_id:'run-api',expected_revision:3});
  assert.equal(result.json.review_revision,4);assert.equal(result.json.review_status,'PENDING');
  result=await mutation(c.base,'/api/sourcing/review/goods/601/candidates/p1/note',{run_id:'run-api',expected_revision:4,operator_note:'人工备注'},{method:'PUT'});
  assert.equal(result.json.review_revision,5);
  assert.equal(result.json.candidates[0].operator_note,'人工备注');
});

test('Origin identity note and revision guards reject without Temu DB changes',async t=>{
  const c=await setup(t);
  assert.equal((await mutation(c.base,'/api/sourcing/review/goods/601/select',{run_id:'run-api',product_id:'p1',expected_revision:0},{origin:'https://evil.example'})).status,403);
  assert.equal((await mutation(c.base,'/api/sourcing/review/goods/601/select',{run_id:'other-run',product_id:'p1',expected_revision:0})).status,400);
  assert.equal((await mutation(c.base,'/api/sourcing/review/goods/602/select',{run_id:'run-api',product_id:'p1',expected_revision:0})).status,404);
  assert.equal((await mutation(c.base,'/api/sourcing/review/goods/601/candidates/p1/note',{run_id:'run-api',expected_revision:0,operator_note:'x'.repeat(2001)},{method:'PUT'})).status,400);
  const selected=await mutation(c.base,'/api/sourcing/review/goods/601/select',{run_id:'run-api',product_id:'p1',expected_revision:0});
  assert.equal(selected.status,200);
  const conflict=await mutation(c.base,'/api/sourcing/review/goods/601/candidates/p1/exclude',{run_id:'run-api',expected_revision:0});
  assert.equal(conflict.status,409);
  assert.equal(conflict.json.error.code,'REVIEW_CONFLICT');
  assert.equal(c.sourcingDb.prepare("SELECT COUNT(*) n FROM supplier_match_candidates WHERE selected_candidate=1").get().n,1);
  assert.equal(c.sourcingDb.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(c.sourcingDb.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(sha256(fs.readFileSync(c.temuPath)),c.temuHashBefore);
});

async function mutation(base,pathname,body,{method='POST',origin=base}={}) {
  return api(base,pathname,{method,body,origin});
}

async function api(base,pathname,{method='GET',body,origin,binary=false}={}) {
  const headers={};
  if(body!==undefined) headers['Content-Type']='application/json';
  if(method!=='GET') headers.Origin=origin??base;
  const response=await fetch(`${base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  if(binary) return {status:response.status,contentType:response.headers.get('content-type'),bytes:Buffer.from(await response.arrayBuffer())};
  return {status:response.status,json:await response.json()};
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
