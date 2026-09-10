import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createCatalogCampaignService } from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { buildFullRefreshReport,formalCatalogState } from '../src/modules/catalog-scale/catalog-full-refresh-report.mjs';
import { loadCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';
import { validateResumeCampaign } from '../src/modules/catalog-scale/campaign-selection.mjs';

const MODE='FULL_REFRESH_EXTENSION_AUTO';
const PROFILE_NAME='Temu1店';
const PROFILE_DIRECTORY='Profile 10';
const {action,options}=parseArgs(process.argv.slice(2));
const config=await loadConfig(options.config??'config.json');
const db=openDatabase(config.app.databasePath);
try {
  const service=createCatalogCampaignService(db);
  if(action==='create-smoke')print(await create(service,50));
  else if(action==='create-full')print(await create(service,2000));
  else {
    const campaignId=required(options.campaign,'campaign');
    if(action==='status')print(status(service,campaignId));
    else if(action==='record-sales-sample')print(recordSalesSample(service,campaignId,required(options.sample,'sample')));
    else if(action==='complete-source')print(completeSource(service,campaignId));
    else if(action==='materialize')print({action,materialization:service.materializeRefresh(campaignId),...status(service,campaignId)});
    else if(action==='qa')print(runQa(service,campaignId));
    else if(action==='report')print(buildFullRefreshReport(db,campaignId));
    else throw new Error(`未知操作：${action}`);
  }
} finally { db.close(); }

async function create(service,target){
  if(target===2000)assertSmokePassed();
  const profile=await loadCategoryProfile(path.resolve(options.profile??'config/categories/motorcycle-accessories.json'));
  if(options['resume-campaign']) { const campaign=validateResumeCampaign(service,{campaignId:options['resume-campaign'],profile,campaignType:'refresh'});return {action:'resume',...status(service,campaign.id)}; }
  const conflicting=db.prepare(`SELECT id,name,status,browser_control_mode FROM catalog_campaigns
    WHERE status IN ('running','manual_required') ORDER BY created_at DESC LIMIT 1`).get();
  if(conflicting)throw coded('CATALOG_CAMPAIGN_CONFLICT',`已有运行中的 Catalog Campaign：${conflicting.id} / ${conflicting.status}`);
  const before=formalCatalogState(db);
  let campaign=service.createCampaign({name:`FULL_REFRESH_${target}_${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`,
    campaignType:'refresh',profile,targetCount:target,browserContext:{profileName:PROFILE_NAME,profileDirectory:PROFILE_DIRECTORY,controlMode:MODE}});
  const source=service.createSource(campaign.id,{sourceKey:'fixed-profile-top-sales',sourceType:'category',sortOrder:profile.sort_order,targetQuota:target,priority:1,
    navigationHint:{entryMethod:'existing_healthy_category_listing',automaticNavigation:false,automaticScroll:true,automaticSeeMore:true,
      cdpRequired:false,extensionPassive:true,localServerEndpoint:'http://127.0.0.1:37821'}});
  campaign=service.transitionCampaign(campaign.id,'running');const claimed=service.claimNextSource(campaign.id);
  if(claimed.idle)throw coded('CATALOG_RPA_NOT_CLAIMED','Full Refresh source未能领取。');
  service.saveExtensionCheckpoint({campaign_id:campaign.id,source_id:source.id,queue_id:claimed.queue.id,status:'capturing',checkpoint:{
    runner_state:'IDLE',runner_mode:'campaign_gate',campaign_mode:MODE,session_target:target,refreshed_unique:0,
    sales_parse_required:true,raw_sales_evidence_required:true,manual_sales_sample_status:'PENDING',manual_sales_sample:[],
    automatic_navigation:false,automatic_scroll:true,automatic_see_more:true,automatic_try_again:false,direct_api:false,
    cdp_required:false,extension_required:true,local_server_endpoint:'http://127.0.0.1:37821',formal_state_before:before }});
  return {action:'created',...status(service,campaign.id)};
}

function status(service,campaignId){
  const value=service.getStatus(campaignId);const report=buildFullRefreshReport(db,campaignId);const queue=value.queues[0]??null,checkpoint=queue?.checkpoint??{};
  const current=formalCatalogState(db),before=checkpoint.formal_state_before??null;
  return {mode:MODE,fixedBrowser:{profile:PROFILE_DIRECTORY,profileName:PROFILE_NAME,cdpRequired:false,extensionRequired:true,localServerEndpoint:'http://127.0.0.1:37821'},
    campaignId,metrics:{target:value.campaign.targetCount,refreshed_unique:value.campaign.nonElectronicUniqueCount,
      remaining:Math.max(0,value.campaign.targetCount-value.campaign.nonElectronicUniqueCount),observed:value.campaign.rawObservedCount,
      active_pool_refreshed:report.activePoolRefreshed,non_baseline_observed:report.nonBaselineObserved,
      existing_products_refreshed:report.existingProductsRefreshed,new_products_created:report.newProductsCreated,
      excluded:value.campaign.electronicExcludedCount,failed:failedCount(value),duplicate_goods_id:value.qualityMetrics.duplicateGoodsIdCount,
      sales_parse_success:report.rows.length-report.sales.parseFailures,raw_sales_evidence:report.rows.length-report.sales.rawEvidenceMissing,
      dom_unique:report.rows.length,network_unique:report.rows.filter(row=>row.network_endpoint).length,
      network_enriched:report.transports.NETWORK_ENRICHED??0,dom_fallback:report.transports.DOM??0},
    manualSalesSample:{status:checkpoint.manual_sales_sample_status??'PENDING',count:Array.isArray(checkpoint.manual_sales_sample)?checkpoint.manual_sales_sample.length:0,
      rows:checkpoint.manual_sales_sample??[]},dataIntegrity:{before,current,opportunityFrozen:before?opportunityEqual(before,current):null,
      activePoolUnchanged:before?before.activePoolId===current.activePoolId&&before.activePoolCount===current.activePoolCount:null},status:value};
}

function recordSalesSample(service,campaignId,samplePath){
  const value=service.getStatus(campaignId),queue=value.queues[0];if(!queue||!['opening','waiting_page_ready','capturing','waiting_load_more'].includes(queue.status))throw coded('FULL_REFRESH_SAMPLE_QUEUE_CLOSED','销量抽样必须在 source 完成前记录。');
  const sample=JSON.parse(fs.readFileSync(path.resolve(samplePath),'utf8'));
  if(!Array.isArray(sample)||sample.length!==20||new Set(sample.map(row=>String(row.goods_id))).size!==20)throw coded('FULL_REFRESH_SAMPLE_INVALID','销量人工抽样必须是20个唯一 goods_id。');
  const staging=new Map(db.prepare(`SELECT goods_id,raw_json,sales_count FROM catalog_staging_products WHERE campaign_id=?`).all(campaignId).map(row=>[String(row.goods_id),row]));
  const checked=sample.map(row=>{const stored=staging.get(String(row.goods_id));if(!stored)throw coded('FULL_REFRESH_SAMPLE_NOT_STAGED',`抽样 goods_id ${row.goods_id} 不在本轮 staging。`);
    const raw=parseJson(stored.raw_json),visible=String(row.visible_sales_text??'').replace(/\s+/g,' ').trim(),storedRaw=String(raw.raw_sales_text??'').replace(/\s+/g,' ').trim();
    const parsed=Number(row.parsed_sales_count);const pass=row.pass===true&&visible===storedRaw&&parsed===Number(stored.sales_count);
    return {goods_id:String(row.goods_id),visible_sales_text:visible,stored_raw_sales_text:storedRaw,parsed_sales_count:parsed,stored_sales_count:Number(stored.sales_count),pass};});
  if(checked.some(row=>!row.pass))throw coded('FULL_REFRESH_SAMPLE_FAILED','20条人工可见销量抽样未达到20/20。',{rows:checked});
  service.saveExtensionCheckpoint({campaign_id:campaignId,source_id:queue.sourceId,queue_id:queue.id,status:queue.status==='waiting_load_more'?'waiting_load_more':'capturing',checkpoint:{
    manual_sales_sample_status:'PASS',manual_sales_sample:checked,manual_sales_sample_at:new Date().toISOString()}});
  return {action:'record-sales-sample',result:'20/20 PASS',...status(service,campaignId)};
}

function completeSource(service,campaignId){const value=service.getStatus(campaignId),campaign=value.campaign,queue=value.queues[0];
  if(campaign.nonElectronicUniqueCount!==campaign.targetCount)throw coded('FULL_REFRESH_TARGET_NOT_EXACT',`refreshed_unique 必须精确等于 ${campaign.targetCount}，实际 ${campaign.nonElectronicUniqueCount}。`);
  const report=buildFullRefreshReport(db,campaignId);if(report.sales.parseFailures||report.sales.rawEvidenceMissing)throw coded('FULL_REFRESH_SALES_QA_FAILED','存在销量解析或原始销量证据缺失。');
  if(!queue?.claimToken)throw coded('CATALOG_RPA_NOT_CLAIMED','缺少 Full Refresh queue claim。');
  const result=service.completeRpaSource({queue_id:queue.id,claim_token:queue.claimToken,stop_reason:'TARGET_GATE_REACHED',checkpoint:{...queue.checkpoint,
    runner_state:'COMPLETED',refreshed_unique:campaign.targetCount,stop_reason:'TARGET_GATE_REACHED'}});
  return {action:'complete-source',result,...status(service,campaignId)};}

function runQa(service,campaignId){const beforeStatus=status(service,campaignId),value=beforeStatus.status,report=buildFullRefreshReport(db,campaignId),materialization=value.materialization;
  if(!materialization)throw coded('FULL_REFRESH_NOT_MATERIALIZED','QA前必须先 materialize。');
  const checks={targetExact:report.refreshedUnique===value.campaign.targetCount,duplicateGoodsId:report.duplicateGoodsId===0,
    salesParseExact:report.sales.parseFailures===0&&report.sales.rawEvidenceMissing===0,
    manualSalesSample:beforeStatus.manualSalesSample.status==='PASS'&&beforeStatus.manualSalesSample.count===20&&beforeStatus.manualSalesSample.rows.every(row=>row.pass),
    snapshotsExact:materialization.snapshotsInserted===value.campaign.targetCount,
    productsDeltaExact:beforeStatus.dataIntegrity.current.products-beforeStatus.dataIntegrity.before.products===materialization.productsInserted,
    membershipsDeltaExact:beforeStatus.dataIntegrity.current.memberships-beforeStatus.dataIntegrity.before.memberships===materialization.membershipsInserted,
    activePoolUnchanged:beforeStatus.dataIntegrity.activePoolUnchanged,opportunityFrozen:beforeStatus.dataIntegrity.opportunityFrozen,
    activeMembershipsUnchanged:beforeStatus.dataIntegrity.current.activeMemberships===beforeStatus.dataIntegrity.before.activeMemberships,
    reviewsUnchanged:beforeStatus.dataIntegrity.current.reviews===beforeStatus.dataIntegrity.before.reviews,
    migrationUnchanged:beforeStatus.dataIntegrity.current.migrationMax===beforeStatus.dataIntegrity.before.migrationMax,
    sqliteIntegrity:beforeStatus.dataIntegrity.current.sqliteIntegrity==='ok'&&beforeStatus.dataIntegrity.current.foreignKeyViolations===0};
  if(!Object.values(checks).every(Boolean))throw coded('FULL_REFRESH_STRICT_QA_FAILED','Full Refresh严格QA未通过。',{checks,status:beforeStatus});
  const qa=value.campaign.status==='completed'&&value.campaign.qaStatus==='passed'
    ? {campaign:value.campaign,audit:value.refreshAudit,comparison:value.refreshComparison,quality:value.qualityMetrics,materialization:value.materialization}
    : service.evaluateRefreshQa(campaignId);
  if(qa.campaign?.qaStatus!=='passed'&&Number(qa.audit?.qa_passed??qa.audit?.qaPassed)!==1)throw coded('FULL_REFRESH_BASE_QA_FAILED','项目原生 Refresh QA 未通过。',{qa});
  return {action:'qa',checks,qa,report:buildFullRefreshReport(db,campaignId),...status(service,campaignId)};}

function assertSmokePassed(){const row=db.prepare(`SELECT id FROM catalog_campaigns WHERE browser_control_mode=? AND target_count=50 AND status='completed' AND qa_status='passed'
  ORDER BY finished_at DESC,id DESC LIMIT 1`).get(MODE);if(!row)throw coded('FULL_REFRESH_50_QA_REQUIRED','必须先完成 FULL_REFRESH_50 严格 QA。');}
function opportunityEqual(a,b){return ['opportunitySnapshotId','opportunityStatus','opportunitySnapshots','opportunityCandidates','opportunityConfirmations','opportunityConfirmationEvents'].every(key=>a[key]===b[key]);}
function failedCount(value){return value.queues.reduce((sum,queue)=>sum+Number(queue.checkpoint?.extension_error_count??0)+(queue.status==='failed'?1:0),0);}
function parseJson(value){try{return JSON.parse(value??'{}')??{};}catch{return{};}}
function required(value,name){const result=String(value??'').trim();if(!result)throw new Error(`缺少 --${name}`);return result;}
function parseArgs(argv){const [first,...rest]=argv;if(!first)throw new Error('用法：create-smoke/create-full/status/record-sales-sample/complete-source/materialize/qa/report');const options={};for(let i=0;i<rest.length;i+=1){const token=rest[i];if(!token.startsWith('--'))throw new Error(`无法识别参数：${token}`);const key=token.slice(2),value=rest[i+1];if(!value||value.startsWith('--'))throw new Error(`参数 --${key} 缺少值。`);options[key]=value;i+=1;}return{action:first,options};}
function coded(code,message,details=null){const error=new Error(message);error.code=code;if(details)error.details=details;return error;}
function print(value){console.log(JSON.stringify(value,null,2));}
