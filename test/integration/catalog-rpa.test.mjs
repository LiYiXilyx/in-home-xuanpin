import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

test('Scale Day3 Catalog RPA queue claims, checkpoints, manual-resumes and completes without duplicate staging or Product Pool writes',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-rpa-'));
  const config={ configPath:path.join(directory,'config.json'),app:{ environment:'development',databasePath:path.join(directory,'v2.db') },
    browser:{ mode:'external_cdp',profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000 },
    catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[] },reviews:{},export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') } };
  const app=await createOperationsServer({ config,runProcess:() => {},openTarget:async () => {},logError:() => {},browserDependencies:{ ready:async () => true,openSession:async () => ({ context:{} }),connectSession:async () => ({ context:{} }),currentPage:async () => ({}),inspectPage:async () => ({ status:'READY',code:'READY',checks:{} }) } });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const profile=await loadCategoryProfile(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));
  const campaign=app.catalogService.createCampaign({ name:'day3-rpa-fixture',campaignType:'smoke',profile });
  const source=app.catalogService.createSource(campaign.id,{ sourceKey:'main-top-sales',sourceType:'category',sortOrder:'Top Sales',targetQuota:300,priority:1 });
  app.catalogService.createSource(campaign.id,{ sourceKey:'second-source',sourceType:'product_family',sortOrder:'Top Sales',targetQuota:50,priority:2 });
  app.catalogService.transitionCampaign(campaign.id,'running');
  const poolBefore=coreCounts(app.db);const address=await app.listen({ port:0 });
  const post=async (route,payload) => { const response=await fetch(`${address.url}${route}`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(payload) });return { response,body:await response.json() }; };

  let call=await post('/api/catalog-rpa/claim-next',{ campaign_id:campaign.id });assert.equal(call.response.status,200);assert.equal(call.body.result.idle,false);
  const queue=call.body.result.queue;assert.equal(queue.status,'opening');assert.ok(queue.claimToken);assert.equal(queue.sourceId,source.id);
  call=await post('/api/catalog-rpa/claim-next',{ campaign_id:campaign.id });assert.equal(call.response.status,409);assert.equal(call.body.error.code,'CATALOG_RPA_CLAIM_CONFLICT');
  let response=await fetch(`${address.url}/api/catalog-rpa/current-context`);let body=await response.json();assert.equal(response.status,200);assert.equal(body.context.queue.claimToken,undefined);assert.equal(body.context.source.id,source.id);
  call=await post('/api/catalog-rpa/source-opened',{ queue_id:queue.id,claim_token:'wrong',page_url:'https://www.temu.com/de-en/motorcycles.html' });assert.equal(call.response.status,409);assert.equal(call.body.error.code,'CATALOG_RPA_CLAIM_MISMATCH');
  call=await post('/api/catalog-rpa/source-opened',{ queue_id:queue.id,claim_token:queue.claimToken,page_url:'https://www.temu.com/de-en/motorcycles.html' });assert.equal(call.body.result.status,'waiting_page_ready');
  call=await post('/api/catalog-extension/checkpoint',{ campaign_id:campaign.id,source_id:source.id,queue_id:queue.id,status:'capturing',
    checkpoint:{ runner_state:'SCANNING',round:1,batch_id:'extension-batch-1',current_unique:0 } });
  assert.equal(call.response.status,200);assert.equal(call.body.result.checkpoint.controlMode,'extension_auto_runner');assert.equal(call.body.result.claimToken,undefined);
  call=await post('/api/catalog-extension/checkpoint',{ campaign_id:'wrong',source_id:source.id,queue_id:queue.id,status:'capturing',checkpoint:{ round:2 } });
  assert.equal(call.response.status,409);assert.equal(call.body.error.code,'CATALOG_RPA_CLAIM_MISMATCH');
  call=await post('/api/catalog-extension/manual-required',{ campaign_id:campaign.id,source_id:source.id,queue_id:queue.id,
    error_code:'CAPTCHA_OR_LOGIN',error_message:'extension fixture',checkpoint:{ runner_state:'MANUAL_REQUIRED',round:1 } });
  assert.equal(call.response.status,200);assert.equal(call.body.result.status,'manual_required');assert.equal(app.catalogService.getCampaign(campaign.id).status,'manual_required');
  response=await fetch(`${address.url}/api/catalog-rpa/current-context`);body=await response.json();assert.equal(response.status,200);
  assert.equal(body.context.queue.status,'manual_required');assert.equal(body.context.queue.claimToken,undefined);assert.equal(body.context.queue.checkpoint.round,1);
  call=await post('/api/catalog-extension/resume',{ campaign_id:campaign.id,source_id:source.id,queue_id:queue.id,checkpoint:{ resume_verified:true } });
  assert.equal(call.response.status,200);assert.equal(call.body.result.status,'opening');assert.equal(app.catalogService.getCampaign(campaign.id).status,'running');
  call=await post('/api/catalog-rpa/checkpoint',{ queue_id:queue.id,claim_token:queue.claimToken,status:'capturing',checkpoint:{ scroll_rounds:1,load_more_count:0,new_goods_per_round:[3],stale_rounds:0,manual_gate_count:0 } });assert.equal(call.body.result.status,'capturing');

  const batchPayload=batch(campaign.id,source.id,'rpa-batch-1');call=await post('/api/catalog/batches',batchPayload);assert.equal(call.response.status,200);assert.equal(call.body.result.idempotentReplay,false);
  call=await post('/api/catalog-rpa/manual-required',{ queue_id:queue.id,claim_token:queue.claimToken,error_code:'LISTING_CONTEXT_UNHEALTHY',error_message:'fixture manual gate',checkpoint:{ manual_gate_count:1 } });assert.equal(call.body.result.status,'manual_required');assert.equal(app.catalogService.getCampaign(campaign.id).status,'manual_required');
  call=await post('/api/catalog-rpa/resume',{ queue_id:queue.id,claim_token:queue.claimToken,checkpoint:{ resume_verified:true } });assert.equal(call.body.result.status,'opening');assert.equal(app.catalogService.getCampaign(campaign.id).status,'running');
  call=await post('/api/catalog-rpa/checkpoint',{ queue_id:queue.id,claim_token:queue.claimToken,status:'capturing',checkpoint:{ scroll_rounds:2,load_more_count:1,new_goods_per_round:[3,0],stale_rounds:1,manual_gate_count:1,last_batch_id:'rpa-batch-1' } });assert.equal(call.body.result.status,'capturing');
  call=await post('/api/catalog/batches',batchPayload);assert.equal(call.body.result.idempotentReplay,true);assert.equal(count(app.db,'catalog_capture_batches'),1);assert.equal(count(app.db,'catalog_staging_products'),2);
  call=await post('/api/catalog-rpa/checkpoint',{ queue_id:queue.id,claim_token:queue.claimToken,status:'waiting_load_more',checkpoint:{ load_state:'LOAD_MORE_RETRYABLE',load_more_retry_count:2,new_goods_count:0 } });assert.equal(call.body.result.status,'waiting_load_more');
  call=await post('/api/catalog-rpa/source-complete',{ queue_id:queue.id,claim_token:queue.claimToken,stop_reason:'SOURCE_EXHAUSTED' });assert.equal(call.response.status,400);assert.equal(call.body.error.code,'CATALOG_SOURCE_EXHAUSTION_NOT_PROVEN');
  call=await post('/api/catalog-rpa/checkpoint',{ queue_id:queue.id,claim_token:queue.claimToken,status:'capturing',checkpoint:{ load_state:'LOAD_MORE_PROGRESS',new_goods_count:2 } });assert.equal(call.body.result.status,'capturing');
  call=await post('/api/catalog-rpa/source-complete',{ queue_id:queue.id,claim_token:queue.claimToken,stop_reason:'SMOKE_FIXTURE_COMPLETE',checkpoint:{ raw_observation_count:3 } });assert.equal(call.body.result.queue.status,'completed');
  assert.equal(app.db.prepare('SELECT status FROM catalog_sources WHERE id=?').get(source.id).status,'completed');
  const sourceRun=app.db.prepare('SELECT * FROM catalog_source_runs WHERE source_id=?').get(source.id);assert.equal(sourceRun.scroll_rounds,2);assert.equal(sourceRun.load_more_count,1);assert.equal(sourceRun.stop_reason,'SMOKE_FIXTURE_COMPLETE');
  assert.deepEqual(coreCounts(app.db),poolBefore);assert.equal(count(app.db,'catalog_pool_versions'),0);
});

function batch(campaignId,sourceId,batchId) { return { campaign_id:campaignId,source_id:sourceId,batch_id:batchId,category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',page_url:'https://www.temu.com/de-en/motorcycle-accessories.html',page_title:'Motorcycle Accessories',captured_at:'2026-08-26T06:00:00.000Z',page_context:{ site_country:'DE',language:'en',currency:'EUR',category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',sort_order:'Top Sales' },cards:[card('3001','Mechanical Tail Bag',1),card('3002','USB Rechargeable LED Headlight',2),card('3003','Motorcycle Cover',3)] }; }
function card(goodsId,title,rank) { return { goods_id:goodsId,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,title,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,sales_count:10,rating:4.8,review_count:2,listing_rank:rank,dom_sequence:rank,badge_text:null,raw_card_text:title }; }
function count(db,table) { return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); }
function coreCounts(db) { return { products:count(db,'products'),activeMemberships:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count),snapshots:count(db,'product_snapshots'),reviews:count(db,'reviews') }; }
