import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPoolFixture } from '../fixtures/initial-category-pool-fixture.mjs';

test('Initial Manual Capture remains open at 10, 100, and 1000 unique products', async t => {
  const f=await createInitialPoolFixture(t);
  const created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Open Capture',requestId:'open-capture'});
  const source=f.service.currentOperatorManualContext().source;
  let current=0;
  for (const end of [10,100,500,1000]) {
    const cards=[];
    for (let value=current+1;value<=end;value+=1) cards.push(card(String(value),value));
    f.service.captureExtensionBatch(payload(f,created.campaignId,source.id,`batch-${end}`,cards));
    current=end;
    const status=f.service.getInitialOperatorStatus(created.campaignId);
    assert.equal(status.liveUniqueCount,end);
    assert.equal(status.targetCount,null);
    assert.equal(status.remaining,null);
    assert.equal(status.targetReached,null);
    assert.equal(status.quantityMode,'OPEN_ENDED');
    assert.equal(status.status,'running');
  }
  assert.equal(Number(f.db.prepare(`SELECT COUNT(*) AS count FROM catalog_initial_pool_batch_contexts
    WHERE campaign_id=?`).get(created.campaignId).count),4);
});

test('unbound and changed binding context reject Initial capture with zero writes', async t => {
  const f=await createInitialPoolFixture(t);
  const created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Guard Capture',requestId:'guard-capture'});
  const source=f.service.currentOperatorManualContext().source;
  const valid=payload(f,created.campaignId,source.id,'guard-batch',[card('1',1)]);
  for (const mutate of [value=>{delete value.page_binding;},value=>{value.page_binding.currency='USD';}]) {
    const attempt=structuredClone(valid);mutate(attempt);
    const before=writeCounts(f.db);
    assert.throws(()=>f.service.captureExtensionBatch(attempt),error=>
      ['PAGE_BINDING_REQUIRED','PAGE_CONTEXT_LOST'].includes(error.code));
    assert.deepEqual(writeCounts(f.db),before);
  }
});

function payload(f,campaignId,sourceId,batchId,cards) {
  const pageUrl='https://www.temu.com/de-en/fixture-category-b.html';
  const binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,
    source_id:sourceId,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,
    site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',bound_url:pageUrl,
    bound_at:'2026-08-31T16:30:00.000Z',bound_category:'Fixture Category B',bound_sort:'Top Sales',
    bound_goods_count:cards.length};
  binding.context_fingerprint=fingerprint([binding.bound_url,binding.site_country,binding.language,binding.currency,
    binding.category_key,binding.bound_category,binding.bound_sort]);
  return {campaign_id:campaignId,source_id:sourceId,batch_id:batchId,category_key:f.profile.category_key,
    category_profile_version:f.profile.category_profile_version,page_url:pageUrl,page_title:'Fixture Category B',
    captured_at:'2026-08-31T16:31:00.000Z',page_context:{site_country:'DE',language:'en',currency:'EUR',
      category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,sort_order:'Top Sales'},
    capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards:cards.map(value=>({...value,
      capture_transport:'NETWORK_ENRICHED',network_observed:true,network_endpoint:'/api/poppy/v1/opt',
      network_observed_at:'2026-08-31T16:30:30.000Z',bound_url:binding.bound_url,bound_at:binding.bound_at,
      bound_category:binding.bound_category,bound_sort:binding.bound_sort}))};
}
function card(goodsId,rank) { return {goods_id:goodsId,title:`Mechanical Fixture Item ${goodsId}`,
  href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,
  price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,listing_rank:rank,
  business_eligible:true,reviewable:true}; }
function fingerprint(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function writeCounts(db){return Object.fromEntries(['catalog_capture_batches','catalog_staging_products',
  'catalog_initial_pool_candidate_items','catalog_initial_pool_batch_contexts'].map(table=>
  [table,Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));}
