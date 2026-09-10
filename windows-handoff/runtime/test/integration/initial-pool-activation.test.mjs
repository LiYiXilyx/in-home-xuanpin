import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction } from '../../src/db/client.mjs';
import { createInitialPoolRepository } from '../../src/db/repositories/initial-pool-repository.mjs';
import { buildInitialActivationPayload } from '../../src/modules/catalog-scale/initial-candidate-hash.mjs';
import { createInitialPoolFixture } from '../fixtures/initial-category-pool-fixture.mjs';

test('current PASS snapshot explicitly creates one category-scoped first Pool idempotently',async t=>{
  const f=await readyFixture(t,2);const before=protectedFingerprint(f.db);
  const input={campaignId:f.campaignId,categoryKey:f.profile.category_key,
    categoryProfileVersion:f.profile.category_profile_version,requestId:'activate-1'};
  const first=f.service.activateInitialPool(input),replay=f.service.activateInitialPool(input);
  assert.equal(first.poolVersionId,replay.poolVersionId);assert.equal(replay.idempotentReplay,true);
  assert.equal(first.productCount,2);assert.equal(first.status,'active');
  assert.deepEqual(protectedFingerprint(f.db),before);
  assert.equal(f.db.prepare(`SELECT COUNT(*) AS count FROM catalog_pool_versions WHERE category_key=? AND status='active'`)
    .get(f.profile.category_key).count,1);
  assert.equal(f.db.prepare(`SELECT COUNT(*) AS count FROM catalog_memberships WHERE category_key=? AND active=1`)
    .get(f.profile.category_key).count,2);
  assert.equal(f.service.getCampaign(f.campaignId).status,'completed');
});

test('STALE QA and Pool race hard fail with zero Pool writes',async t=>{
  const stale=await readyFixture(t,1);seed(stale,1,{start:2});let before=counts(stale.db);
  assert.throws(()=>stale.service.activateInitialPool({campaignId:stale.campaignId,categoryKey:stale.profile.category_key,
    categoryProfileVersion:stale.profile.category_profile_version,requestId:'stale'}),error=>error.code==='INITIAL_POOL_QA_STALE');
  assert.deepEqual(counts(stale.db),before);

  const race=await readyFixture(t,1);const other=race.service.createCampaign({name:'Race Pool Campaign',campaignType:'test',profile:race.profile,targetCount:1});
  race.db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,product_count,
    non_electronic_unique_count,status,created_at,updated_at) VALUES('race-pool',?,?,?,0,0,'active',?,?)`)
    .run(other.id,race.profile.category_key,race.profile.category_profile_version,race.now(),race.now());before=counts(race.db);
  assert.throws(()=>race.service.activateInitialPool({campaignId:race.campaignId,categoryKey:race.profile.category_key,
    categoryProfileVersion:race.profile.category_profile_version,requestId:'race'}),error=>error.code==='INITIAL_POOL_ALREADY_EXISTS');
  assert.deepEqual(counts(race.db),before);
});

test('activation mutex blocks concurrent capture with zero writes and rollback leaves Campaign recoverable',async t=>{
  let attempted=false,captureError=null,beforeCapture=null,afterCapture=null;
  const f=await readyFixture(t,1,{activationHooks:{afterFinalValidation:({service,campaign})=>{
    attempted=true;beforeCapture=counts(f.db);try{service.captureBatch({campaignId:campaign.id,sourceId:f.source.id,
      batchId:'concurrent',cards:[]});}catch(error){captureError=error;}afterCapture=counts(f.db);
  }}});
  const result=f.service.activateInitialPool({campaignId:f.campaignId,categoryKey:f.profile.category_key,
    categoryProfileVersion:f.profile.category_profile_version,requestId:'mutex'});
  assert.ok(result.poolVersionId);assert.equal(attempted,true);assert.equal(captureError?.code,'INITIAL_POOL_ACTIVATION_IN_PROGRESS');
  assert.deepEqual(afterCapture,beforeCapture);

  for(const hook of ['afterProduct','afterSnapshot','afterMembership','afterPool','afterPoolItem','afterActivationHistory',
    'afterSourceComplete','afterQueueComplete','beforeCampaignComplete']){
    const failed=await readyFixture(t,1,{activationHooks:{[hook]:()=>{throw new Error(`fixture ${hook} failure`);}}});
    const before=counts(failed.db);assert.throws(()=>failed.service.activateInitialPool({campaignId:failed.campaignId,
      categoryKey:failed.profile.category_key,categoryProfileVersion:failed.profile.category_profile_version,
      requestId:`rollback-${hook}`}),new RegExp(`fixture ${hook} failure`));assert.deepEqual(counts(failed.db),before);
    assert.equal(failed.service.getCampaign(failed.campaignId).status,'running');
  }
});

async function readyFixture(t,count,{activationHooks={}}={}) {
  const f=await createInitialPoolFixture(t);f.service=f.service;
  if(Object.keys(activationHooks).length){const {createCatalogCampaignService}=await import('../../src/modules/catalog-scale/catalog-campaign-service.mjs');
    f.service=createCatalogCampaignService(f.db,{now:f.now,activationHooks});}
  const created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:`Activation ${count}`,
    requestId:`activation-create-${count}`});f.campaignId=created.campaignId;f.source=f.service.currentOperatorManualContext().source;
  seed(f,count);f.service.runInitialPoolQa({campaignId:f.campaignId,categoryKey:f.profile.category_key,
    categoryProfileVersion:f.profile.category_profile_version,requestId:`activation-qa-${count}`});return f;
}
function seed(f,count,{start=1}={}) {
  const campaign=f.service.getCampaign(f.campaignId),repository=createInitialPoolRepository(f.db,{now:f.now}),items=[];
  for(let value=start;value<start+count;value+=1)items.push(buildInitialActivationPayload({campaign,source:f.source,batchId:'activation-batch',product:{
    platform:'temu',goodsId:String(value),title:`Fixture Item ${value}`,sourceUrl:`https://www.temu.com/de-en/item-${value}.html`,
    canonicalUrl:`https://www.temu.com/goods.html?goods_id=${value}`,imageUrl:`https://img.test/${value}.jpg`,priceAmount:12,currency:'EUR',
    salesCount:100,rating:4.8,reviewCount:20,electronicScreeningStatus:'passed',businessEligible:true,reviewable:true,qualityStatus:'pending',raw:{}}}));
  transaction(f.db,()=>{if(!f.db.prepare(`SELECT 1 FROM catalog_initial_pool_batch_contexts WHERE campaign_id=? AND batch_id='activation-batch'`).get(f.campaignId))
    repository.recordBatchContext({campaign,source:f.source,batchId:'activation-batch',captureMode:'MANUAL_BIND_PASSIVE_CAPTURE',
      pageUrl:'https://www.temu.com/de-en/fixture-category-b.html',pageContext:{siteCountry:'DE',language:'en',currency:'EUR',sortOrder:'Top Sales'},
      pageBinding:{binding_version:'manual-bind-v1',context_fingerprint:'activation-fingerprint'}});repository.applyCandidateItems(campaign,items);});
}
function counts(db){return Object.fromEntries(['products','product_snapshots','catalog_memberships','catalog_pool_versions',
  'catalog_pool_version_items','catalog_pool_activation_history','catalog_initial_pool_activation_requests','catalog_capture_batches']
  .map(table=>[table,Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));}
function protectedFingerprint(db){return {pools:db.prepare(`SELECT id,status,product_count FROM catalog_pool_versions
  WHERE category_key='motorcycle-accessories' ORDER BY id`).all(),memberships:db.prepare(`SELECT id,active FROM catalog_memberships
  WHERE category_key='motorcycle-accessories' ORDER BY id`).all()};}
