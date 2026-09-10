import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

test('Scale Day2 Catalog API validates context, screens electronics, dedupes batches and reports source overlap without changing Product Pool',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-api-'));
  const config={ configPath:path.join(directory,'config.json'),app:{ environment:'development',databasePath:path.join(directory,'v2.db') },
    browser:{ mode:'external_cdp',profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000 },
    catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[] },reviews:{},export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') } };
  const app=await createOperationsServer({ config,runProcess:() => {},openTarget:async () => {},logError:() => {},browserDependencies:{ ready:async () => true,openSession:async () => ({ context:{} }),connectSession:async () => ({ context:{} }),currentPage:async () => ({}),inspectPage:async () => ({ status:'READY',code:'READY',checks:{} }) } });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const profile=await loadCategoryProfile(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));
  const inactive=app.catalogService.createCampaign({ name:'inactive-api-fixture',campaignType:'test',profile });
  const inactiveSource=app.catalogService.createSource(inactive.id,{ sourceKey:'inactive',sourceType:'category',sortOrder:'Top Sales' });
  const campaign=app.catalogService.createCampaign({ name:'day2-api-fixture',campaignType:'test',profile });
  const sourceA=app.catalogService.createSource(campaign.id,{ sourceKey:'source-a',sourceType:'category',sortOrder:'Top Sales' });
  const sourceB=app.catalogService.createSource(campaign.id,{ sourceKey:'source-b',sourceType:'product_family',sortOrder:'Top Sales' });
  app.catalogService.transitionCampaign(campaign.id,'running');
  const poolBefore=coreCounts(app.db);
  await assert.rejects(app.listen({ host:'0.0.0.0',port:0 }),/127\.0\.0\.1/);
  const address=await app.listen({ port:0 });
  const get=route => fetch(`${address.url}${route}`);
  const post=(route,payload) => fetch(`${address.url}${route}`,{ method:'POST',headers:{ 'Content-Type':'application/json','Origin':'chrome-extension://fixture' },body:JSON.stringify(payload) });

  let response=await get(`/api/catalog/context?campaign_id=${campaign.id}&source_id=${sourceA.id}`);let body=await response.json();
  assert.equal(response.status,200);assert.equal(body.context.profile.category_key,'motorcycle-accessories');assert.equal(body.context.source.id,sourceA.id);
  response=await get(`/api/catalog/context?campaign_id=${inactive.id}&source_id=${inactiveSource.id}`);body=await response.json();assert.equal(response.status,409);assert.equal(body.error.code,'CAMPAIGN_NOT_ACTIVE');

  const payload=batch(campaign.id,sourceA.id,'batch-1',[
    card('1001','Mechanical Motorcycle Tail Bag',1),card('1002','Rechargeable Bluetooth USB LED Headlight',2),card('1003',null,3)
  ]);
  response=await post('/api/catalog/batches',payload);body=await response.json();assert.equal(response.status,200);assert.equal(body.result.idempotentReplay,false);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal(body.result.campaign.rawObservedCount,3);assert.equal(body.result.campaign.electronicExcludedCount,1);
  assert.equal(body.result.campaign.nonElectronicUniqueCount,1);
  assert.equal(count(app.db,'catalog_staging_products'),2);
  assert.equal(count(app.db,'catalog_exclusion_observations')>=3,true);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1002'").get().count),0);

  response=await post('/api/catalog/batches',payload);body=await response.json();assert.equal(body.result.idempotentReplay,true);assert.equal(count(app.db,'catalog_capture_batches'),1);
  response=await post('/api/catalog/batches',{ ...payload,cards:[card('9999','Different mechanical item',1)] });body=await response.json();assert.equal(response.status,409);assert.equal(body.error.code,'CATALOG_BATCH_IDEMPOTENCY_CONFLICT');
  response=await post('/api/catalog/batches',batch(campaign.id,sourceA.id,'batch-2',[card('1001','Mechanical Motorcycle Tail Bag repeated',1)]));body=await response.json();assert.equal(response.status,200);
  response=await post('/api/catalog/batches',batch(campaign.id,sourceB.id,'batch-3',[card('1001','Mechanical Motorcycle Tail Bag overlap',1),card('1004','Motorcycle Cover',2)]));body=await response.json();assert.equal(response.status,200);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1001'").get().count),1);

  response=await get(`/api/catalog/status?campaign_id=${campaign.id}`);body=await response.json();assert.equal(response.status,200);
  const contributions=body.result.sourceContributions;assert.equal(contributions.length,2);
  const contributionByKey=Object.fromEntries(contributions.map(item => [item.sourceKey,item]));
  assert.equal(contributionByKey['source-a'].sourceUniqueCount,3);assert.equal(contributionByKey['source-b'].sourceUniqueCount,2);
  assert.equal(contributionByKey['source-a'].campaignOverlapCount,1);assert.equal(contributionByKey['source-b'].campaignOverlapCount,1);
  assert.equal(contributionByKey['source-a'].campaignNewUniqueCount,3);assert.equal(contributionByKey['source-b'].campaignNewUniqueCount,1);

  response=await post('/api/catalog/batches',batch(campaign.id,sourceA.id,'late-safe',[card('1010','Mechanical Phone Holder',1)]));body=await response.json();assert.equal(response.status,200);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1010'").get().count),1);
  response=await post('/api/catalog/batches',batch(campaign.id,sourceB.id,'late-risk',[card('1010','USB Rechargeable Phone Holder',1)]));body=await response.json();assert.equal(response.status,200);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1010'").get().count),0);
  response=await post('/api/catalog/batches',batch(campaign.id,sourceA.id,'late-safe-replay-title',[card('1010','Mechanical Phone Holder',1)]));body=await response.json();assert.equal(response.status,200);
  assert.equal(Number(app.db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1010'").get().count),0);

  response=await post('/api/catalog/batches',{ ...batch(campaign.id,sourceA.id,'bad-category',[card('2001','Mechanical Guard',1)]),category_key:'wrong-category' });body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'CATEGORY_MISMATCH');
  response=await post('/api/catalog/batches',{ ...batch(campaign.id,sourceA.id,'bad-sort',[card('2002','Mechanical Guard',1)]),page_context:{ ...pageContext(),sort_order:'Recommended' } });body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'SORT_ORDER_MISMATCH');
  response=await post('/api/catalog/batches',batch(campaign.id,sourceA.id,'missing-goods',[{ ...card('2003','Mechanical Guard',1),goods_id:null }]));body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'INVALID_GOODS_ID');
  response=await post('/api/catalog/batches',batch(campaign.id,'missing-source','missing-source',[card('2004','Mechanical Guard',1)]));body=await response.json();assert.equal(response.status,404);assert.equal(body.error.code,'CATALOG_SOURCE_NOT_FOUND');
  response=await post('/api/catalog/batches',{ oversized:'x'.repeat(1_000_100) });body=await response.json();assert.equal(response.status,400);assert.equal(body.error.code,'REQUEST_TOO_LARGE');
  assert.deepEqual(coreCounts(app.db),poolBefore);
  assert.equal(count(app.db,'catalog_pool_versions'),0);
});

function batch(campaignId,sourceId,batchId,cards) { return { campaign_id:campaignId,source_id:sourceId,batch_id:batchId,category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',page_url:'https://www.temu.com/de-en/motorcycle-accessories.html',page_title:'Motorcycle Accessories',captured_at:'2026-08-26T01:00:00.000Z',page_context:pageContext(),cards }; }
function pageContext() { return { site_country:'DE',language:'en',currency:'EUR',category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',sort_order:'Top Sales' }; }
function card(goodsId,title,rank) { return { goods_id:goodsId,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,title,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12.5,original_price_amount:20,sales_count:100,rating:4.8,review_count:20,listing_rank:rank,dom_sequence:rank,badge_text:null,raw_card_text:title ?? '' }; }
function count(db,table) { return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); }
function coreCounts(db) { return { products:count(db,'products'),activeMemberships:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count),snapshots:count(db,'product_snapshots'),reviews:count(db,'reviews') }; }
