import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';
import {createCatalogScopedExportRepository} from '../../src/db/repositories/catalog-scoped-export-repository.mjs';
import {createCatalogScopedExportService} from '../../src/modules/catalog-scale/catalog-scoped-export-service.mjs';

test('preview requires exact current revision and formal export requires exact active Pool tuple with zero writes',async t=>{
  const f=await createInitialPoolFixture(t),created=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Scoped Export',requestId:'scoped-export'}),source=f.service.currentOperatorManualContext().source;
  f.service.captureExtensionBatch(payload(f,created.campaignId,source.id,[card('20'),card('3')]));
  const repository=createCatalogScopedExportRepository(f.db),before=fingerprint(f.db),status=f.service.getInitialOperatorStatus(created.campaignId);
  const preview=repository.readPreview({campaignId:created.campaignId,candidateRevision:status.candidateRevision,categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version});
  assert.deepEqual(preview.products.map(row=>row.goods_id),['20','3']);assert.equal(preview.scope.activation_status,'NOT_ACTIVE_POOL');
  assert.deepEqual(fingerprint(f.db),before);
  const exporter=createCatalogScopedExportService({repository,outputDir:path.join(f.directory,'exports')});
  const previewFile=await exporter.exportPreview({campaignId:created.campaignId,candidateRevision:status.candidateRevision,categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version});
  assert.equal(fs.readFileSync(previewFile.saved_path).subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])),true);
  assert.deepEqual(fingerprint(f.db),before);
  assert.throws(()=>repository.readPreview({campaignId:created.campaignId,candidateRevision:status.candidateRevision-1,categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version}),error=>error.code==='CATALOG_PREVIEW_REVISION_STALE');
  f.service.runInitialPoolQa({campaignId:created.campaignId,categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version,requestId:'qa-export'});
  const activated=f.service.activateInitialPool({campaignId:created.campaignId,categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version,requestId:'activate-export'});
  const formalBefore=fingerprint(f.db);
  const formal=repository.readFormalPool({poolVersionId:activated.poolVersionId,categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version});
  assert.deepEqual(formal.products.map(row=>row.goods_id),['20','3']);assert.equal(formal.scope.activation_status,'ACTIVE_POOL');
  const formalFile=await exporter.exportFormalPool({poolVersionId:activated.poolVersionId,categoryKey:f.profile.category_key,categoryProfileVersion:f.profile.category_profile_version});
  assert.equal(formalFile.sheet_names.length,5);
  assert.throws(()=>repository.readFormalPool({poolVersionId:activated.poolVersionId,categoryKey:'foreign',categoryProfileVersion:f.profile.category_profile_version}),error=>error.code==='CATALOG_POOL_SCOPE_MISMATCH');
  assert.deepEqual(fingerprint(f.db),formalBefore);
});

function payload(f,campaignId,sourceId,cards){const pageUrl='https://www.temu.com/de-en/fixture-category-b.html',binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,source_id:sourceId,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',bound_url:pageUrl,bound_at:'2026-09-01T00:00:00.000Z',bound_category:'Fixture Category B',bound_sort:'Top Sales',bound_goods_count:cards.length};binding.context_fingerprint=hash([binding.bound_url,binding.site_country,binding.language,binding.currency,binding.category_key,binding.bound_category,binding.bound_sort]);return{campaign_id:campaignId,source_id:sourceId,batch_id:'export-batch',category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,page_url:pageUrl,page_title:'Fixture',captured_at:'2026-09-01T00:01:00.000Z',page_context:{site_country:'DE',language:'en',currency:'EUR',category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,sort_order:'Top Sales'},capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards:cards.map(row=>({...row,capture_transport:'NETWORK_ENRICHED',network_observed:true,network_endpoint:'/api/poppy/v1/opt',network_observed_at:'2026-09-01T00:00:30.000Z',bound_url:binding.bound_url,bound_at:binding.bound_at,bound_category:binding.bound_category,bound_sort:binding.bound_sort}))};}
function card(id){return{goods_id:id,title:`Mechanical Product ${id}`,href:`https://www.temu.com/de-en/item-g-${id}.html`,image_url:`https://img/${id}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,listing_rank:Number(id),business_eligible:true,reviewable:true};}
function hash(value){let result=2166136261;for(const char of JSON.stringify(value)){result^=char.charCodeAt(0);result=Math.imul(result,16777619);}return(result>>>0).toString(16).padStart(8,'0');}
function fingerprint(db){return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT COUNT(*) count FROM "${name}"`).get().count]));}
