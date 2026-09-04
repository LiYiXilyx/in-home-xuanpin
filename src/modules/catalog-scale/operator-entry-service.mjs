import {validateCategoryProfile} from './category-profile.mjs';
import {getCampaignQuantityPolicy} from './campaign-quantity-policy.mjs';

const MODE='MANUAL_BIND_PASSIVE_CAPTURE';
export function createOperatorEntryService({db,repository,initialRepository}) {
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
 return {resolve};
}
