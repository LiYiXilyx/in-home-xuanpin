import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction } from '../../src/db/client.mjs';
import { createInitialPoolRepository } from '../../src/db/repositories/initial-pool-repository.mjs';
import { buildInitialActivationPayload } from '../../src/modules/catalog-scale/initial-candidate-hash.mjs';
import { createInitialPoolFixture } from '../fixtures/initial-category-pool-fixture.mjs';

test('Initial QA accepts any nonempty count, replays exactly, and becomes STALE after capture',async t=>{
  for (const count of [1,10,87,137,500]) {
    const f=await createInitialPoolFixture(t);const created=f.service.createOperatorInitialCampaign({profile:f.profile,
      campaignName:`QA ${count}`,requestId:`qa-create-${count}`});seed(f,created.campaignId,count);
    const first=f.service.runInitialPoolQa({campaignId:created.campaignId,categoryKey:f.profile.category_key,
      categoryProfileVersion:f.profile.category_profile_version,requestId:`qa-run-${count}`});
    assert.equal(first.status,'PASSED_CURRENT');assert.equal(first.qaCandidateCount,count);
    const replay=f.service.runInitialPoolQa({campaignId:created.campaignId,categoryKey:f.profile.category_key,
      categoryProfileVersion:f.profile.category_profile_version,requestId:`qa-run-${count}`});
    assert.equal(replay.qaRunId,first.qaRunId);assert.equal(replay.idempotentReplay,true);
    seed(f,created.campaignId,1,{start:count+1});
    const stale=f.service.getInitialQaState(created.campaignId);assert.equal(stale.status,'STALE');
    assert.equal(stale.qaCandidateCount,count);assert.equal(stale.liveUniqueCount,count+1);assert.equal(stale.unreviewedDelta,1);
    assert.throws(()=>f.service.runInitialPoolQa({campaignId:created.campaignId,categoryKey:f.profile.category_key,
      categoryProfileVersion:f.profile.category_profile_version,requestId:`qa-run-${count}`}),
      error=>error.code==='INITIAL_QA_REQUEST_CONFLICT');
  }
});

test('empty Initial QA hard fails and frozen snapshot survives staging deletion',async t=>{
  const f=await createInitialPoolFixture(t);const created=f.service.createOperatorInitialCampaign({profile:f.profile,
    campaignName:'QA Empty',requestId:'qa-empty-create'});
  assert.throws(()=>f.service.runInitialPoolQa({campaignId:created.campaignId,categoryKey:f.profile.category_key,
    categoryProfileVersion:f.profile.category_profile_version,requestId:'qa-empty'}),error=>error.code==='INITIAL_POOL_EMPTY');
  seed(f,created.campaignId,1);const passed=f.service.runInitialPoolQa({campaignId:created.campaignId,
    categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version,requestId:'qa-one'});
  f.db.prepare('DELETE FROM catalog_staging_products WHERE campaign_id=?').run(created.campaignId);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM catalog_initial_pool_qa_candidate_items WHERE qa_run_id=?')
    .get(passed.qaRunId).count,1);
  assert.equal(f.service.getInitialQaState(created.campaignId).status,'PASSED_CURRENT');
});

function seed(f,campaignId,count,{start=1}={}) {
  const campaign=f.service.getCampaign(campaignId),source=f.service.currentOperatorManualContext().source;
  const repository=createInitialPoolRepository(f.db,{now:f.now}),items=[];
  for(let value=start;value<start+count;value+=1)items.push(buildInitialActivationPayload({campaign,source,batchId:'fixture-batch',product:{
    platform:'temu',goodsId:String(value),title:`Fixture Item ${value}`,sourceUrl:`https://www.temu.com/de-en/item-${value}.html`,
    canonicalUrl:`https://www.temu.com/goods.html?goods_id=${value}`,imageUrl:`https://img.test/${value}.jpg`,priceAmount:12,
    currency:'EUR',salesCount:100,rating:4.8,reviewCount:20,electronicScreeningStatus:'passed',businessEligible:true,
    reviewable:true,qualityStatus:'pending',raw:{}}}));
  transaction(f.db,()=>{
    if (!f.db.prepare('SELECT 1 FROM catalog_initial_pool_batch_contexts WHERE campaign_id=? AND batch_id=?').get(campaignId,'fixture-batch'))
      repository.recordBatchContext({campaign,source,batchId:'fixture-batch',captureMode:'MANUAL_BIND_PASSIVE_CAPTURE',
        pageUrl:'https://www.temu.com/de-en/fixture-category-b.html',pageContext:{siteCountry:'DE',language:'en',currency:'EUR',
          sortOrder:'Top Sales'},pageBinding:{binding_version:'manual-bind-v1',context_fingerprint:'fixture-fingerprint'}});
    repository.applyCandidateItems(campaign,items);
  });
}
