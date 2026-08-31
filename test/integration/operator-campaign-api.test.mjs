import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOperationsServer } from '../../src/server/index.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

const sourceProfile=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('operator API lists scoped profiles, creates server-calculated Campaign, and exposes exact current context',async t => {
  const fixture=await serverFixture(t);
  const {app,get,post,profile}=fixture;
  activateRefreshPool(app.catalogService,app.db,profile,['9001','9002']);

  let response=await get('/api/catalog/operator/profiles');let body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.profiles.length,1);
  assert.equal(body.profiles[0].active_pool_count,2);
  assert.equal(body.profiles[0].capture_mode,'MANUAL_BIND_PASSIVE_CAPTURE');

  response=await post('/api/catalog/operator-campaigns',{
    category_key:profile.category_key,category_profile_version:profile.category_profile_version,
    requested_new_count:10,campaign_name:'operator-api-10',request_id:'operator-api-request-1',
    target_count:999999,profile_path:'/private/should-never-be-opened.json'
  });
  body=await response.json();
  assert.equal(response.status,201);
  assert.equal(body.result.target_count,12);
  assert.equal(body.result.campaign_id.startsWith('catalog_campaign_'),true);
  const campaignId=body.result.campaign_id;

  response=await get('/api/catalog/operator-campaign/current');body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.current.campaign_id,campaignId);
  assert.equal(body.current.campaign_name,'operator-api-10');
  assert.equal(body.current.category_key,profile.category_key);
  assert.equal(body.current.binding_status,'UNBOUND');

  response=await post('/api/catalog/operator-campaigns',{
    category_key:profile.category_key,category_profile_version:profile.category_profile_version,
    requested_new_count:10,campaign_name:'operator-api-10',request_id:'operator-api-request-1'
  });
  body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.result.campaign_id,campaignId);
  assert.equal(body.result.idempotent_replay,true);
});

test('operator API hard-fails wrong scope, invalid target, duplicate name, idempotency mismatch, and active claim with zero writes',async t => {
  const {app,post,profile}=await serverFixture(t);
  activateRefreshPool(app.catalogService,app.db,profile,['9101']);
  const base={category_key:profile.category_key,category_profile_version:profile.category_profile_version,
    requested_new_count:1,campaign_name:'operator-api-guard',request_id:'operator-api-guard-request'};

  await assertZeroWrite(app.db,post,{...base,category_key:'missing-category'},404,'CATEGORY_PROFILE_NOT_FOUND');
  await assertZeroWrite(app.db,post,{...base,category_profile_version:'wrong-version'},409,'CATEGORY_PROFILE_VERSION_MISMATCH');
  await assertZeroWrite(app.db,post,{...base,requested_new_count:profile.target_count},400,'CATALOG_TARGET_INVALID');

  app.catalogService.createCampaign({name:'duplicate-name',campaignType:'refresh',profile,targetCount:1});
  await assertZeroWrite(app.db,post,{...base,campaign_name:'duplicate-name'},409,'CAMPAIGN_NAME_CONFLICT');

  let response=await post('/api/catalog/operator-campaigns',base);let body=await response.json();
  assert.equal(response.status,201);assert.ok(body.result.campaign_id);
  await assertZeroWrite(app.db,post,{...base,requested_new_count:2},409,'OPERATOR_CREATE_IDEMPOTENCY_CONFLICT');
  await assertZeroWrite(app.db,post,{...base,campaign_name:'another',request_id:'another-request'},409,'CATALOG_RPA_CLAIM_CONFLICT');
});

test('operator API requires a positive Active Pool and reports no current task without guessing',async t => {
  const {app,get,post,profile}=await serverFixture(t);
  let response=await get('/api/catalog/operator-campaign/current');let body=await response.json();
  assert.equal(response.status,200);assert.equal(body.current,null);
  const before=databaseFingerprint(app.db);
  response=await post('/api/catalog/operator-campaigns',{category_key:profile.category_key,
    category_profile_version:profile.category_profile_version,requested_new_count:1,
    campaign_name:'no-pool',request_id:'no-pool-request'});
  body=await response.json();
  assert.equal(response.status,400);assert.equal(body.error.code,'INITIAL_ACTIVE_POOL_REQUIRED');
  assert.deepEqual(databaseFingerprint(app.db),before);
});

async function serverFixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-operator-api-'));
  const profileDirectory=path.join(directory,'categories');fs.mkdirSync(profileDirectory);
  fs.copyFileSync(sourceProfile,path.join(profileDirectory,'motorcycle-accessories.json'));
  const config={app:{environment:'development',databasePath:path.join(directory,'fixture.db')},
    browser:{mode:'external_cdp',profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000},
    catalog:{siteCountry:'德国',language:'en',currency:'EUR',jobs:[]},reviews:{},
    export:{outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images')}};
  const app=await createOperationsServer({config,categoryProfileDirectory:profileDirectory,runProcess:()=>{},openTarget:async()=>{},
    logError:()=>{},browserDependencies:{ready:async()=>true,openSession:async()=>({context:{}}),connectSession:async()=>({context:{}}),
      currentPage:async()=>({}),inspectPage:async()=>({status:'READY',code:'READY',checks:{}})}});
  t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const address=await app.listen({port:0});
  const get=route=>fetch(`${address.url}${route}`);
  const post=(route,payload)=>fetch(`${address.url}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return {app,get,post,profile:await loadCategoryProfile(sourceProfile)};
}

function activateRefreshPool(service,db,profile,goodsIds) {
  const campaign=service.createCampaign({name:`api-baseline-${goodsIds.join('-')}`,campaignType:'refresh',profile,targetCount:goodsIds.length});
  const source=service.createSource(campaign.id,{sourceKey:'baseline-top-sales',sourceType:'category',sortOrder:profile.sort_order,targetQuota:goodsIds.length});
  service.transitionCampaign(campaign.id,'running');
  service.captureBatch({campaignId:campaign.id,sourceId:source.id,batchId:'baseline-batch',cards:goodsIds.map((goodsId,index)=>card(goodsId,index+1))});
  db.prepare("UPDATE catalog_rpa_queue SET status='completed' WHERE campaign_id=?").run(campaign.id);
  db.prepare("UPDATE catalog_sources SET status='completed' WHERE campaign_id=?").run(campaign.id);
  service.materializeRefresh(campaign.id);
  assert.equal(service.evaluateRefreshQa(campaign.id).campaign.qaStatus,'passed');
  return service.activatePoolVersion(campaign.id);
}

function card(goodsId,rank) {
  return {goods_id:String(goodsId),title:`Mechanical Motorcycle Item ${goodsId}`,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,
    image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,
    listing_rank:rank,business_eligible:true,reviewable:true};
}

async function assertZeroWrite(db,post,payload,status,errorCode) {
  const before=databaseFingerprint(db);
  const response=await post('/api/catalog/operator-campaigns',payload);const body=await response.json();
  assert.equal(response.status,status);assert.equal(body.error.code,errorCode);
  assert.deepEqual(databaseFingerprint(db),before);
}

function databaseFingerprint(db) {
  const tables=['catalog_campaigns','catalog_campaign_baseline_items','catalog_baseline_consistency_audits','catalog_sources',
    'catalog_rpa_queue','catalog_source_runs'];
  return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
}
