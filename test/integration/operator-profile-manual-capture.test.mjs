import assert from 'node:assert/strict';import test from 'node:test';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';
import {normalizeOperatorCategoryProfile} from '../../src/modules/catalog-scale/operator-category-profile.mjs';

test('capture-only Manual Bind retains electronics in raw candidate ledger',async t=>{
  const f=await createInitialPoolFixture(t);f.profile=operatorProfile();
  const created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Pet Raw',requestId:'pet-raw'}),source=f.service.currentOperatorManualContext().source;
  const value=payload(f,created.campaignId,source.id,'batch-1',[card('1','USB rechargeable bluetooth pet camera')]);
  const result=f.service.captureExtensionBatch(value);assert.equal(result.batch.stagingCount,1);assert.equal(result.batch.excludedCount,0);
  assert.equal(f.service.getInitialOperatorStatus(created.campaignId).liveUniqueCount,1);
});

test('capture-only Initial freezes DOM optional policy and reports actual saved transports',async t=>{const f=await createInitialPoolFixture(t);f.profile=operatorProfile();const created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Pet DOM Optional',requestId:'pet-dom-optional'}),source=f.service.currentOperatorManualContext().source,input=payload(f,created.campaignId,source.id,'batch-dom',[card('8101','Network Pet'),card('8102','DOM Pet')]);input.cards[1]={...input.cards[1],capture_transport:'DOM',network_observed:false,network_endpoint:null,network_observed_at:null};const stored=JSON.parse(f.db.prepare('SELECT config_json FROM catalog_campaigns WHERE id=?').get(created.campaignId).config_json);assert.equal(stored.captureTransportPolicy,'DOM_REQUIRED_NETWORK_OPTIONAL');const result=f.service.captureExtensionBatch(input);assert.equal(result.batch.receivedCount,2);assert.equal(result.audit.acceptedGoods,2);assert.equal(result.audit.networkEnrichedSaved,1);assert.equal(result.audit.domOnlySaved,1);assert.equal(result.audit.networkOnlyRejected,0);});

test('capture-only wrong path or breadcrumbs hard fails with zero writes',async t=>{
  const f=await createInitialPoolFixture(t);f.profile=operatorProfile();
  const created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Pet Guard',requestId:'pet-guard'}),source=f.service.currentOperatorManualContext().source;
  const valid=payload(f,created.campaignId,source.id,'batch-1',[card('1','Pet bowl')]);
  for(const mutate of [value=>{value.page_binding.bound_url='https://www.temu.com/de-en/other.html';value.page_url=value.page_binding.bound_url;},
    value=>{value.page_binding.bound_breadcrumbs=['Other','Pet Supplies'];}]){
    const attempt=structuredClone(valid);mutate(attempt);attempt.page_binding.context_fingerprint=fingerprint(bindingParts(attempt.page_binding));
    const before=counts(f.db);assert.throws(()=>f.service.captureExtensionBatch(attempt),error=>error.code==='PAGE_CONTEXT_LOST');assert.deepEqual(counts(f.db),before);
  }
});

function operatorProfile(){return normalizeOperatorCategoryProfile({display_name:'Pet Supplies',page_category_name:'Pet Supplies',category_aliases:['Pet Supplies','Pets'],parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],listing_url:'https://www.temu.com/de-en/pet-supplies.html'});}
function payload(f,campaignId,sourceId,batchId,cards){const pageUrl='https://www.temu.com/de-en/pet-supplies.html?sort=top';const binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,source_id:sourceId,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',bound_url:pageUrl,bound_at:'2026-09-01T00:00:00.000Z',bound_category:'Pets',bound_breadcrumbs:['Home & Pet','Pet Supplies'],bound_sort:'Top Sales',bound_goods_count:cards.length};binding.context_fingerprint=fingerprint(bindingParts(binding));return{campaign_id:campaignId,source_id:sourceId,batch_id:batchId,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,page_url:pageUrl,page_title:'Pets',captured_at:'2026-09-01T00:01:00.000Z',page_context:{site_country:'DE',language:'en',currency:'EUR',category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,sort_order:'Top Sales'},capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards:cards.map(row=>({...row,capture_transport:'NETWORK_ENRICHED',network_observed:true,network_endpoint:'/api/poppy/v1/opt',network_observed_at:'2026-09-01T00:00:30.000Z',bound_url:binding.bound_url,bound_at:binding.bound_at,bound_category:binding.bound_category,bound_sort:binding.bound_sort}))};}
function bindingParts(b){return[b.bound_url,b.site_country,b.language,b.currency,b.category_key,b.bound_category,b.bound_sort,b.bound_breadcrumbs];}
function fingerprint(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function card(goodsId,title){return{goods_id:goodsId,title,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,listing_rank:1,business_eligible:true,reviewable:true};}
function counts(db){return Object.fromEntries(['catalog_capture_batches','catalog_staging_products','catalog_initial_pool_candidate_items','catalog_initial_pool_batch_contexts','catalog_exclusion_observations'].map(table=>[table,Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));}
