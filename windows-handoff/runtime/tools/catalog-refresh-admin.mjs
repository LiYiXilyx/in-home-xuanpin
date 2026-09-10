import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createCatalogCampaignService } from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { loadCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';
import { exportCatalogRefreshWorkbook } from '../src/modules/catalog-scale/catalog-refresh-report.mjs';

const { action,options }=parseArgs(process.argv.slice(2));
const config=await loadConfig(options.config ?? 'config.json');
const db=openDatabase(config.app.databasePath);
try {
  const service=createCatalogCampaignService(db);
  if (action==='create') {
    const profilePath=path.resolve(options.profile ?? 'config/categories/motorcycle-accessories.json');
    const profile=await loadCategoryProfile(profilePath);
    const target=positiveInteger(options.target ?? 1000,'target');
    const campaign=service.createCampaign({
      name:options.name ?? `catalog-refresh-${target}-${new Date().toISOString().slice(0,10).replaceAll('-','')}`,
      campaignType:'refresh',profile,targetCount:target,
      browserContext:{ profileName:options['profile-name'] ?? null,profileDirectory:options['profile-directory'] ?? null,
        controlMode:options['control-mode'] ?? 'yingdao_existing_chrome' }
    });
    const source=service.createSource(campaign.id,{ sourceKey:'main-top-sales',sourceType:'category',sortOrder:profile.sort_order,
      targetQuota:target,priority:1,navigationHint:{ entryMethod:'existing_healthy_category_listing',pageUrl:options['source-url'] ?? null } });
    const running=service.transitionCampaign(campaign.id,'running');
    print({ action,campaign:running,source,queue:service.getRpaQueueForSource(source.id) });
  } else {
    const campaignId=required(options.campaign,'campaign');
    if (action==='status') print(service.getStatus(campaignId));
    else if (action==='complete-source') {
      const status=service.getStatus(campaignId);
      if (status.campaign.nonElectronicUniqueCount<status.campaign.targetCount) {
        throw new Error(`Gate未达到：${status.campaign.nonElectronicUniqueCount}/${status.campaign.targetCount}`);
      }
      if (status.queues.length!==1) throw new Error(`要求唯一Queue，实际 ${status.queues.length}`);
      const queue=status.queues[0];
      print(service.completeRpaSource({ queue_id:queue.id,claim_token:queue.claimToken,
        stop_reason:'TARGET_GATE_REACHED',checkpoint:{ ...queue.checkpoint,load_state:'LOAD_MORE_PROGRESS',
          current_unique:status.campaign.nonElectronicUniqueCount,stop_reason:'TARGET_GATE_REACHED' } }));
    }
    else if (action==='materialize') print(service.materializeRefresh(campaignId));
    else if (action==='qa') print(service.evaluateRefreshQa(campaignId));
    else if (action==='activate') print(service.activatePoolVersion(campaignId,{ qaSummary:{ gate:'Scale Day4 Refresh 1000' } }));
    else if (action==='excel') print(await exportCatalogRefreshWorkbook(db,{ campaignId,
      outputDir:path.resolve(options.output ?? `outputs/catalog-refresh-day4-${campaignId.slice(-8)}`) }));
    else throw new Error(`未知操作：${action}`);
  }
} finally {
  db.close();
}

function parseArgs(argv) {
  const [action,...rest]=argv;if (!action) throw new Error('缺少操作：create/status/complete-source/materialize/qa/activate/excel');
  const options={};
  for (let index=0;index<rest.length;index+=1) {
    const token=rest[index];if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key=token.slice(2);const value=rest[index+1];
    if (!value || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值。`);
    options[key]=value;index+=1;
  }
  return { action,options };
}
function required(value,name) { const result=String(value ?? '').trim();if (!result) throw new Error(`缺少 --${name}`);return result; }
function positiveInteger(value,name) { const result=Number(value);if (!Number.isInteger(result) || result<=0) throw new Error(`--${name} 必须是正整数。`);return result; }
function print(value) { console.log(JSON.stringify(value,null,2)); }
