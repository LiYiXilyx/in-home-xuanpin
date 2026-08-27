import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createCatalogCampaignService } from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { loadCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';

const options=parseArgs(process.argv.slice(2));
const sourcePath=path.resolve(required(options.source,'source'));
const campaignId=required(options.campaign,'campaign');
const config=await loadConfig(options.config ?? 'config.json');
const targetDb=openDatabase(config.app.databasePath);const sourceDb=openDatabase(sourcePath,{ readOnly:true });
try {
  const sourceCampaign=sourceDb.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(campaignId);
  if (!sourceCampaign) throw new Error(`恢复源中不存在Campaign：${campaignId}`);
  if (targetDb.prepare('SELECT 1 FROM catalog_campaigns WHERE id=?').get(campaignId)) throw new Error(`目标数据库已存在Campaign：${campaignId}`);
  const profile=await loadCategoryProfile(path.resolve(options.profile ?? 'config/categories/motorcycle-accessories.json'));
  const service=createCatalogCampaignService(targetDb);
  const consistency=service.getBaselineConsistency(profile.category_key);
  if (!consistency.consistent || consistency.activePoolVersionCount!==Number(sourceCampaign.baseline_pool_count)) {
    const error=new Error(`重放前baseline不一致：pool=${consistency.activePoolVersionCount}, memberships=${consistency.activeMembershipCount}, intersection=${consistency.intersectionCount}`);
    error.code='CATALOG_BASELINE_INCONSISTENT';throw error;
  }
  const campaign=service.createCampaign({ id:campaignId,name:sourceCampaign.name,campaignType:'expansion',profile,
    baselinePoolCount:Number(sourceCampaign.baseline_pool_count),targetCount:Number(sourceCampaign.target_count),browserContext:{
      profileName:sourceCampaign.browser_profile_name,profileDirectory:sourceCampaign.browser_profile_directory,
      controlMode:sourceCampaign.browser_control_mode
    } });
  const sourceRows=sourceDb.prepare('SELECT * FROM catalog_sources WHERE campaign_id=? ORDER BY priority,id').all(campaignId);
  const createdSources=new Map();
  for (const row of sourceRows) {
    const created=service.createSource(campaign.id,{ id:row.id,sourceKey:row.source_key,sourceType:row.source_type,
      level2:row.level2,level3:row.level3,searchKeyword:row.search_keyword,navigationHint:parseJson(row.navigation_hint_json) ?? {},
      sortOrder:row.sort_order,priority:Number(row.priority),targetQuota:row.target_quota===null?null:Number(row.target_quota) });
    createdSources.set(created.id,created);
  }
  service.transitionCampaign(campaign.id,'running');
  const staging=sourceDb.prepare('SELECT * FROM catalog_staging_products WHERE campaign_id=? ORDER BY first_seen_sequence,id').all(campaignId);
  const exclusions=sourceDb.prepare(`SELECT e.* FROM catalog_exclusion_observations e WHERE e.campaign_id=? AND e.id=(
    SELECT MIN(e2.id) FROM catalog_exclusion_observations e2 WHERE e2.campaign_id=e.campaign_id AND e2.goods_id=e.goods_id
  ) ORDER BY e.id`).all(campaignId);
  let replayedCards=0;let replayedBatches=0;
  for (const source of createdSources.values()) {
    const cards=[...staging.filter(row=>row.first_source_id===source.id).map(stagingCard),
      ...exclusions.filter(row=>row.source_id===source.id).map(exclusionCard)];
    for (let offset=0;offset<cards.length;offset+=400) {
      const chunk=cards.slice(offset,offset+400);replayedBatches+=1;replayedCards+=chunk.length;
      service.captureBatch({ campaignId:campaign.id,sourceId:source.id,
        batchId:`recovery-replay-${String(replayedBatches).padStart(3,'0')}`,pageUrl:'https://www.temu.com/de-en/motorcycles--accessories-o3-585.html',
        pageTitle:'Day5 baseline recovery replay',capturedAt:new Date().toISOString(),cards:chunk });
    }
  }
  const status=service.getStatus(campaign.id);
  console.log(JSON.stringify({ campaign:status.campaign,baselineAudit:service.getBaselineAudit(campaign.id),
    sourceDatabase:sourcePath,originalRawObservedCount:Number(sourceCampaign.raw_observed_count),
    replayedBatches,replayedCards,trueNetNew:status.expansionComparison.newNonElectronicCount,
    baselineOverlap:status.expansionComparison.baselineOverlapCount,
    remainingToTarget:Math.max(0,status.campaign.targetCount-status.campaign.nonElectronicUniqueCount)
  },null,2));
} finally { sourceDb.close();targetDb.close(); }

function stagingCard(row) {
  const raw=parseJson(row.raw_json) ?? {};
  return { ...raw,goods_id:row.goods_id,title:row.latest_title,href:row.latest_source_url ?? row.canonical_url,
    image_url:row.image_url,price_amount:row.price_amount,currency:row.currency,sales_count:row.sales_count,
    rating:row.rating,review_count:row.review_count,listing_rank:Number(row.first_seen_sequence) };
}
function exclusionCard(row) { return { goods_id:row.goods_id,title:row.title,
  href:`https://www.temu.com/goods.html?goods_id=${row.goods_id}`,raw_card_text:row.title }; }
function parseJson(value){try{return value?JSON.parse(value):null;}catch{return null;}}
function parseArgs(argv){const result={};for(let index=0;index<argv.length;index+=1){const token=argv[index];if(!token.startsWith('--'))throw new Error(`无法识别参数：${token}`);const value=argv[index+1];if(!value||value.startsWith('--'))throw new Error(`${token} 缺少值。`);result[token.slice(2)]=value;index+=1;}return result;}
function required(value,name){const result=String(value??'').trim();if(!result)throw new Error(`缺少 --${name}`);return result;}
