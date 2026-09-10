import {transaction} from '../../db/client.mjs';
import {createId} from '../../shared/ids.mjs';
import {AppError} from '../../shared/errors.mjs';
import {initialQuantityConfig,INITIAL_TARGET_STORAGE_SENTINEL} from './campaign-quantity-policy.mjs';
const MODE='MANUAL_BIND_PASSIVE_CAPTURE';
export function createManualRecapture({db,repository,now,activityRegistry,createCampaignRecord}){
 const fail=message=>{throw new AppError(message,{code:'MANUAL_TASK_SWITCH_FAILED'});};
 function list(){
  const pools=db.prepare("SELECT id,category_key,product_count FROM catalog_pool_versions WHERE status='active' ORDER BY product_count DESC").all();
  const tasks=db.prepare("SELECT id FROM catalog_campaigns WHERE browser_control_mode=? AND status IN ('running','paused','manual_required') ORDER BY created_at DESC").all(MODE).map(r=>repository.getCampaign(r.id));
  const active=repository.listActiveRpaQueues();
  return {pools,tasks:tasks.map(c=>({id:c.id,name:c.name,category:c.categoryKey,status:c.status,purpose:c.config?.trackingRecapture?'复采跟踪':c.campaignType==='initial'?'首次采集':'补充商品',count:c.nonElectronicUniqueCount})),current:active.length===1?{id:active[0].campaignId,generation:active[0].claimGeneration}:null};
 }
 function switchTask(input){return transaction(db,()=>{
  const active=repository.listActiveRpaQueues();if(active.length>1)fail('存在多个采集任务，请先处理任务占用。');
  const old=active[0];
  if((old?.campaignId??null)!==(input.expectedCurrentId??null)||old&&old.claimGeneration!==input.expectedGeneration)fail('当前任务已变化，请刷新后再切换。');
  let target=input.campaignId?repository.getCampaign(input.campaignId):null;
  if(input.campaignId&&!target)fail('任务不存在。');
  if(!target){
   const pool=db.prepare("SELECT * FROM catalog_pool_versions WHERE id=? AND status='active'").get(input.poolId);if(!pool)fail('请选择有效的正式商品池。');
   const name=String(input.name||`${pool.category_key} 复采 ${now()}`).trim();if(name.length>256)fail('任务名称过长。');
   const replay=typeof input.requestId==='string'&&repository.findOperatorCampaignByRequestId(input.requestId);
   if(replay){if(replay.config?.trackingPoolId!==pool.id)fail('创建请求与商品池不一致。');target=replay;}
   else{
    if(typeof input.requestId!=='string'||!input.requestId.trim())fail('缺少创建请求标识。');
    const sourceCampaign=repository.getCampaign(pool.campaign_id);const profile=sourceCampaign?.config?.categoryProfile;
    if(!profile||profile.category_key!==pool.category_key||profile.category_profile_version!==pool.category_profile_version)fail('原商品池类目配置缺失，请先修复配置。');
    if(repository.findCampaignByName(name))fail('任务名称已存在，请修改名称。');
    target=createCampaignRecord({name,campaignType:'refresh',profile,baselinePoolCount:pool.product_count,targetCount:INITIAL_TARGET_STORAGE_SENTINEL,
     browserContext:{profileName:'Temu-DE-Test',profileDirectory:'manual',controlMode:MODE},
     configExtras:{...initialQuantityConfig(),trackingRecapture:true,trackingPoolId:pool.id,captureTransportPolicy:'DOM_REQUIRED_NETWORK_OPTIONAL',operatorCreate:{requestId:input.requestId,captureMode:MODE}}});
    const items=db.prepare(`SELECT p.id product_id,i.platform,i.goods_id FROM catalog_pool_version_items i JOIN products p ON p.platform=i.platform AND p.external_product_id=i.goods_id WHERE i.pool_version_id=?`).all(pool.id);
    if(items.length!==pool.product_count)fail('正式商品池商品映射不完整，请先检查数据。');
    const insert=db.prepare('INSERT INTO catalog_campaign_baseline_items(campaign_id,product_id,platform,goods_id,membership_id,captured_at) VALUES(?,?,?,?,NULL,?)');
    for(const item of items)insert.run(target.id,item.product_id,item.platform,item.goods_id,now());
    db.prepare("UPDATE catalog_campaigns SET baseline_pool_version_id=?,baseline_source='ACTIVE_POOL_VERSION' WHERE id=?").run(pool.id,target.id);
    repository.createSource(target,{sourceKey:'manual-tracking-recapture',sourceType:'category',sortOrder:profile.sort_order,priority:1,targetQuota:null,navigationHint:{entryMethod:'human_navigation_only',automaticNavigation:false,automaticScroll:false,automaticSeeMore:false}});
   }
  }
  if(target.browserControlMode!==MODE||!['pending','paused','running','manual_required'].includes(target.status))fail('该任务不能切换为手动采集。');
  if(old?.campaignId===target.id)return {campaignId:target.id,alreadyCurrent:true};
  const queues=repository.listRpaQueues(target.id);if(queues.length!==1||queues[0].status!=='pending'||queues[0].claimToken)fail('待切换任务状态异常。');
  if(old)pauseQueue(old);
  const q=repository.claimRpaQueue(queues[0].id,createId('catalog_claim'));if(!q)fail('领取任务失败。');
  repository.transitionCampaign(target.id,'running');repository.createSourceRun(q.sourceId,q.attemptCount);repository.transitionSource(q.sourceId,'capturing');repository.transitionRpaQueue(q.id,'capturing',{checkpoint:clean(q.checkpoint,'manual_task_selected'),clearError:true});
  return {campaignId:target.id,pausedCampaignId:old?.campaignId??null};
 });}
 function pauseQueue(old){
   const prior=repository.getCampaign(old.campaignId);if(prior.browserControlMode!==MODE||!['running','manual_required'].includes(prior.status))fail('当前任务不是可暂停的手动任务。');
   if(!activityRegistry)fail('无法核验当前任务是否空闲。');
   const activity=activityRegistry.snapshot({campaignId:prior.id,queueId:old.id});if(Object.entries(activity).some(([k,v])=>k!=='liveBinding'&&v))fail('当前任务正在保存或导出，请完成后再切换。');
   const at=now();repository.transitionCampaign(prior.id,'paused');repository.transitionSource(old.sourceId,'pending');repository.transitionRpaQueue(old.id,'pending',{checkpoint:clean(old.checkpoint,'paused_for_task_switch'),clearError:true});
   db.prepare('UPDATE catalog_rpa_queue SET claim_token=NULL,claimed_at=NULL,heartbeat_at=NULL WHERE id=?').run(old.id);
   repository.finishSourceRun(old.sourceId,{stopReason:'MANUAL_TASK_SWITCH'});
   db.prepare('UPDATE catalog_campaigns SET config_json=? WHERE id=?').run(JSON.stringify({...prior.config,operatorBindingInvalidatedAt:at}),prior.id);
 }
 function pauseCurrent(input){return transaction(db,()=>{
  const active=repository.listActiveRpaQueues();if(active.length>1)fail('存在多个活跃任务，请先检查占用。');
  const old=active[0];if(!old){
   const c=repository.getCampaign(input.expectedCurrentId);const qs=c?repository.listRpaQueues(c.id):[];
   if(c?.status==='paused'&&qs.length===1&&!qs[0].claimToken&&qs[0].status==='pending'&&qs[0].claimGeneration===input.expectedGeneration)return {campaignId:c.id,status:'paused',alreadyPaused:true};
   fail('当前没有可暂停的任务，请刷新任务列表。');
  }
  if(old.campaignId!==input.expectedCurrentId||old.claimGeneration!==input.expectedGeneration)fail('当前任务已变化，请刷新后再暂停。');
  pauseQueue(old);return {campaignId:old.campaignId,status:'paused',released:true};
 });}
 function clean(cp,action){const next={...cp,runner_state:'UNBOUND',capture_mode:MODE,capture_paused:true,last_action:action};for(const key of Object.keys(next))if(key==='status'||/binding|fingerprint|bound_|page_context/i.test(key))delete next[key];return next;}
 return {list,switchTask,pauseCurrent};
}
