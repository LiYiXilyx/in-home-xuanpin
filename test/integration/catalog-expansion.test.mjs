import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { createCatalogCampaignService } from '../../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { buildCatalogExpansionReportModel } from '../../src/modules/catalog-scale/catalog-expansion-report.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

const profilePath=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('Scale Day5 expansion carries the active 1000 baseline forward, adds only net-new goods, snapshots new items, and safely activates 1500',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-catalog-expansion-'));const databasePath=path.join(directory,'expansion.db');
  migrateDatabase({ databasePath });const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const now=sequenceClock();const profile=await loadCategoryProfile(profilePath);const service=createCatalogCampaignService(db,{ now });
  const baselineCampaign=service.createCampaign({ name:'baseline',campaignType:'refresh',profile,targetCount:2 });
  const baselineSource=service.createSource(baselineCampaign.id,{ sourceKey:'baseline-source',sourceType:'category',sortOrder:'Top Sales',targetQuota:2 });
  service.transitionCampaign(baselineCampaign.id,'running');const baselineClaim=service.claimNextSource(baselineCampaign.id);
  service.captureBatch({ campaignId:baselineCampaign.id,sourceId:baselineSource.id,batchId:'baseline-batch',cards:[card('1001'),card('1002')] });
  service.completeRpaSource({ queue_id:baselineClaim.queue.id,claim_token:baselineClaim.queue.claimToken,stop_reason:'TARGET_GATE_REACHED',checkpoint:{ load_state:'LOAD_MORE_PROGRESS',new_goods_count:2 } });
  service.materializeRefresh(baselineCampaign.id);service.evaluateRefreshQa(baselineCampaign.id);const oldPool=service.activatePoolVersion(baselineCampaign.id);
  const legacyStagingId=db.prepare('SELECT staging_product_id FROM catalog_pool_version_items WHERE pool_version_id=? AND goods_id=?').get(oldPool.id,'1001').staging_product_id;
  db.prepare("UPDATE catalog_staging_products SET platform='temu_de' WHERE id=?").run(legacyStagingId);
  db.prepare('UPDATE catalog_memberships SET active=1').run();

  const expansion=service.createCampaign({ name:'day5-expansion',campaignType:'expansion',profile,targetCount:4,baselinePoolCount:2,
    browserContext:{ profileName:'T',profileDirectory:'Default',controlMode:'yingdao_existing_chrome' } });
  assert.equal(expansion.baselinePoolCount,2);assert.equal(expansion.nonElectronicUniqueCount,0);
  const main=service.createSource(expansion.id,{ sourceKey:'main',sourceType:'category',sortOrder:'Top Sales',priority:1,targetQuota:2 });
  const covers=service.createSource(expansion.id,{ sourceKey:'covers',sourceType:'product_family',sortOrder:'Top Sales',priority:2,targetQuota:2 });
  const unused=service.createSource(expansion.id,{ sourceKey:'unused',sourceType:'product_family',sortOrder:'Top Sales',priority:3,targetQuota:1 });
  service.transitionCampaign(expansion.id,'running');assert.equal(service.getCampaign(expansion.id).nonElectronicUniqueCount,2);
  const first=service.claimNextSource(expansion.id);assert.equal(first.source.id,main.id);
  service.captureBatch({ campaignId:expansion.id,sourceId:main.id,batchId:'main-1',cards:[card('1001'),card('2001'),card('9001','Bluetooth helmet headset')] });
  let status=service.getStatus(expansion.id);assert.equal(status.campaign.nonElectronicUniqueCount,3);
  assert.equal(status.expansionComparison.baselineOverlapCount,1);assert.equal(status.expansionComparison.newNonElectronicCount,1);
  service.completeRpaSource({ queue_id:first.queue.id,claim_token:first.queue.claimToken,stop_reason:'SOURCE_EXHAUSTED',checkpoint:{ load_state:'LOAD_MORE_PROGRESS',new_goods_count:1 } });
  const second=service.claimNextSource(expansion.id);assert.equal(second.source.id,covers.id);
  service.captureBatch({ campaignId:expansion.id,sourceId:covers.id,batchId:'covers-1',cards:[card('2001'),card('2002'),card('2003')] });
  status=service.getStatus(expansion.id);assert.equal(status.campaign.nonElectronicUniqueCount,4);
  const completed=service.completeRpaSource({ queue_id:second.queue.id,claim_token:second.queue.claimToken,stop_reason:'TARGET_GATE_REACHED',checkpoint:{ load_state:'LOAD_MORE_PROGRESS',new_goods_count:1 } });
  assert.equal(completed.skippedPendingSources,1);assert.equal(service.getStatus(expansion.id).queues.find(q=>q.sourceId===unused.id).status,'completed');

  // A goods_id can legitimately repeat across platforms because catalog identity is platform + goods_id.
  db.prepare("UPDATE catalog_staging_products SET platform='temu_de',goods_id='1001' WHERE campaign_id=? AND goods_id='2001'").run(expansion.id);
  const before=counts(db);const materialized=service.materializeExpansion(expansion.id);
  assert.equal(materialized.newUniqueCount,2);assert.equal(materialized.snapshotsInserted,2);assert.equal(materialized.reviewsBefore,materialized.reviewsAfter);
  const baselineStaging=db.prepare(`SELECT s.id,s.latest_title FROM catalog_pool_versions v
    JOIN catalog_pool_version_items i ON i.pool_version_id=v.id JOIN catalog_staging_products s ON s.id=i.staging_product_id
    WHERE v.status='active' ORDER BY s.id LIMIT 1`).get();
  db.prepare('UPDATE catalog_staging_products SET latest_title=NULL WHERE id=?').run(baselineStaging.id);
  const failedQa=service.evaluateExpansionQa(expansion.id);assert.equal(failedQa.campaign.qaStatus,'failed');
  db.prepare('UPDATE catalog_staging_products SET latest_title=? WHERE id=?').run(baselineStaging.latest_title,baselineStaging.id);
  const qa=service.evaluateExpansionQa(expansion.id);assert.equal(qa.campaign.qaStatus,'passed');assert.equal(qa.comparison.activeCandidateCount,4);
  const pool=service.activatePoolVersion(expansion.id,{ qaSummary:{ day5:true } });assert.equal(pool.productCount,4);assert.equal(pool.status,'active');
  assert.equal(db.prepare('SELECT status FROM catalog_pool_versions WHERE id=?').get(oldPool.id).status,'superseded');
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM catalog_pool_version_items WHERE pool_version_id=?').get(pool.id).count),4);
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM catalog_memberships WHERE active=1').get().count),4);
  assert.equal(Number(db.prepare(`SELECT COUNT(*) count FROM catalog_pool_version_items i JOIN catalog_exclusion_observations e
    ON e.goods_id=i.goods_id AND e.campaign_id=? WHERE i.pool_version_id=?`).get(expansion.id,pool.id).count),0);
  const report=buildCatalogExpansionReportModel(db,expansion.id);assert.equal(report.currentPool.length,4);assert.equal(report.newItems.length,2);
  assert.equal(report.sqliteReconciliation.campaignNonElectronic,4);assert.equal(report.status.sourceContributions[0].electronicExcludedCount,1);
  const after=counts(db);assert.equal(after.products,before.products+2);assert.equal(after.snapshots,before.snapshots+2);assert.equal(after.reviews,before.reviews);
});

function card(goodsId,title='Mechanical motorcycle cover'){return { goods_id:goodsId,title,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,business_eligible:true,reviewable:true };}
function counts(db){return { products:Number(db.prepare('SELECT COUNT(*) count FROM products').get().count),snapshots:Number(db.prepare('SELECT COUNT(*) count FROM product_snapshots').get().count),reviews:Number(db.prepare('SELECT COUNT(*) count FROM reviews').get().count) };}
function sequenceClock(){let tick=0;return ()=>new Date(Date.UTC(2026,7,27,8,0,tick++)).toISOString();}
