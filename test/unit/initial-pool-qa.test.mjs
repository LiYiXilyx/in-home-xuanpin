import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInitialPoolQa } from '../../src/modules/catalog-scale/initial-pool-qa.mjs';

function fixture() {
  const payload={platform:'temu',goods_id:'1',category_key:'fixture-category-b',category_profile_version:'fixture-category-b-v1',
    title:'Fixture Item',source_url:'https://www.temu.com/de-en/item-1.html',canonical_url:'https://www.temu.com/goods.html?goods_id=1',
    image_url:'https://img.test/1.jpg',price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20};
  return {campaign:{campaignType:'initial',categoryKey:'fixture-category-b',categoryProfileVersion:'fixture-category-b-v1'},
    profile:{category_key:'fixture-category-b',category_profile_version:'fixture-category-b-v1',site_country:'DE',language:'en',currency:'EUR',
      sort_order:'Top Sales',taxonomy_bindings:{classify:{},fine_classify:{},opportunity:{}},business_rules:{initial_pool_quality:{title:.95,price:.95,image:.95,sales:.90,rating:.90,review_count:.90}}},
    candidateItems:[{platform:'temu',goodsId:'1',categoryKey:'fixture-category-b',categoryProfileVersion:'fixture-category-b-v1',sourceId:'s1',firstBatchId:'b1',activationPayload:payload}],
    batchContexts:[{sourceId:'s1',batchId:'b1',siteCountry:'DE',language:'en',currency:'EUR',categoryKey:'fixture-category-b',categoryProfileVersion:'fixture-category-b-v1',sortOrder:'Top Sales',captureMode:'MANUAL_BIND_PASSIVE_CAPTURE',pageHealthStatus:'READY',domReady:true,networkReady:true,captchaBlocking:false,searchNoResults:false,bindingFingerprint:'abc'}],
    membershipEvidence:{ambiguous:false,crossCategoryContamination:false},integrityCheck:()=> 'ok',foreignKeyCheck:()=>[],nowMs:()=>0};
}

for (const [code,mutate] of [
  ['INITIAL_CAMPAIGN_IDENTITY_INVALID',x=>{x.campaign.campaignType='refresh';}],
  ['INITIAL_POOL_EMPTY',x=>{x.candidateItems=[];}],
  ['INITIAL_GOODS_ID_DUPLICATE',x=>{x.candidateItems.push({...x.candidateItems[0]});}],
  ['INITIAL_MARKET_CONTEXT_INVALID',x=>{x.batchContexts[0].currency='USD';}],
  ['INITIAL_SOURCE_CONTEXT_INVALID',x=>{x.batchContexts[0].sortOrder='Recommended';}],
  ['INITIAL_PAGE_HEALTH_INVALID',x=>{x.batchContexts[0].captchaBlocking=true;}],
  ['INITIAL_BINDING_EVIDENCE_INVALID',x=>{x.batchContexts[0].bindingFingerprint='';}],
  ['INITIAL_DATA_QUALITY_FAILED',x=>{x.candidateItems[0].activationPayload.image_url=null;}],
  ['INITIAL_MEMBERSHIP_AMBIGUOUS',x=>{x.membershipEvidence.ambiguous=true;}],
  ['INITIAL_CROSS_CATEGORY_CONTAMINATION',x=>{x.candidateItems[0].categoryKey='foreign';}],
  ['SQLITE_INTEGRITY_FAILED',x=>{x.integrityCheck=()=> 'broken';}],
  ['SQLITE_FOREIGN_KEY_FAILED',x=>{x.foreignKeyCheck=()=>[{table:'bad'}];}]
]) test(`mandatory QA blocks ${code}`,()=>{
  const value=fixture();mutate(value);const result=evaluateInitialPoolQa(value);
  assert.equal(result.passed,false);assert.ok(result.failureCodes.includes(code));
});

test('complete deterministic candidate passes every mandatory Gate',()=>{
  const result=evaluateInitialPoolQa(fixture());assert.equal(result.passed,true);assert.deepEqual(result.failureCodes,[]);
  assert.ok(result.checks.every(check=>check.durationMs>=0));
});
