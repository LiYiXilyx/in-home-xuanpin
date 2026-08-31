import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createCatalogCampaignService } from '../../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

const profilePath=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('operator create computes target from exact Active Pool and claims an UNBOUND manual context',async t => {
  const fixture=await fixtureWithActivePool(t,['9001','9002']);

  const result=fixture.service.createOperatorManualCampaign({
    profile:fixture.profile,requestedNewCount:10,campaignName:'operator-manual-10',requestId:'operator-request-1'
  });

  assert.equal(result.baselineCount,2);
  assert.equal(result.requestedNewCount,10);
  assert.equal(result.targetCount,12);
  assert.equal(result.captureMode,'MANUAL_BIND_PASSIVE_CAPTURE');
  assert.equal(result.currentUnique,2);
  assert.equal(result.remaining,10);
  assert.equal(result.bindingStatus,'UNBOUND');
  const stored=fixture.db.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(result.campaignId);
  assert.equal(stored.category_key,fixture.profile.category_key);
  assert.equal(stored.category_profile_version,fixture.profile.category_profile_version);
  assert.equal(stored.baseline_pool_count,2);
  assert.equal(stored.target_count,12);
  assert.equal(stored.status,'running');
  assert.equal(stored.browser_control_mode,'MANUAL_BIND_PASSIVE_CAPTURE');
  const frozen=JSON.parse(stored.config_json);
  assert.equal(frozen.categoryProfile.taxonomy_bindings.opportunity.taxonomy_version,'motorcycle-opportunity-v2');
  assert.deepEqual(frozen.operatorCreate,{requestId:'operator-request-1',requestedNewCount:10,captureMode:'MANUAL_BIND_PASSIVE_CAPTURE'});
  const context=fixture.service.currentOperatorManualContext();
  assert.equal(context.campaign.id,result.campaignId);
  assert.equal(context.queue.checkpoint.runner_state,'UNBOUND');
  assert.equal(context.queue.checkpoint.automatic_scroll,false);
  assert.equal(context.queue.checkpoint.automatic_navigation,false);
  assert.equal(context.queue.checkpoint.automatic_see_more,false);
  assert.equal(context.queue.checkpoint.automatic_captcha_handling,false);
});

test('same request is idempotent but changed fields or a different request cannot reuse Campaign',async t => {
  const fixture=await fixtureWithActivePool(t,['9001']);
  const input=request(fixture.profile);
  const first=fixture.service.createOperatorManualCampaign(input);
  const replay=fixture.service.createOperatorManualCampaign(input);
  assert.equal(replay.campaignId,first.campaignId);
  assert.equal(replay.idempotentReplay,true);
  assert.throws(()=>fixture.service.createOperatorManualCampaign({...input,requestedNewCount:2}),
    error=>error.code==='OPERATOR_CREATE_IDEMPOTENCY_CONFLICT');
  assert.throws(()=>fixture.service.createOperatorManualCampaign({...input,requestId:'different-request'}),
    error=>error.code==='CATALOG_RPA_CLAIM_CONFLICT');
});

test('active queue conflict causes zero writes and never resumes paused Full Refresh',async t => {
  const fixture=await fixtureWithActivePool(t,['9001']);
  fixture.service.createOperatorManualCampaign({...request(fixture.profile),campaignName:'active-manual',requestId:'active-request'});
  const protectedCampaign=fixture.service.createCampaign({name:'protected-1208-of-2000',campaignType:'refresh',profile:fixture.profile,targetCount:2000});
  fixture.service.createSource(protectedCampaign.id,{sourceKey:'protected-source',sourceType:'category',sortOrder:'Top Sales',targetQuota:2000});
  fixture.service.transitionCampaign(protectedCampaign.id,'running');
  fixture.service.transitionCampaign(protectedCampaign.id,'paused');
  const protectedBefore=fixture.db.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(protectedCampaign.id);
  const before=databaseFingerprint(fixture.db);
  assert.throws(()=>fixture.service.createOperatorManualCampaign({...request(fixture.profile),campaignName:'blocked',requestId:'blocked-request'}),
    error=>error.code==='CATALOG_RPA_CLAIM_CONFLICT');
  assert.deepEqual(databaseFingerprint(fixture.db),before);
  assert.deepEqual(fixture.db.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(protectedCampaign.id),protectedBefore);
});

test('missing Active Pool hard fails with zero writes',async t => {
  const fixture=await fixtureWithoutActivePool(t);
  const before=databaseFingerprint(fixture.db);
  assert.throws(()=>fixture.service.createOperatorManualCampaign(request(fixture.profile)),
    error=>error.code==='INITIAL_ACTIVE_POOL_REQUIRED');
  assert.deepEqual(databaseFingerprint(fixture.db),before);
});

test('later source failure rolls back Campaign baseline source queue and claim',async t => {
  const fixture=await fixtureWithActivePool(t,['9001']);
  fixture.db.exec(`CREATE TRIGGER fixture_fail_manual_source BEFORE INSERT ON catalog_sources
    WHEN NEW.source_key='manual-bind-passive'
    BEGIN SELECT RAISE(ABORT,'fixture source failure'); END`);
  const before=databaseFingerprint(fixture.db);
  assert.throws(()=>fixture.service.createOperatorManualCampaign(request(fixture.profile)),/fixture source failure/);
  assert.deepEqual(databaseFingerprint(fixture.db),before);
});

test('operator profile description is scoped and empty current context is null',async t => {
  const fixture=await fixtureWithActivePool(t,['9001','9002']);
  const description=fixture.service.describeOperatorProfile(fixture.profile);
  assert.equal(description.category_key,fixture.profile.category_key);
  assert.equal(description.category_profile_version,fixture.profile.category_profile_version);
  assert.equal(description.active_pool_count,2);
  assert.equal(description.capture_mode,'MANUAL_BIND_PASSIVE_CAPTURE');
  assert.equal(description.available,true);
  assert.equal(fixture.service.currentOperatorManualContext(),null);
});

test('inconsistent Active Pool, excessive target, and duplicate name hard fail without partial writes',async t => {
  const inconsistent=await fixtureWithActivePool(t,['9001']);
  inconsistent.db.prepare("UPDATE catalog_pool_versions SET product_count=2 WHERE category_key=? AND status='active'")
    .run(inconsistent.profile.category_key);
  let before=databaseFingerprint(inconsistent.db);
  assert.throws(()=>inconsistent.service.createOperatorManualCampaign(request(inconsistent.profile)),
    error=>error.code==='CATALOG_BASELINE_INCONSISTENT');
  assert.deepEqual(databaseFingerprint(inconsistent.db),before);

  const target=await fixtureWithActivePool(t,['9101']);
  before=databaseFingerprint(target.db);
  assert.throws(()=>target.service.createOperatorManualCampaign({...request(target.profile),requestedNewCount:target.profile.target_count}),
    error=>error.code==='CATALOG_TARGET_INVALID');
  assert.deepEqual(databaseFingerprint(target.db),before);

  const duplicate=await fixtureWithActivePool(t,['9201']);
  const existing=duplicate.service.createCampaign({name:'duplicate-operator-name',campaignType:'refresh',profile:duplicate.profile,targetCount:1});
  assert.ok(existing.id);
  before=databaseFingerprint(duplicate.db);
  assert.throws(()=>duplicate.service.createOperatorManualCampaign({...request(duplicate.profile),campaignName:'duplicate-operator-name'}),
    error=>error.code==='CAMPAIGN_NAME_CONFLICT');
  assert.deepEqual(databaseFingerprint(duplicate.db),before);
});

async function fixtureWithActivePool(t,goodsIds) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-operator-create-'));
  const databasePath=path.join(directory,'fixture.db');migrateDatabase({databasePath});
  const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const service=createCatalogCampaignService(db,{now:sequenceClock()});
  const profile=await loadCategoryProfile(profilePath);
  activateRefreshPool(service,db,profile,goodsIds);
  return {directory,databasePath,db,service,profile};
}

async function fixtureWithoutActivePool(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-operator-create-empty-'));
  const databasePath=path.join(directory,'fixture.db');migrateDatabase({databasePath});
  const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,databasePath,db,service:createCatalogCampaignService(db,{now:sequenceClock()}),profile:await loadCategoryProfile(profilePath)};
}

function activateRefreshPool(service,db,profile,goodsIds) {
  const campaign=service.createCampaign({name:`baseline-${goodsIds.join('-')}`,campaignType:'refresh',profile,targetCount:goodsIds.length});
  const source=service.createSource(campaign.id,{sourceKey:'baseline-top-sales',sourceType:'category',sortOrder:profile.sort_order,targetQuota:goodsIds.length});
  service.transitionCampaign(campaign.id,'running');
  service.captureBatch({campaignId:campaign.id,sourceId:source.id,batchId:'baseline-batch',cards:goodsIds.map((goodsId,index)=>card(goodsId,index+1))});
  db.prepare("UPDATE catalog_rpa_queue SET status='completed' WHERE campaign_id=?").run(campaign.id);
  db.prepare("UPDATE catalog_sources SET status='completed' WHERE campaign_id=?").run(campaign.id);
  service.materializeRefresh(campaign.id);
  const qa=service.evaluateRefreshQa(campaign.id);assert.equal(qa.campaign.qaStatus,'passed');
  return service.activatePoolVersion(campaign.id);
}

function card(goodsId,rank) {
  return {goods_id:String(goodsId),title:`Mechanical Motorcycle Item ${goodsId}`,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,
    image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,
    listing_rank:rank,business_eligible:true,reviewable:true};
}

function sequenceClock(){let tick=0;return()=>new Date(Date.UTC(2026,7,31,12,0,tick++)).toISOString();}

function request(profile) {
  return {profile,requestedNewCount:1,campaignName:'operator-request',requestId:'operator-request-id'};
}

function databaseFingerprint(db) {
  const tables=['catalog_campaigns','catalog_campaign_baseline_items','catalog_baseline_consistency_audits','catalog_sources',
    'catalog_rpa_queue','catalog_source_runs'];
  return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
}
