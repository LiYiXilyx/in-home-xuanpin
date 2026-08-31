import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction } from '../../src/db/client.mjs';
import { createInitialPoolRepository } from '../../src/db/repositories/initial-pool-repository.mjs';
import { buildInitialActivationPayload } from '../../src/modules/catalog-scale/initial-candidate-hash.mjs';
import { createInitialPoolFixture } from '../fixtures/initial-category-pool-fixture.mjs';

test('live Candidate ledger advances only for deterministic business changes', async t => {
  const f=await createInitialPoolFixture(t);
  const created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Ledger Initial',requestId:'ledger-create'});
  const campaign=f.service.getCampaign(created.campaignId);
  const source=f.service.getSource(f.service.currentOperatorManualContext().source.id);
  const repository=createInitialPoolRepository(f.db,{now:f.now});
  const item=(goodsId,extra={})=>buildInitialActivationPayload({campaign,source,batchId:'batch-1',product:{
    platform:'temu',goodsId:String(goodsId),title:`Item ${goodsId}`,sourceUrl:`https://www.temu.com/de-en/item-${goodsId}.html`,
    canonicalUrl:`https://www.temu.com/goods.html?goods_id=${goodsId}`,imageUrl:`https://img.test/${goodsId}.jpg`,
    priceAmount:12,currency:'EUR',salesCount:100,rating:4.8,reviewCount:20,electronicScreeningStatus:'passed',
    businessEligible:true,reviewable:true,qualityStatus:'pending',raw:{last_seen_at:'ignored'},...extra}});

  const apply=items=>transaction(f.db,()=>repository.applyCandidateItems(campaign,items));
  const first=apply([item('1')]);
  assert.equal(first.currentRevision,1);assert.equal(first.candidateCount,1);
  const replay=apply([item('1',{raw:{last_seen_at:'changed'}})]);
  assert.equal(replay.currentRevision,1);assert.equal(replay.currentHash,first.currentHash);
  const second=apply([item('2')]);
  assert.equal(second.currentRevision,2);assert.equal(second.candidateCount,2);
  const changed=apply([item('1',{priceAmount:13})]);
  assert.equal(changed.currentRevision,3);assert.notEqual(changed.currentHash,second.currentHash);
  assert.equal(f.service.getCampaign(campaign.id).nonElectronicUniqueCount,2);
  assert.deepEqual(repository.listCandidateItems(campaign.id).map(row=>row.goodsId),['1','2']);
});
