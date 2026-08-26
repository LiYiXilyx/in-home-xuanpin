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
import { buildCatalogRefreshReportModel } from '../../src/modules/catalog-scale/catalog-refresh-report.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

const profilePath=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('Scale Day4 refresh freezes old pool, adds exact snapshots, preserves not-seen memberships, and activates an auditable pool version',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-refresh-'));
  const databasePath=path.join(directory,'refresh.db');migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);t.after(() => { db.close();fs.rmSync(directory,{ recursive:true,force:true }); });
  const now=sequenceClock();seedBaseline(db,now,['1001','1002']);
  const before=counts(db);const profile=await loadCategoryProfile(profilePath);
  const service=createCatalogCampaignService(db,{ now });
  const campaign=service.createCampaign({ name:'day4-refresh-fixture',campaignType:'refresh',profile,targetCount:2,
    browserContext:{ profileName:'Temu1店',profileDirectory:'Profile 10',controlMode:'yingdao_existing_chrome' } });
  assert.equal(campaign.baselinePoolCount,2);
  assert.equal(campaign.browserControlMode,'yingdao_existing_chrome');
  const source=service.createSource(campaign.id,{ sourceKey:'main-top-sales',sourceType:'category',sortOrder:'Top Sales',targetQuota:2 });
  service.transitionCampaign(campaign.id,'running');
  service.captureBatch({ campaignId:campaign.id,sourceId:source.id,batchId:'refresh-1',cards:[
    card('1001','Refreshed legacy product'),card('3001','New mechanical product'),card('3002','Overflow product')
  ] });
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_staging_products WHERE campaign_id=?').get(campaign.id).count),2);
  db.prepare("UPDATE catalog_rpa_queue SET status='completed' WHERE campaign_id=?").run(campaign.id);
  db.prepare("UPDATE catalog_sources SET status='completed' WHERE campaign_id=?").run(campaign.id);
  service.recordNavigationRisk(campaign.id,{ goodsId:'1001',historicalUrlStatus:'sold_out',freshNavigationStatus:'recovered',categoryCardAvailable:true });
  const materialization=service.materializeRefresh(campaign.id);
  assert.equal(materialization.snapshotsInserted,2);
  assert.equal(materialization.productsInserted,1);
  assert.equal(materialization.reviewsBefore,materialization.reviewsAfter);
  assert.equal(counts(db).activeMemberships,before.activeMemberships);
  assert.equal(db.prepare(`SELECT observation_status AS status FROM catalog_campaign_product_observations
    WHERE campaign_id=? AND goods_id='1002'`).get(campaign.id).status,'not_seen_in_campaign');

  const result=service.evaluateRefreshQa(campaign.id);
  assert.equal(result.campaign.status,'completed');assert.equal(result.campaign.qaStatus,'passed');
  assert.equal(result.comparison.old_active_count,2);assert.equal(result.comparison.new_observed_unique_count,2);
  assert.equal(result.comparison.intersection_count,1);assert.equal(result.comparison.new_goods_count,1);
  assert.equal(result.comparison.not_seen_count,1);assert.equal(result.navigation.historical_url_sold_out_count,1);
  assert.equal(result.navigation.fresh_navigation_recovered_count,1);
  const pool=service.activatePoolVersion(campaign.id,{ qaSummary:{ day4:true } });
  assert.equal(pool.status,'active');assert.equal(pool.productCount,2);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_pool_version_items WHERE pool_version_id=?').get(pool.id).count),2);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_pool_activation_history WHERE new_pool_version_id=?').get(pool.id).count),1);
  const report=buildCatalogRefreshReportModel(db,campaign.id);
  assert.deepEqual(report.rowCounts,{ currentPool:2,staging:2,exclusions:0,reconciliation:3,sources:1 });
  assert.deepEqual(report.sqliteReconciliation,{ poolItems:2,passedStaging:2,campaignNonElectronic:2,uniqueExcluded:0 });
  const after=counts(db);assert.equal(after.products,before.products+1);assert.equal(after.snapshots,before.snapshots+2);
  assert.equal(after.reviews,before.reviews);assert.equal(after.activeMemberships,before.activeMemberships);
});

function seedBaseline(db,now,goodsIds) {
  const jobs=createJobRepository(db,{ now });
  const job=jobs.createJob({ jobType:'catalog',siteCountry:'DE',language:'en',currency:'EUR',primaryCategory:'Automotive',subcategory:'Motorcycle Accessories',sortOrder:'Top Sales',targetCount:goodsIds.length });
  for (const [index,goodsId] of goodsIds.entries()) {
    const timestamp=now();
    const product=db.prepare(`INSERT INTO products(platform,external_product_id,source_url,canonical_url,title,status,first_seen_at,last_seen_at)
      VALUES('temu',?,?,?,'Legacy mechanical product','active',?,?)`).run(goodsId,`https://www.temu.com/old-${goodsId}`,`https://www.temu.com/goods.html?goods_id=${goodsId}`,timestamp,timestamp);
    db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,source_page_url,
      sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id) VALUES(?,'DE','en','EUR','Automotive','Motorcycle Accessories',
      ?,'Top Sales',?,1,?,?,?)`).run(Number(product.lastInsertRowid),`https://www.temu.com/old-${goodsId}`,index+1,timestamp,timestamp,job.id);
    db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title)
      VALUES(?,?,?,?,?)`).run(job.id,Number(product.lastInsertRowid),timestamp,`https://www.temu.com/old-${goodsId}`,'Legacy mechanical product');
  }
}
function card(goodsId,title) { return { goods_id:goodsId,title,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,
  image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,
  business_eligible:true,reviewable:true }; }
function counts(db) { return { products:Number(db.prepare('SELECT COUNT(*) AS count FROM products').get().count),
  activeMemberships:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count),
  snapshots:Number(db.prepare('SELECT COUNT(*) AS count FROM product_snapshots').get().count),
  reviews:Number(db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count) }; }
function sequenceClock() { let tick=0;return () => new Date(Date.UTC(2026,7,26,8,0,tick++)).toISOString(); }
