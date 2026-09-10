import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialActivationPayload,buildInitialCreatePayload,buildInitialQaPayload,initialOperatorViewModel }
  from '../../ui/operator-campaign.js';

test('Initial view never exposes target/sentinel and disables stale activation',()=>{
  const view=initialOperatorViewModel({campaign_type:'initial',quantity_mode:'OPEN_ENDED',target_count:null,
    remaining:null,target_reached:null,current_unique:180,qa:{status:'STALE',qa_candidate_count:137,unreviewed_delta:43}});
  assert.equal(view.modeLabel,'不限数量 / OPEN_ENDED');assert.equal(view.currentCount,180);
  assert.equal(view.unreviewedDelta,43);assert.equal(view.activationEnabled,false);
  assert.doesNotMatch(JSON.stringify(view),/2147483647/);
});

test('Initial payload builders send only explicit identity and request IDs',()=>{
  const profile={category_key:'category-b',category_profile_version:'category-b-v1'};
  assert.deepEqual(buildInitialCreatePayload({profile,campaignName:'Initial B',requestId:'create-1'}),{
    category_key:'category-b',category_profile_version:'category-b-v1',campaign_name:'Initial B',request_id:'create-1'});
  assert.deepEqual(buildInitialQaPayload({campaignId:'c1',profile,requestId:'qa-1'}),{
    campaign_id:'c1',category_key:'category-b',category_profile_version:'category-b-v1',request_id:'qa-1'});
  assert.deepEqual(buildInitialActivationPayload({campaignId:'c1',profile,requestId:'a-1'}),{
    campaign_id:'c1',category_key:'category-b',category_profile_version:'category-b-v1',request_id:'a-1'});
});

test('Initial UI state matrix never enables activation before PASSED_CURRENT',()=>{
  for(const [status,count,qaEnabled,activationEnabled] of [
    ['NOT_RUN',0,false,false],['NOT_RUN',10,true,false],['RUNNING',10,false,false],
    ['FAILED',10,true,false],['STALE',11,true,false],['PASSED_CURRENT',10,true,true],['ACTIVATING',10,false,false]
  ]){const view=initialOperatorViewModel({campaign_type:'initial',current_unique:count,qa:{status,qa_candidate_count:10}});
    assert.equal(view.qaEnabled,qaEnabled,status);assert.equal(view.activationEnabled,activationEnabled,status);}
});
