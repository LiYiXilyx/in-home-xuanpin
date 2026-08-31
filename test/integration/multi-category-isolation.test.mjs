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

test('two categories share product identity while memberships, pools, baselines and checkpoints stay isolated',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-two-category-'));
  const databasePath=path.join(directory,'fixture.db');
  migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);
  t.after(() => { db.close();fs.rmSync(directory,{ recursive:true,force:true }); });
  const service=createCatalogCampaignService(db,{ now:sequenceClock() });
  const motorcycle=await loadCategoryProfile(profilePath);
  const pet=secondCategoryProfile(motorcycle);

  const categoryA=runRefresh(service,db,motorcycle,'motorcycle-refresh',[card('9001','Motorcycle shared'),card('9002','Motorcycle only')]);
  const aQueueBefore=service.getRpaQueueForSource(categoryA.source.id);
  const aMembershipsBefore=memberships(db,motorcycle.category_key);

  const categoryB=runRefresh(service,db,pet,'pet-refresh',[card('9001','Pet shared'),card('9003','Pet only')]);

  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM products').get().count),3,'platform + goods_id remains product identity');
  assert.equal(Number(db.prepare(`SELECT COUNT(*) count FROM catalog_memberships m JOIN products p ON p.id=m.product_id
    WHERE p.external_product_id='9001'`).get().count),2,'same product has one membership per category');
  assert.deepEqual(memberships(db,motorcycle.category_key),aMembershipsBefore,'materializing Category B cannot mutate Category A memberships');
  assert.deepEqual(activePoolCategories(db),[motorcycle.category_key,pet.category_key],'activating B cannot deactivate A pool');
  assert.deepEqual(activeMembershipCategories(db),[motorcycle.category_key,pet.category_key],'activating B cannot deactivate A memberships');

  const aBaseline=baselineGoods(db,categoryA.campaign.id);
  const bBaseline=baselineGoods(db,categoryB.campaign.id);
  assert.deepEqual(aBaseline,[]);
  assert.deepEqual(bBaseline,[],'Category B must not inherit Category A active pool as its baseline');
  assert.deepEqual(service.getRpaQueueForSource(categoryA.source.id),aQueueBefore,'Category B work cannot alter Category A checkpoint');
  assert.notEqual(categoryA.campaign.id,categoryB.campaign.id);
});

function runRefresh(service,db,profile,name,cards) {
  const campaign=service.createCampaign({ name,campaignType:'refresh',profile,targetCount:cards.length });
  const source=service.createSource(campaign.id,{ sourceKey:'top-sales',sourceType:'category',sortOrder:'Top Sales',targetQuota:cards.length });
  service.transitionCampaign(campaign.id,'running');
  service.captureBatch({ campaignId:campaign.id,sourceId:source.id,batchId:`${name}-batch`,cards });
  db.prepare("UPDATE catalog_rpa_queue SET status='completed' WHERE campaign_id=?").run(campaign.id);
  db.prepare("UPDATE catalog_sources SET status='completed' WHERE campaign_id=?").run(campaign.id);
  service.materializeRefresh(campaign.id);
  const qa=service.evaluateRefreshQa(campaign.id);
  assert.equal(qa.campaign.qaStatus,'passed');
  const pool=service.activatePoolVersion(campaign.id);
  return { campaign,source,pool };
}

function secondCategoryProfile(base) {
  return {
    ...structuredClone(base),
    category_key:'pet-supplies-fixture',
    category_profile_version:'pet-supplies-fixture-v1',
    display_name:'Pet Supplies Fixture',
    navigation:{ ...structuredClone(base.navigation),breadcrumbs:['Pet Supplies','Pet Supplies Fixture'] },
    membership_scope:{ site_country:'DE',language:'en',currency:'EUR',primary_category:'Pet Supplies',subcategory:'Pet Supplies Fixture',sort_order:'Top Sales' },
    legacy_membership_scopes:[],
    taxonomy_bindings:{
      classify:{ taxonomy_name:'pet-fixture',taxonomy_version:null,rule_version:'pet-rule-v1' },
      fine_classify:{ taxonomy_name:'pet-fine-fixture',taxonomy_version:null,rule_version:'pet-fine-rule-v1' },
      opportunity:{ taxonomy_name:'pet-opportunity-fixture',taxonomy_version:null,rule_version:'pet-opportunity-rule-v1' }
    }
  };
}

function memberships(db,categoryKey) {
  return db.prepare(`SELECT p.external_product_id goods_id,m.category_key,m.active,m.primary_category,m.subcategory,m.campaign_id
    FROM catalog_memberships m JOIN products p ON p.id=m.product_id WHERE m.category_key=? ORDER BY goods_id`).all(categoryKey);
}
function activePoolCategories(db) {
  return db.prepare("SELECT category_key FROM catalog_pool_versions WHERE status='active' ORDER BY category_key").all().map(row => row.category_key);
}
function activeMembershipCategories(db) {
  return db.prepare('SELECT DISTINCT category_key FROM catalog_memberships WHERE active=1 ORDER BY category_key').all().map(row => row.category_key);
}
function baselineGoods(db,campaignId) {
  return db.prepare('SELECT goods_id FROM catalog_campaign_baseline_items WHERE campaign_id=? ORDER BY goods_id').all(campaignId).map(row => row.goods_id);
}
function card(goodsId,title) {
  return { goods_id:goodsId,title,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,
    price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,business_eligible:true,reviewable:true };
}
function sequenceClock() { let tick=0;return () => new Date(Date.UTC(2026,7,31,8,0,tick++)).toISOString(); }
