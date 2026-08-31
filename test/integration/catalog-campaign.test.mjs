import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { createJobRepository } from '../../src/db/repositories/job-repository.mjs';
import { createCatalogCampaignService } from '../../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

const profilePath=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('Catalog Scale Day1 foundation is isolated, idempotent, electronic-safe, and pool-safe',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-scale-'));
  const databasePath=path.join(directory,'catalog-scale.db');
  const first=migrateDatabase({ databasePath });
  const second=migrateDatabase({ databasePath });
  assert.equal(first.applied.at(-1),'025_opportunity_confirmation.sql');
  assert.equal(second.applied.length,0);

  const db=openDatabase(databasePath);
  t.after(() => { db.close();fs.rmSync(directory,{ recursive:true,force:true }); });
  const now=sequenceClock();
  const profile=await loadCategoryProfile(profilePath);
  const baseline=seedBaseline(db,now);
  const before=coreCounts(db);
  const service=createCatalogCampaignService(db,{ now });
  const campaign=service.createCampaign({ name:'catalog-refresh-test',campaignType:'refresh',profile,baselinePoolCount:1 });
  assert.equal(campaign.categoryKey,'motorcycle-accessories');
  assert.equal(campaign.targetGate,'non_electronic_unique_count');

  const sourceA=service.createSource(campaign.id,{ sourceKey:'main-top-sales',sourceType:'category',sortOrder:'Top Sales',targetQuota:3000 });
  const sourceB=service.createSource(campaign.id,{ sourceKey:'tail-bags',sourceType:'product_family',sortOrder:'Top Sales',targetQuota:300 });
  assert.equal(service.getRpaQueueForSource(sourceA.id).status,'pending');
  assert.equal(service.getCampaign(campaign.id).sourceCount,2);
  service.transitionCampaign(campaign.id,'running');

  const firstBatch=service.captureBatch({ campaignId:campaign.id,sourceId:sourceA.id,batchId:'batch-1',cards:[
    card('1001','Waterproof Motorcycle Tail Bag'),
    card('1002','Rechargeable Bluetooth USB LED Headlight'),
    card('1003','Motorcycle Mirror'),
    card('1003','Motorcycle Mirror duplicate card')
  ] });
  assert.equal(firstBatch.idempotentReplay,false);
  assert.equal(firstBatch.campaign.rawObservedCount,4);
  assert.equal(firstBatch.campaign.electronicExcludedCount,1);
  assert.equal(firstBatch.campaign.nonElectronicUniqueCount,2);
  assert.equal(count(db,'catalog_staging_products'),2);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1002'").get().count),0);
  assert.ok(count(db,'catalog_exclusion_observations')>=3);

  const replay=service.captureBatch({ campaignId:campaign.id,sourceId:sourceA.id,batchId:'batch-1',cards:[
    card('1001','Waterproof Motorcycle Tail Bag'),
    card('1002','Rechargeable Bluetooth USB LED Headlight'),
    card('1003','Motorcycle Mirror'),
    card('1003','Motorcycle Mirror duplicate card')
  ] });
  assert.equal(replay.idempotentReplay,true);
  assert.equal(count(db,'catalog_capture_batches'),1);
  assert.equal(count(db,'catalog_staging_products'),2);
  assert.throws(() => service.captureBatch({ campaignId:campaign.id,sourceId:sourceA.id,batchId:'batch-1',cards:[card('9999','Different payload')] }),
    error => error.code==='CATALOG_BATCH_IDEMPOTENCY_CONFLICT');

  service.captureBatch({ campaignId:campaign.id,sourceId:sourceB.id,batchId:'batch-2',cards:[
    card('1001','Same bag from another source'),card('1004','Motorcycle Cover')
  ] });
  assert.equal(count(db,'catalog_staging_products'),3);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1001'").get().count),1);

  service.recordNotSeenInCampaign(campaign.id,[{ productId:baseline.productId,goodsId:baseline.goodsId }]);
  assert.equal(db.prepare('SELECT observation_status AS status FROM catalog_campaign_product_observations WHERE campaign_id=? AND goods_id=?').get(campaign.id,baseline.goodsId).status,'not_seen_in_campaign');
  assert.deepEqual(coreCounts(db),before);

  service.submitQa(campaign.id,{ passed:true,summary:{ fixture:true } });
  assert.throws(() => service.activatePoolVersion(campaign.id),error => error.code==='CATALOG_POOL_SAFETY_REJECTED');
  assert.equal(count(db,'catalog_pool_versions'),0);
  assert.deepEqual(coreCounts(db),before);

  const failed=service.createCampaign({ name:'catalog-failed-test',campaignType:'test',profile,baselinePoolCount:1 });
  service.transitionCampaign(failed.id,'running');
  service.failCampaign(failed.id,{ reason:'fixture failure' });
  assert.throws(() => service.activatePoolVersion(failed.id),error => error.code==='CATALOG_POOL_QA_REQUIRED');
  assert.equal(count(db,'catalog_pool_versions'),0);
  assert.deepEqual(coreCounts(db),before);

  const smallProfile={ ...structuredClone(profile),category_key:'catalog-safe-fixture',category_profile_version:'catalog-safe-fixture-v1',display_name:'Catalog Safe Fixture',target_count:1 };
  const safe=service.createCampaign({ name:'catalog-safe-activation',campaignType:'test',profile:smallProfile,baselinePoolCount:1 });
  const safeSource=service.createSource(safe.id,{ sourceKey:'main',sourceType:'category',sortOrder:'Top Sales' });
  service.transitionCampaign(safe.id,'running');
  service.captureBatch({ campaignId:safe.id,sourceId:safeSource.id,batchId:'safe-batch',cards:[card('7001','Mechanical Crash Bar')] });
  service.submitQa(safe.id,{ passed:true,summary:{ passed:true } });
  const poolVersion=service.activatePoolVersion(safe.id,{ qaSummary:{ passed:true } });
  assert.equal(poolVersion.status,'active');
  assert.equal(poolVersion.nonElectronicUniqueCount,1);
  assert.equal(count(db,'catalog_pool_version_items'),1);
  assert.deepEqual(coreCounts(db),before);

  const secondCategory={ ...structuredClone(profile),category_key:'automotive-exterior',category_profile_version:'automotive-exterior-v1',display_name:'Automotive Exterior' };
  const other=service.createCampaign({ name:'other-category-test',campaignType:'test',profile:secondCategory });
  const otherSource=service.createSource(other.id,{ sourceKey:'main',sourceType:'category',sortOrder:'Top Sales' });
  service.transitionCampaign(other.id,'running');
  service.captureBatch({ campaignId:other.id,sourceId:otherSource.id,batchId:'same-goods',cards:[card('1001','Exterior protective cover')] });
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM catalog_staging_products WHERE goods_id='1001'").get().count),2);
  assert.equal(Number(db.prepare("SELECT COUNT(DISTINCT category_key) AS count FROM catalog_staging_products WHERE goods_id='1001'").get().count),2);
  assert.deepEqual(coreCounts(db),before);
});

function seedBaseline(db,now) {
  const jobs=createJobRepository(db,{ now });
  const job=jobs.createJob({ jobType:'catalog',siteCountry:'德国',language:'en',currency:'EUR',primaryCategory:'Automotive',subcategory:'Motorcycles',sortOrder:'Top Sales',targetCount:1 });
  const timestamp=now();
  const result=db.prepare(`INSERT INTO products(platform,external_product_id,source_url,canonical_url,title,status,first_seen_at,last_seen_at)
    VALUES('temu','9000','https://www.temu.com/old','https://www.temu.com/goods.html?goods_id=9000','Legacy','active',?,?)`).run(timestamp,timestamp);
  db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id)
    VALUES(?,'德国','en','EUR','Automotive','Motorcycles','Top Sales',1,1,?,?,?)`).run(Number(result.lastInsertRowid),timestamp,timestamp,job.id);
  db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title)
    VALUES(?,?,?,?,?)`).run(job.id,Number(result.lastInsertRowid),timestamp,'https://www.temu.com/old','Legacy');
  return { productId:Number(result.lastInsertRowid),goodsId:'9000' };
}
function coreCounts(db) { return { products:count(db,'products'),activeMemberships:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count),snapshots:count(db,'product_snapshots'),reviews:count(db,'reviews') }; }
function count(db,table) { return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); }
function card(goodsId,title) { return { goods_id:goodsId,title,href:`https://www.temu.com/item-g-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12.5,currency:'EUR',sales_count:100,rating:4.8,review_count:20,business_eligible:true,reviewable:true }; }
function sequenceClock() { let tick=0;return () => new Date(Date.UTC(2026,7,26,0,0,tick++)).toISOString(); }
