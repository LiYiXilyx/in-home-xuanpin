import {validateCategoryProfile} from './category-profile.mjs';
import {getCampaignQuantityPolicy} from './campaign-quantity-policy.mjs';
import {transaction} from '../../db/client.mjs';
import {createId} from '../../shared/ids.mjs';
import {AppError} from '../../shared/errors.mjs';

const MODE='MANUAL_BIND_PASSIVE_CAPTURE';
export function createOperatorEntryService({db,repository,initialRepository,now}) {
 const fail=(code,message=code)=>{throw new AppError(message,{code});};
 function resolve(input){
  const base={category_key:input?.category_key,category_profile_version:input?.category_profile_version,campaign_id:null};
  const blocked=code=>({...base,action:'BLOCKED',available:false,code});
  let profile;try{profile=validateCategoryProfile(input);}catch(error){return blocked(error.code??'CATEGORY_PROFILE_INVALID');}
  const eligible=initialRepository.getInitialEligibility(profile);
  const candidates=eligible.priorInitials.map(row=>repository.getCampaign(row.id));
  if(candidates.some(c=>c.categoryProfileVersion!==profile.category_profile_version||c.browserControlMode!==MODE))return blocked('OPERATOR_MANUAL_CONTEXT_MISMATCH');
  if(candidates.length>1)return blocked('INITIAL_CAMPAIGN_CONTEXT_AMBIGUOUS');
  const active=eligible.poolHistory.filter(row=>row.status==='active');
  if(eligible.poolHistoryCount){
   if(active.length!==1||active[0].category_profile_version!==profile.category_profile_version)return blocked('CATEGORY_POOL_STATE_INCONSISTENT');
   let baseline;try{baseline=repository.getBaselineConsistency(profile);}catch{return blocked('CATEGORY_POOL_STATE_INCONSISTENT');}
   if(!baseline.consistent||!baseline.activePoolVersionExists||baseline.activePoolVersionCount<=0)return blocked('CATEGORY_POOL_STATE_INCONSISTENT');
   if(candidates.length)return blocked('INITIAL_CAMPAIGN_WITH_ACTIVE_POOL');
   return {...base,action:'EXPANSION',available:true,code:null};
  }
  if(eligible.activeMembershipCount||db.prepare("SELECT 1 FROM catalog_campaigns WHERE category_key=? AND campaign_type='initial' AND status='completed'").get(profile.category_key))return blocked('INITIAL_CATEGORY_STATE_INCONSISTENT');
  if(candidates.length){
   const c=candidates[0];
   try{if(getCampaignQuantityPolicy(c).quantityMode!=='OPEN_ENDED')return blocked('INITIAL_QUANTITY_POLICY_INVALID');}catch(error){return blocked(error.code??'INITIAL_QUANTITY_POLICY_INVALID');}
   if(!['running','paused','manual_required'].includes(c.status))return blocked('INITIAL_CAMPAIGN_NOT_CONTINUABLE');
   return {...base,action:'CONTINUE_INITIAL',available:true,code:null,campaign_id:c.id};
  }
  return {...base,action:'START_INITIAL',available:true,code:null};
 }
 function continueInitial({profile,campaignId,requestId}){
  if(typeof requestId!=='string'||!requestId.trim())fail('OPERATOR_REQUEST_ID_REQUIRED');
  if(typeof campaignId!=='string'||!campaignId.trim())fail('CATALOG_CAMPAIGN_NOT_FOUND');
  return transaction(db,()=>{
   const entry=resolve(profile);
   if(entry.action!=='CONTINUE_INITIAL')fail(entry.code??'INITIAL_CAMPAIGN_NOT_CONTINUABLE');
   if(entry.campaign_id!==campaignId)fail('OPERATOR_MANUAL_CONTEXT_MISMATCH');
   const c=repository.getCampaign(campaignId),queues=repository.listRpaQueues(campaignId);
   const sources=db.prepare('SELECT id FROM catalog_sources WHERE campaign_id=?').all(campaignId);
   if(queues.length!==1||sources.length!==1||queues[0].sourceId!==sources[0].id)fail('INITIAL_CAMPAIGN_CONTEXT_AMBIGUOUS');
   const q=queues[0],source=repository.getSource(q.sourceId),active=['opening','waiting_page_ready','capturing','waiting_load_more','manual_required'];
   if(!['pending',...active].includes(q.status)||!['pending',...active].includes(source.status)||source.campaignId!==campaignId)fail('INITIAL_CAMPAIGN_NOT_CONTINUABLE');
   const foreign=db.prepare(`SELECT q.id FROM catalog_rpa_queue q JOIN catalog_campaigns c ON c.id=q.campaign_id
    WHERE q.campaign_id<>? AND (q.status IN ('opening','waiting_page_ready','capturing','waiting_load_more','manual_required')
    OR (q.claim_token IS NOT NULL AND q.status NOT IN ('completed','failed','cancelled') AND c.status NOT IN ('completed','failed','cancelled')))` ).all(campaignId);
   if(foreign.length)fail('CATALOG_RPA_CLAIM_CONFLICT');
   const runs=db.prepare('SELECT * FROM catalog_source_runs WHERE source_id=? AND finished_at IS NULL').all(q.sourceId);
   if(runs.length>1||runs.some(r=>r.campaign_id!==campaignId))fail('INITIAL_CAMPAIGN_CONTEXT_AMBIGUOUS');
   const claim=db.prepare('SELECT claim_token,claim_generation FROM catalog_rpa_queue WHERE id=?').get(q.id);
   if(claim.claim_token&&(!active.includes(q.status)||claim.claim_generation<1||runs.length!==1))fail('OPERATOR_MANUAL_CONTEXT_MISMATCH');
   if(c.status==='running'&&(!claim.claim_token||runs.length!==1))fail('OPERATOR_MANUAL_CONTEXT_MISMATCH');
   const payload={campaignId,categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version};
   const prior=db.prepare(`SELECT id,config_json FROM catalog_campaigns WHERE json_type(config_json,'$.operatorContinue')='array'`).all();
   for(const row of prior){const replay=JSON.parse(row.config_json).operatorContinue.find(r=>r.requestId===requestId);if(replay){if(row.id!==campaignId||JSON.stringify(replay.payload)!==JSON.stringify(payload))fail('OPERATOR_CREATE_IDEMPOTENCY_CONFLICT');if(c.status!=='running'||!claim.claim_token)fail('INITIAL_CAMPAIGN_NOT_CONTINUABLE');return {...replay.result,idempotentReplay:true};}}
   const at=now();
   if(!claim.claim_token){
    db.prepare(`UPDATE catalog_rpa_queue SET claim_token=?,claim_generation=claim_generation+1,attempt_count=attempt_count+1,claimed_at=? WHERE id=? AND claim_token IS NULL`).run(createId('catalog_claim'),at,q.id);
    if(!runs.length){const n=db.prepare('SELECT COALESCE(MAX(run_number),0)+1 n FROM catalog_source_runs WHERE source_id=?').get(q.sourceId).n;repository.createSourceRun(q.sourceId,n);}
   }
   const checkpoint={...q.checkpoint,runner_state:'UNBOUND',capture_mode:MODE,capture_paused:true,quantity_mode:'OPEN_ENDED',capture_limit:null,last_action:'operator_continue_initial'};
   for(const key of Object.keys(checkpoint)){if(key==='status'||/binding|fingerprint|bound_|page_context/i.test(key))delete checkpoint[key];}
   for(const key of ['automatic_scroll','automatic_navigation','automatic_pagination','automatic_see_more','automatic_category_switching','automatic_sort_switching','automatic_captcha_handling','direct_api'])checkpoint[key]=false;
   repository.transitionCampaign(campaignId,'running');repository.transitionSource(q.sourceId,'capturing');
   repository.transitionRpaQueue(q.id,'capturing',{checkpoint,clearError:true});
   const result={campaignId,campaignType:'initial',categoryKey:c.categoryKey,categoryProfileVersion:c.categoryProfileVersion,campaignName:c.name,baselineCount:0,targetCount:null,remaining:null,targetReached:null,quantityMode:'OPEN_ENDED',captureLimit:null,captureMode:MODE,currentUnique:c.nonElectronicUniqueCount,status:'running',bindingStatus:'UNBOUND',idempotentReplay:false};
   const config={...c.config,operatorContinue:[...(c.config.operatorContinue??[]),{requestId,payload,result,at}]};
   db.prepare('UPDATE catalog_campaigns SET config_json=? WHERE id=?').run(JSON.stringify(config),campaignId);
   return result;
  });
 }
 return {resolve,continueInitial};
}
