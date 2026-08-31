import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';
import { fixtureCategoryProfile } from '../fixtures/initial-category-pool-fixture.mjs';
import { transaction } from '../../src/db/client.mjs';
import { createInitialPoolRepository } from '../../src/db/repositories/initial-pool-repository.mjs';
import { buildInitialActivationPayload } from '../../src/modules/catalog-scale/initial-candidate-hash.mjs';

test('Initial API creates, runs server-owned QA, and explicitly activates exact scope',async t=>{
  const f=await serverFixture(t);let response=await f.post('/api/catalog/operator/initial-campaigns',{
    category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,
    campaign_name:'Initial UI',request_id:'create-1',target_count:1});let body=await response.json();
  assert.equal(response.status,201);assert.equal(body.result.target_count,null);assert.equal(body.result.quantity_mode,'OPEN_ENDED');
  const campaignId=body.result.campaign_id;seed(f,campaignId,10);
  response=await f.post(`/api/catalog/operator/initial-campaigns/${campaignId}/qa-runs`,{
    campaign_id:campaignId,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,
    request_id:'qa-1',qa_passed:true,candidate_hash:'client-must-not-authorize'});body=await response.json();
  assert.equal(response.status,200);assert.equal(body.result.qa_status,'PASSED_CURRENT');
  response=await f.post(`/api/catalog/operator/initial-campaigns/${campaignId}/activate`,{
    campaign_id:campaignId,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,
    request_id:'activate-1',pool_count:999});body=await response.json();
  assert.equal(response.status,200);assert.equal(body.result.pool_count,10);assert.equal(body.result.category_key,f.profile.category_key);
});

test('Initial API rejects empty QA and wrong URL/body identity with zero writes',async t=>{
  const f=await serverFixture(t),created=await (await f.post('/api/catalog/operator/initial-campaigns',{
    category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,
    campaign_name:'Guard UI',request_id:'guard-create'})).json();const id=created.result.campaign_id;
  let before=fingerprint(f.app.db),response=await f.post(`/api/catalog/operator/initial-campaigns/${id}/qa-runs`,{
    campaign_id:id,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,request_id:'empty'});
  let body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'INITIAL_POOL_EMPTY');
  assert.deepEqual(fingerprint(f.app.db),before);
  before=fingerprint(f.app.db);response=await f.post(`/api/catalog/operator/initial-campaigns/${id}/activate`,{
    campaign_id:'wrong',category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,request_id:'wrong'});
  body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'INITIAL_CAMPAIGN_IDENTITY_INVALID');
  assert.deepEqual(fingerprint(f.app.db),before);
});

async function serverFixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-initial-api-')),
  profileDirectory=path.join(directory,'categories');fs.mkdirSync(profileDirectory);const profile=fixtureCategoryProfile();
  fs.writeFileSync(path.join(profileDirectory,'fixture-category-b.json'),JSON.stringify(profile));
  const config={app:{environment:'development',databasePath:path.join(directory,'fixture.db')},browser:{mode:'external_cdp',
    profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000},catalog:{siteCountry:'德国',language:'en',currency:'EUR',jobs:[]},
    reviews:{},export:{outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images')}};
  const app=await createOperationsServer({config,categoryProfileDirectory:profileDirectory,runProcess:()=>{},openTarget:async()=>{},logError:()=>{},
    browserDependencies:{ready:async()=>true,openSession:async()=>({context:{}}),connectSession:async()=>({context:{}}),currentPage:async()=>({}),
      inspectPage:async()=>({status:'READY',code:'READY',checks:{}})}});t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
  const address=await app.listen({port:0}),post=(route,payload)=>fetch(`${address.url}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return {app,post,profile};}
function seed(f,campaignId,count){const campaign=f.app.catalogService.getCampaign(campaignId),context=f.app.catalogService.currentOperatorManualContext(),
  repository=createInitialPoolRepository(f.app.db),items=[];for(let value=1;value<=count;value+=1)items.push(buildInitialActivationPayload({campaign,
    source:context.source,batchId:'api-batch',product:{platform:'temu',goodsId:String(value),title:`Item ${value}`,
      sourceUrl:`https://www.temu.com/de-en/item-${value}.html`,canonicalUrl:`https://www.temu.com/goods.html?goods_id=${value}`,
      imageUrl:`https://img.test/${value}.jpg`,priceAmount:12,currency:'EUR',salesCount:100,rating:4.8,reviewCount:20,
      electronicScreeningStatus:'passed',businessEligible:true,reviewable:true,qualityStatus:'pending',raw:{}}}));
  transaction(f.app.db,()=>{repository.recordBatchContext({campaign,source:context.source,batchId:'api-batch',captureMode:'MANUAL_BIND_PASSIVE_CAPTURE',
    pageUrl:'https://www.temu.com/de-en/fixture-category-b.html',pageContext:{siteCountry:'DE',language:'en',currency:'EUR',sortOrder:'Top Sales'},
    pageBinding:{binding_version:'manual-bind-v1',context_fingerprint:'api-fingerprint'}});repository.applyCandidateItems(campaign,items);});}
function fingerprint(db){return Object.fromEntries(['catalog_initial_pool_qa_runs','catalog_pool_versions','products','catalog_memberships']
  .map(table=>[table,Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));}
