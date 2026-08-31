import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResumeCampaign } from '../../src/modules/catalog-scale/campaign-selection.mjs';

const profile={category_key:'category-b',category_profile_version:'category-b-v1',taxonomy_bindings:{}};
test('resume requires explicit campaign id',()=>assert.throws(()=>validateResumeCampaign({getCampaign(){}},{campaignId:null,profile,campaignType:'refresh'}),e=>e.code==='CAMPAIGN_RESUME_ID_REQUIRED'));
test('resume rejects category, profile and type mismatches',()=>{
  assert.throws(()=>validateResumeCampaign(service({categoryKey:'category-a'}),{campaignId:'a',profile,campaignType:'refresh'}),e=>e.code==='CAMPAIGN_CATEGORY_MISMATCH');
  assert.throws(()=>validateResumeCampaign(service({categoryProfileVersion:'category-b-v0'}),{campaignId:'a',profile,campaignType:'refresh'}),e=>e.code==='CAMPAIGN_PROFILE_VERSION_MISMATCH');
  assert.throws(()=>validateResumeCampaign(service({campaignType:'expansion'}),{campaignId:'a',profile,campaignType:'refresh'}),e=>e.code==='CAMPAIGN_TYPE_MISMATCH');
});
test('matching explicit campaign is returned',()=>assert.equal(validateResumeCampaign(service({}),{campaignId:'b',profile,campaignType:'refresh'}).id,'b'));
function service(overrides){return {getCampaign:id=>({id,campaignType:'refresh',categoryKey:'category-b',categoryProfileVersion:'category-b-v1',config:{categoryProfile:profile},...overrides})};}
