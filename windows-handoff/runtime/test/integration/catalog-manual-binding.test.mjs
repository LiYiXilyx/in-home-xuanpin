import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { createCatalogCampaignService } from '../../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

const profilePath=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('server manual binding gate rejects unbound/context-lost captures with zero writes and accepts deterministic replay',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-manual-server-gate-')),databasePath=path.join(directory,'fixture.db');migrateDatabase({databasePath});
  const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const profile=await loadCategoryProfile(profilePath),service=createCatalogCampaignService(db,{now:()=> '2026-08-31T00:00:00.000Z'});
  const campaign=service.createCampaign({name:'manual-fixture',campaignType:'smoke',profile,targetCount:10,browserContext:{controlMode:'MANUAL_BIND_PASSIVE_CAPTURE'}});
  const source=service.createSource(campaign.id,{sourceKey:'manual',sourceType:'category',sortOrder:'Top Sales'});service.transitionCampaign(campaign.id,'running');
  const payload=manualPayload(campaign.id,source.id,'manual-stable');
  const unbound={...payload,page_binding:null},before=counts(db);
  assert.throws(()=>service.captureExtensionBatch(unbound),error=>error.code==='PAGE_BINDING_REQUIRED');assert.deepEqual(counts(db),before);
  const changed=structuredClone(payload);changed.page_binding.bound_category='Home';
  assert.throws(()=>service.captureExtensionBatch(changed),error=>error.code==='PAGE_CONTEXT_LOST');assert.deepEqual(counts(db),before);
  const first=service.captureExtensionBatch(payload),after=counts(db);assert.equal(first.idempotentReplay,false);
  const second=service.captureExtensionBatch(payload);assert.equal(second.idempotentReplay,true);assert.deepEqual(counts(db),after);
});

test('legacy strict Manual Campaign rejects DOM-only transport with zero writes',async t=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-strict-transport-')),databasePath=path.join(directory,'fixture.db');migrateDatabase({databasePath});const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});const profile=await loadCategoryProfile(profilePath),service=createCatalogCampaignService(db,{now:()=> '2026-08-31T00:00:00.000Z'}),campaign=service.createCampaign({name:'strict-fixture',campaignType:'smoke',profile,targetCount:10,browserContext:{controlMode:'MANUAL_BIND_PASSIVE_CAPTURE'}}),source=service.createSource(campaign.id,{sourceKey:'manual',sourceType:'category',sortOrder:'Top Sales'});service.transitionCampaign(campaign.id,'running');const input=manualPayload(campaign.id,source.id,'strict-dom'),card=input.cards[0];input.cards[0]={...card,capture_transport:'DOM',network_observed:false,network_endpoint:null,network_observed_at:null};const before=counts(db);assert.throws(()=>service.captureExtensionBatch(input),error=>error.code==='MANUAL_PASSIVE_EVIDENCE_REQUIRED');assert.deepEqual(counts(db),before);});

function manualPayload(campaignId,sourceId,batchId){const pageUrl='https://www.temu.com/de-en/motorcycle-accessories.html',binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,source_id:sourceId,category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',bound_url:pageUrl,bound_at:'2026-08-31T00:00:00.000Z',bound_category:'Motorcycles & Powersports Accessories',bound_sort:'Top Sales',bound_goods_count:1};binding.context_fingerprint=fingerprint([binding.bound_url,binding.site_country,binding.language,binding.currency,binding.category_key,binding.bound_category,binding.bound_sort]);return{campaign_id:campaignId,source_id:sourceId,batch_id:batchId,category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',page_url:pageUrl,page_title:'Motorcycles & Powersports Accessories',captured_at:'2026-08-31T00:00:00.000Z',page_context:{site_country:'DE',language:'en',currency:'EUR',category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',sort_order:'Top Sales'},capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards:[{goods_id:'9101',href:'https://www.temu.com/de-en/item-g-9101.html',title:'Mechanical motorcycle cover',image_url:'https://img.test/9101.jpg',price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,capture_transport:'NETWORK_ENRICHED',network_observed:true,network_endpoint:'/api/poppy/v1/opt',network_observed_at:'2026-08-31T00:00:00.000Z',bound_url:binding.bound_url,bound_at:binding.bound_at,bound_category:binding.bound_category,bound_sort:binding.bound_sort}]};}
function fingerprint(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function counts(db){return Object.fromEntries(['catalog_capture_batches','catalog_product_source_observations','catalog_staging_products','catalog_exclusion_observations'].map(table=>[table,Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)]));}
