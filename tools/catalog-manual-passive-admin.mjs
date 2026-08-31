import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createCatalogCampaignService } from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { loadCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';
import { validateResumeCampaign } from '../src/modules/catalog-scale/campaign-selection.mjs';
import { createId } from '../src/shared/ids.mjs';

const MODE='MANUAL_BIND_PASSIVE_CAPTURE';
const PROFILE_NAME='Temu1店';
const PROFILE_DIRECTORY='Profile 10';
const { action,options }=parseArgs(process.argv.slice(2));
const config=await loadConfig(options.config??'config.json');
const db=openDatabase(config.app.databasePath);

try {
  const service=createCatalogCampaignService(db);
  if(action==='create') print(await create(service));
  else {
    const campaignId=required(options.campaign,'campaign');
    if(action==='status') print(status(service,campaignId));
    else if(action==='configure-runtime') print(configureRuntime(service,campaignId));
    else if(action==='approve-stage') print(approveStage(service,campaignId,stage(options.stage)));
    else if(action==='finalize') print(finalize(service,campaignId));
    else throw new Error(`未知操作：${action}`);
  }
} finally { db.close(); }

async function create(service) {
  const profile=await loadCategoryProfile(path.resolve(options.profile??'config/categories/motorcycle-accessories.json'));
  const target=options.target===undefined?profile.target_count:positiveInteger(options.target,'target');
  if(options['resume-campaign']) { const campaign=validateResumeCampaign(service,{campaignId:options['resume-campaign'],profile,campaignType:'expansion'});return {action:'resume',...status(service,campaign.id)}; }
  const baseline=service.getBaselineConsistency(profile.category_key);
  if(baseline.activePoolVersionCount>=target) throw coded('CATALOG_TARGET_INVALID',`Active Pool已经达到或超过 ${target}。`);
  const created=service.createOperatorManualCampaign({ profile,requestedNewCount:target-baseline.activePoolVersionCount,
    campaignName:options.name??`catalog-manual-passive-${target}-${new Date().toISOString().slice(0,10).replaceAll('-','')}`,
    requestId:options['request-id']??createId('operator_cli_request') });
  return { action:created.idempotentReplay?'replayed':'created',...status(service,created.campaignId) };
}

function approveStage(service,campaignId,value) {
  const report=status(service,campaignId);const queue=activeQueue(report.status);
  if(!queue) throw coded('CATALOG_RPA_NOT_CLAIMED','没有可写checkpoint的Manual Passive queue。');
  const checkpoint=queue.checkpoint??{};const origin=Number(checkpoint.capture_origin_unique);
  if(!Number.isInteger(origin)) throw coded('MANUAL_PASSIVE_CHECKPOINT_INVALID','checkpoint缺少capture_origin_unique。');
  if(value===300&&checkpoint.qa_50_status!=='PASS') throw coded('STAGE_50_QA_REQUIRED','50 Goods QA未通过。');
  const expected=origin+value;
  if(report.metrics.accepted_unique!==expected) throw coded('MANUAL_PASSIVE_STAGE_NOT_EXACT',`阶段要求 accepted_unique=${expected}，实际=${report.metrics.accepted_unique}。`);
  assertQa(report);
  const next={ runner_state:'UNBOUND',capture_paused:true,last_action:'stage_approved_binding_required',bound_url:null,bound_at:null,bound_category:null,bound_sort:null,bound_goods_count:null,
    stage_target_delta:value,session_target:expected,last_qa_stage:value,last_qa_at:new Date().toISOString(),
    ...(value===50?{qa_50_status:'PASS'}:{qa_300_status:'PASS'}) };
  service.saveExtensionCheckpoint({ campaign_id:campaignId,source_id:queue.sourceId,queue_id:queue.id,status:'capturing',checkpoint:next });
  const milestone=service.recordExpansionCheckpoint(campaignId,expected);
  return { action:'approve-stage',stage:value,expectedAcceptedUnique:expected,milestone,...status(service,campaignId) };
}

function configureRuntime(service,campaignId) {
  const report=status(service,campaignId);const queue=activeQueue(report.status);
  if(!queue) throw coded('CATALOG_RPA_NOT_CLAIMED','没有可更新的Manual Passive queue。');
  service.saveExtensionCheckpoint({ campaign_id:campaignId,source_id:queue.sourceId,queue_id:queue.id,status:'capturing',checkpoint:{
    runner_state:'UNBOUND',capture_mode:MODE,cdp_required:false,extension_passive_required:true,
    local_server_endpoint:'http://127.0.0.1:37821',automatic_scroll:false,automatic_see_more:false,direct_api:false,capture_paused:true,last_action:'runtime_configured',
    bound_url:null,bound_at:null,bound_category:null,bound_sort:null,bound_goods_count:null } });
  return { action:'configure-runtime',...status(service,campaignId) };
}

function finalize(service,campaignId) {
  let report=status(service,campaignId);const queue=activeQueue(report.status);const checkpoint=queue?.checkpoint??{};
  const target=report.metrics.target,confirmation=`ACTIVATE_POOL_${target}`;
  if(options.confirm!==confirmation) throw coded('CONFIRMATION_REQUIRED',`finalize要求 --confirm ${confirmation}。`);
  if(checkpoint.qa_300_status!=='PASS') throw coded('STAGE_300_QA_REQUIRED','300 Goods QA未通过。');
  if(report.metrics.accepted_unique!==target) throw coded('CATALOG_TARGET_NOT_REACHED',`accepted_unique必须精确等于 ${target}。`);
  assertQa(report);
  if(!queue?.claimToken) throw coded('CATALOG_RPA_NOT_CLAIMED','finalize缺少queue claim。');
  service.completeRpaSource({ queue_id:queue.id,claim_token:queue.claimToken,stop_reason:'TARGET_GATE_REACHED',checkpoint:{ ...checkpoint,runner_state:'TARGET_REACHED',accepted_unique:target } });
  const materialization=service.materializeExpansion(campaignId);const qa=service.evaluateExpansionQa(campaignId);
  if(!qa.audit?.qaPassed) throw coded('CATALOG_POOL_QA_REQUIRED',`${target}正式QA未通过，未激活Active Pool。`,{ qa });
  const activated=service.activatePoolVersion(campaignId,{ qaSummary:{ gate:`Manual Bind Passive Capture ${target}`,mode:MODE } });
  report=status(service,campaignId);return { action:'finalize',materialization,qa,activated,...report };
}

function status(service,campaignId) {
  const value=service.getStatus(campaignId);const campaign=value.campaign;const checkpoint=activeQueue(value)?.checkpoint??value.queues.at(-1)?.checkpoint??{};
  const profile=campaign.config?.categoryProfile;if(!profile)throw coded('CATEGORY_PROFILE_REQUIRED','Campaign 缺少冻结 Category Profile。');
  const accepted=Number(campaign.nonElectronicUniqueCount);const trace=traceAudit(campaignId,profile);const integrity=dataIntegrity(checkpoint.formal_state_before??null,profile);
  return { mode:MODE,fixedBrowser:{ profile:PROFILE_DIRECTORY,profileName:PROFILE_NAME,cdpRequired:false,extensionPassiveRequired:true,localServerEndpoint:'http://127.0.0.1:37821' },campaignId,
    metrics:{ target:campaign.targetCount,accepted_unique:accepted,remaining:Math.max(0,campaign.targetCount-accepted),observed:campaign.rawObservedCount,
      eligible:accepted,existing:campaign.baselinePoolCount,new:Math.max(0,accepted-campaign.baselinePoolCount),excluded:campaign.electronicExcludedCount,
      failed:failedCount(value),accepted_to_snapshot_missing:trace.acceptedToSnapshotMissing,last_batch:checkpoint.last_batch??null,campaign_status:checkpoint.runner_state??campaign.status },
    stage:{ origin:checkpoint.capture_origin_unique??null,sessionTarget:checkpoint.session_target??null,qa50:checkpoint.qa_50_status??'PENDING',qa300:checkpoint.qa_300_status??'PENDING' },
    trace,integrity,status:value };
}

function assertQa(report) {
  const failures=[];
  if(report.status.qualityMetrics.duplicateGoodsIdCount!==0) failures.push('DUPLICATE_GOODS_ID');
  if(report.metrics.failed!==0) failures.push('FAILED_BATCH_OR_QUEUE');
  if(report.trace.invalidEvidence!==0||report.trace.validEvidence!==report.trace.rows) failures.push('PASSIVE_NETWORK_TRACE_INVALID');
  if(report.trace.acceptedToSnapshotMissing!==0) failures.push('ACCEPTED_TO_SNAPSHOT_MISSING');
  if(report.integrity.sqliteIntegrity!=='ok'||report.integrity.foreignKeyViolations!==0) failures.push('SQLITE_INTEGRITY');
  if(report.integrity.formalUnchanged===false) failures.push('FORMAL_DATA_CHANGED');
  if(failures.length) throw coded('MANUAL_PASSIVE_QA_FAILED',`Manual Passive QA失败：${failures.join(', ')}`,{ failures,report });
}

function traceAudit(campaignId,profile) {
  const rows=db.prepare(`SELECT s.goods_id,s.raw_json,CASE WHEN s.electronic_screening_status='passed' AND b.goods_id IS NULL THEN 1 ELSE 0 END accepted
    FROM catalog_staging_products s LEFT JOIN catalog_campaign_baseline_items b ON b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id
    WHERE s.campaign_id=?`).all(campaignId);let validEvidence=0,invalidEvidence=0,acceptedRows=0,acceptedToSnapshotMissing=0;
  const categories=new Set(profile.page_health?.category_names??[profile.display_name]);const expectedSort=String(profile.sort_order).toLowerCase();
  for(const row of rows){let raw={};try{raw=JSON.parse(row.raw_json??'{}');}catch{}
    const valid=raw.network_observed===true&&raw.network_endpoint==='/api/poppy/v1/opt'&&Boolean(raw.network_observed_at)&&['DOM','NETWORK_ENRICHED'].includes(raw.capture_transport)
      &&Boolean(raw.bound_url)&&Boolean(raw.bound_at)&&categories.has(raw.bound_category)&&String(raw.bound_sort).toLowerCase()===expectedSort;
    if(valid)validEvidence+=1;else invalidEvidence+=1;if(Number(row.accepted)===1){acceptedRows+=1;if(!valid)acceptedToSnapshotMissing+=1;}
  }
  return { rows:rows.length,validEvidence,invalidEvidence,acceptedRows,acceptedToSnapshotMissing };
}
function formalState(profile) {
  const activePool=db.prepare("SELECT id,product_count FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get(profile.category_key)??null;
  const opportunity=db.prepare("SELECT id,status FROM opportunity_analysis_snapshots WHERE category_key=? ORDER BY generated_at DESC,id DESC LIMIT 1").get(profile.category_key)??null;
  return { categoryKey:profile.category_key,products:count('products'),memberships:count('catalog_memberships'),activeMemberships:scopedActiveMembershipCount(profile),
    snapshots:count('product_snapshots'),reviews:count('reviews'),activePoolId:activePool?.id??null,activePoolCount:Number(activePool?.product_count??0),
    opportunitySnapshotId:opportunity?.id??null,opportunityStatus:opportunity?.status??null,
    migrationMax:db.prepare('SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1').get()?.filename??null };
}
function dataIntegrity(before,profile) { const current=formalState(profile);return { current,before,formalUnchanged:before?JSON.stringify(current)===JSON.stringify(before):null,
  sqliteIntegrity:String(db.prepare('PRAGMA integrity_check').get().integrity_check),foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length }; }
function failedCount(value){return value.queues.reduce((total,queue)=>total+Number(queue.checkpoint?.failed_count??0)+(queue.status==='failed'?1:0),0);}
function activeQueue(value){return value.queues.find(queue=>['opening','waiting_page_ready','capturing','waiting_load_more','manual_required'].includes(queue.status))??null;}
function count(table){return Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);}
function scopedActiveMembershipCount(profile){const scope=profile.membership_scope;return Number(db.prepare(`SELECT COUNT(*) count FROM catalog_memberships WHERE active=1 AND category_key=? AND site_country=? AND language=? AND currency=? AND primary_category=? AND subcategory=? AND sort_order=?`).get(profile.category_key,scope.site_country,scope.language,scope.currency,scope.primary_category,scope.subcategory,scope.sort_order).count);}
function stage(value){const parsed=Number(value);if(![50,300].includes(parsed))throw coded('INVALID_STAGE_TARGET','--stage只能是50或300。');return parsed;}
function positiveInteger(value,name){const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1)throw coded('INVALID_TARGET',`--${name} 必须是正整数。`);return parsed;}
function parseArgs(argv){const [first,...rest]=argv;if(!first)throw new Error('用法：create/status/configure-runtime/approve-stage/finalize');const options={};for(let index=0;index<rest.length;index+=1){const token=rest[index];if(!token.startsWith('--'))throw new Error(`无法识别参数：${token}`);const key=token.slice(2),value=rest[index+1];if(!value||value.startsWith('--'))throw new Error(`参数 --${key} 缺少值。`);options[key]=value;index+=1;}return { action:first,options };}
function coded(code,message,details=null){const error=new Error(message);error.code=code;if(details)error.details=details;return error;}
function print(value){console.log(JSON.stringify(value,null,2));}
