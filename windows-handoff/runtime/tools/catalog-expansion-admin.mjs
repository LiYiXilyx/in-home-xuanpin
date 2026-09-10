import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createCatalogCampaignService } from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { loadCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';
import { validateResumeCampaign } from '../src/modules/catalog-scale/campaign-selection.mjs';
import { exportCatalogExpansionWorkbook } from '../src/modules/catalog-scale/catalog-expansion-report.mjs';

const SOURCES=Object.freeze([
  { sourceKey:'main-top-sales',sourceType:'category',priority:1,targetQuota:500,label:'Motorcycle Accessories / Top Sales',entry:'category_top_sales' },
  { sourceKey:'motorcycle-covers',sourceType:'product_family',priority:2,targetQuota:150,label:'整车防护罩',keyword:'motorcycle cover' },
  { sourceKey:'handlebar-accessories',sourceType:'product_family',priority:3,targetQuota:150,label:'车把与横把附件',keyword:'motorcycle handlebar accessories' },
  { sourceKey:'exhaust-system-parts',sourceType:'product_family',priority:4,targetQuota:150,label:'排气系统部件',keyword:'motorcycle exhaust parts' },
  { sourceKey:'tail-rear-seat-bags',sourceType:'product_family',priority:5,targetQuota:150,label:'尾包与后座包',keyword:'motorcycle tail rear seat bag' },
  { sourceKey:'storage-tail-bags',sourceType:'product_family',priority:6,targetQuota:150,label:'收纳/尾包',keyword:'motorcycle storage tail bag' },
  { sourceKey:'other-non-electronic-subcategories',sourceType:'product_family',priority:7,targetQuota:200,label:'其他非电子细分类',keyword:'motorcycle non electronic accessories' }
]);

const { action,options }=parseArgs(process.argv.slice(2));
const config=await loadConfig(options.config ?? 'config.json');const db=openDatabase(config.app.databasePath);
try {
  const service=createCatalogCampaignService(db);
  if (action==='baseline-check') {
    const profile=await loadCategoryProfile(path.resolve(options.profile ?? 'config/categories/motorcycle-accessories.json'));
    print(service.getBaselineConsistency(profile.category_key));
  } else if (action==='reconcile-memberships') {
    if (options.confirm!=='ACTIVE_POOL_VERSION') throw new Error('reconcile-memberships要求 --confirm ACTIVE_POOL_VERSION。');
    const profile=await loadCategoryProfile(path.resolve(options.profile ?? 'config/categories/motorcycle-accessories.json'));
    print(service.reconcileActiveMembershipsToPool(profile.category_key));
  } else if (action==='create') {
    const target=positiveInteger(options.target ?? 1500,'target');const expectedBaseline=positiveInteger(options.baseline ?? 1000,'baseline');
    const quotaScale=Math.max(1,(target-expectedBaseline)/500);
    const profile=await loadCategoryProfile(path.resolve(options.profile ?? 'config/categories/motorcycle-accessories.json'));
    if (options['resume-campaign']) { const campaign=validateResumeCampaign(service,{campaignId:options['resume-campaign'],profile,campaignType:'expansion'});print({action:'resume',campaign}); }
    else {
    const baseline=service.getBaselineConsistency(profile.category_key);
    if (!baseline.activePoolVersionExists || baseline.activePoolVersionCount!==expectedBaseline || !baseline.consistent) {
      const error=new Error(`Day5 baseline不一致：pool=${baseline.activePoolVersionCount}, memberships=${baseline.activeMembershipCount}, intersection=${baseline.intersectionCount}, expected=${expectedBaseline}`);
      error.code='CATALOG_BASELINE_INCONSISTENT';throw error;
    }
    const campaign=service.createCampaign({ id:options['campaign-id'] ?? null,name:options.name ?? `catalog-expansion-${target}-${new Date().toISOString().slice(0,10).replaceAll('-','')}`,
      campaignType:'expansion',profile,targetCount:target,baselinePoolCount:expectedBaseline,browserContext:{
        profileName:options['profile-name'] ?? 'T',profileDirectory:options['profile-directory'] ?? 'Default',
        controlMode:options['control-mode'] ?? 'yingdao_existing_chrome' } });
    if (campaign.baselinePoolCount!==expectedBaseline) throw new Error(`冻结baseline失败：${campaign.baselinePoolCount}/${expectedBaseline}`);
    const sources=SOURCES.map(item => service.createSource(campaign.id,{ sourceKey:item.sourceKey,sourceType:item.sourceType,
      sortOrder:profile.sort_order,priority:item.priority,targetQuota:Math.ceil(item.targetQuota*quotaScale),searchKeyword:item.keyword,
      navigationHint:{ label:item.label,entryMethod:item.entry ?? 'manual_product_family_navigation',searchKeyword:item.keyword ?? null } }));
    print({ action,campaign:service.transitionCampaign(campaign.id,'running'),baseline,sources,
      next:'运行 claim，然后用影刀把健康Chrome导航到返回Source并确认Top Sales。' });
    }
  } else {
    const campaignId=required(options.campaign,'campaign');
    if (action==='status') print(service.getStatus(campaignId));
    else if (action==='browser-context') print(service.updateBrowserContext(campaignId,{
      profileName:options['profile-name'] ?? 'T',profileDirectory:options['profile-directory'] ?? 'Default',
      controlMode:required(options['control-mode'],'control-mode')
    }));
    else if (action==='claim') print(service.claimNextSource(campaignId));
    else if (action==='complete-source') {
      const status=service.getStatus(campaignId);const queue=status.queues.find(item => ['opening','waiting_page_ready','capturing','waiting_load_more'].includes(item.status));
      if (!queue) throw new Error('没有可完成的active source queue。');
      const reason=options.reason ?? (status.campaign.nonElectronicUniqueCount>=status.campaign.targetCount?'TARGET_GATE_REACHED':'SOURCE_EXHAUSTED');
      print(service.completeRpaSource({ queue_id:queue.id,claim_token:queue.claimToken,stop_reason:reason,
        checkpoint:{ ...queue.checkpoint,stop_reason:reason,current_unique:status.campaign.nonElectronicUniqueCount } }));
    }
    else if (action==='materialize') print(service.materializeExpansion(campaignId));
    else if (action==='checkpoint') print(service.recordExpansionCheckpoint(campaignId,positiveInteger(required(options.milestone,'milestone'),'milestone')));
    else if (action==='qa') print(service.evaluateExpansionQa(campaignId));
    else if (action==='activate') { const campaign=service.getCampaign(campaignId);print(service.activatePoolVersion(campaignId,{ qaSummary:{ gate:`Catalog Expansion ${campaign.targetCount}` } })); }
    else if (action==='excel') print(await exportCatalogExpansionWorkbook(db,{ campaignId,
      outputDir:path.resolve(options.output ?? `outputs/catalog-expansion-${service.getCampaign(campaignId).targetCount}-${campaignId.slice(-8)}`) }));
    else throw new Error(`未知操作：${action}`);
  }
} finally { db.close(); }

function parseArgs(argv) { const [action,...rest]=argv;if(!action)throw new Error('缺少操作：baseline-check/reconcile-memberships/create/status/browser-context/claim/complete-source/checkpoint/materialize/qa/activate/excel');const options={};for(let i=0;i<rest.length;i+=1){const token=rest[i];if(!token.startsWith('--'))throw new Error(`无法识别参数：${token}`);const key=token.slice(2);const value=rest[i+1];if(!value||value.startsWith('--'))throw new Error(`参数 --${key} 缺少值。`);options[key]=value;i+=1;}return { action,options }; }
function required(value,name){const result=String(value??'').trim();if(!result)throw new Error(`缺少 --${name}`);return result;}
function positiveInteger(value,name){const result=Number(value);if(!Number.isInteger(result)||result<=0)throw new Error(`--${name} 必须是正整数。`);return result;}
function print(value){console.log(JSON.stringify(value,null,2));}
