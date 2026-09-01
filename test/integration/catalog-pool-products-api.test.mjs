import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';
import { transaction } from '../../src/db/client.mjs';
import { fixtureCategoryProfile } from '../fixtures/initial-category-pool-fixture.mjs';

test('Pool Products GET returns deterministic Pool-bound evidence with zero database writes',async t=>{
  const fixture=await poolApiFixture(t),before=databaseFingerprint(fixture.app.db);
  const response=await fixture.get(`/api/catalog/pools/${fixture.poolId}/products?category_key=${fixture.categoryKey}&category_profile_version=${fixture.profileVersion}`);
  const body=await response.json();
  assert.equal(response.status,200);assert.deepEqual(body.scope,{pool_version_id:fixture.poolId,category_key:fixture.categoryKey,
    category_profile_version:fixture.profileVersion});
  assert.deepEqual(body.products.map(row=>row.goods_id),['0002','10','2']);
  assert.deepEqual(body.products.map(row=>row.image_status),['OK','MISS','MISS']);
  assert.equal(body.products.every(row=>row.pool_version_id===fixture.poolId&&row.category_key===fixture.categoryKey
    &&row.category_profile_version===fixture.profileVersion),true);
  assert.deepEqual(databaseFingerprint(fixture.app.db),before);
});

test('missing or mismatched Pool scope hard fails with zero writes and no fallback',async t=>{
  const fixture=await poolApiFixture(t);
  for(const [route,status,code] of [
    [`/api/catalog/pools/${fixture.poolId}/products`,400,'CATALOG_POOL_SCOPE_REQUIRED'],
    [`/api/catalog/pools/${fixture.poolId}/products?category_key=other&category_profile_version=${fixture.profileVersion}`,409,'CATALOG_POOL_SCOPE_MISMATCH'],
    [`/api/catalog/pools/missing/products?category_key=${fixture.categoryKey}&category_profile_version=${fixture.profileVersion}`,404,'CATALOG_POOL_NOT_FOUND']
  ]){const before=databaseFingerprint(fixture.app.db),response=await fixture.get(route),body=await response.json();
    assert.equal(response.status,status,route);assert.equal(body.error.code,code,route);assert.deepEqual(databaseFingerprint(fixture.app.db),before,route);}
});

test('Pool Products route is GET only and does not mutate the database',async t=>{
  const fixture=await poolApiFixture(t),before=databaseFingerprint(fixture.app.db);
  const response=await fixture.post(`/api/catalog/pools/${fixture.poolId}/products`,{});
  assert.equal(response.status,404);assert.deepEqual(databaseFingerprint(fixture.app.db),before);
});

async function poolApiFixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-pool-read-api-')),profileDirectory=path.join(directory,'categories');
  fs.mkdirSync(profileDirectory);const profile=fixtureCategoryProfile();fs.writeFileSync(path.join(profileDirectory,'profile.json'),JSON.stringify(profile));
  const config={app:{environment:'development',databasePath:path.join(directory,'fixture.db')},browser:{mode:'external_cdp',
    profileDir:path.join(directory,'profile'),debugPort:9237,heartbeatTimeoutMs:30_000},catalog:{siteCountry:'德国',language:'en',currency:'EUR',jobs:[]},
    reviews:{},export:{outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images')}};
  const app=await createOperationsServer({config,categoryProfileDirectory:profileDirectory,runProcess:()=>{},openTarget:async()=>{},logError:()=>{},
    browserDependencies:{ready:async()=>true,openSession:async()=>({context:{}}),connectSession:async()=>({context:{}}),currentPage:async()=>({}),
      inspectPage:async()=>({status:'READY',code:'READY',checks:{}})}});
  t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true});});
  const address=await app.listen({port:0}),request=(route,options)=>fetch(`${address.url}${route}`,options);
  const created=await (await request('/api/catalog/operator/initial-campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    category_key:profile.category_key,category_profile_version:profile.category_profile_version,campaign_name:'Pool reader fixture',request_id:'create-reader'})})).json();
  const campaignId=created.result.campaign_id,poolId='pool-category-b-read';seedPool(app,campaignId,poolId,profile);
  return{app,poolId,categoryKey:profile.category_key,profileVersion:profile.category_profile_version,
    get:route=>request(route),post:(route,body)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
}

function seedPool(app,campaignId,poolId,profile){
  const context=app.catalogService.currentOperatorManualContext(),pageUrl='https://www.temu.com/de-en/fixture-category-b.html';
  const binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,source_id:context.source.id,
    category_key:profile.category_key,category_profile_version:profile.category_profile_version,site_country:'DE',language:'en',currency:'EUR',
    sort_order:'Top Sales',bound_url:pageUrl,bound_at:'2026-09-01T00:00:00.000Z',bound_category:'Fixture Category B',bound_sort:'Top Sales',bound_goods_count:3};
  binding.context_fingerprint=bindingFingerprint([binding.bound_url,binding.site_country,binding.language,binding.currency,
    binding.category_key,binding.bound_category,binding.bound_sort]);
  const cards=['2','0002','10'].map((goodsId,index)=>({goods_id:goodsId,title:`Title ${goodsId}`,
    href:`https://www.temu.com/de-en/item-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',
    sales_count:100,rating:4.8,review_count:20,listing_rank:index+1,business_eligible:true,reviewable:true,
    capture_transport:'NETWORK_ENRICHED',network_observed:true,network_endpoint:'/api/poppy/v1/opt',
    network_observed_at:'2026-09-01T00:00:00.000Z',bound_url:binding.bound_url,bound_at:binding.bound_at,
    bound_category:binding.bound_category,bound_sort:binding.bound_sort}));
  app.catalogService.captureExtensionBatch({campaign_id:campaignId,source_id:context.source.id,batch_id:'reader-batch',
    category_key:profile.category_key,category_profile_version:profile.category_profile_version,page_url:pageUrl,page_title:'Fixture Category B',
    captured_at:'2026-09-01T00:00:01.000Z',page_context:{site_country:'DE',language:'en',currency:'EUR',category_key:profile.category_key,
      category_profile_version:profile.category_profile_version,sort_order:'Top Sales'},capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards});
  transaction(app.db,()=>{
    const at='2026-09-01T00:00:00.000Z';app.db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,
      product_count,non_electronic_unique_count,status,created_at,updated_at) VALUES(?,?,?,?,3,3,'active',?,?)`)
      .run(poolId,campaignId,profile.category_key,profile.category_profile_version,at,at);
    const staging=app.db.prepare('SELECT id,platform,goods_id,image_url,canonical_url,latest_title FROM catalog_staging_products WHERE campaign_id=?').all(campaignId);
    for(const row of staging){app.db.prepare(`INSERT INTO catalog_pool_version_items(pool_version_id,staging_product_id,platform,goods_id,category_key,created_at)
      VALUES(?,?,?,?,?,?)`).run(poolId,row.id,row.platform,row.goods_id,profile.category_key,at);
      const inserted=app.db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at)
        VALUES(?,?,?,?,?,?)`).run(row.platform,row.goods_id,row.canonical_url,row.latest_title,at,at);
      if(row.goods_id==='0002')app.db.prepare(`INSERT INTO product_images(product_id,image_kind,source_url,local_path,status,download_status,created_at,updated_at)
        VALUES(?,'main',?,?,'downloaded','completed',?,?)`).run(Number(inserted.lastInsertRowid),row.image_url,'/tmp/0002.jpg',at,at);
    }
  });
}

function bindingFingerprint(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return(hash>>>0).toString(16).padStart(8,'0');}

function databaseFingerprint(db){
  const tables=db.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(row=>row.name);
  return Object.fromEntries(tables.map(table=>{const rows=db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all()
    .map(row=>JSON.stringify(row,Object.keys(row).sort())).sort();return[table,rows];}));
}
