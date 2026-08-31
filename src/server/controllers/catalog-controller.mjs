import { AppError } from '../../shared/errors.mjs';

export function createCatalogController({ catalogService,categoryProfileRegistry }) {
  return {
    async operatorProfiles() {
      const {profiles,invalid}=await categoryProfileRegistry.list();
      return {profiles:profiles.map(profile=>catalogService.describeOperatorProfile(profile)),invalid};
    },
    async createOperatorCampaign(body) {
      const profile=await categoryProfileRegistry.resolve({ categoryKey:body?.category_key,
        categoryProfileVersion:body?.category_profile_version });
      return catalogService.createOperatorManualCampaign({ profile,requestedNewCount:body?.requested_new_count,
        campaignName:body?.campaign_name,requestId:body?.request_id });
    },
    async createOperatorInitialCampaign(body) {
      const profile=await categoryProfileRegistry.resolve({ categoryKey:body?.category_key,
        categoryProfileVersion:body?.category_profile_version });
      return catalogService.createOperatorInitialCampaign({ profile,campaignName:body?.campaign_name,
        requestId:body?.request_id });
    },
    async runInitialPoolQa(campaignId,body) {
      assertCampaignBodyIdentity(campaignId,body);
      const profile=await categoryProfileRegistry.resolve({categoryKey:body?.category_key,
        categoryProfileVersion:body?.category_profile_version});
      return catalogService.runInitialPoolQa({campaignId,categoryKey:profile.category_key,
        categoryProfileVersion:profile.category_profile_version,requestId:body?.request_id});
    },
    async activateInitialPool(campaignId,body) {
      assertCampaignBodyIdentity(campaignId,body);
      const profile=await categoryProfileRegistry.resolve({categoryKey:body?.category_key,
        categoryProfileVersion:body?.category_profile_version});
      return catalogService.activateInitialPool({campaignId,categoryKey:profile.category_key,
        categoryProfileVersion:profile.category_profile_version,requestId:body?.request_id});
    },
    operatorCurrent() { const context=catalogService.currentOperatorManualContext();return mapOperatorCurrent(context,
      context?.campaign?.campaignType==='initial'?catalogService.getInitialQaState(context.campaign.id):null); },
    context(searchParams) {
      const campaignId=searchParams.get('campaign_id');
      const sourceId=searchParams.get('source_id');
      if (!campaignId || !sourceId) throw new AppError('Catalog context需要campaign_id和source_id。',{ code:'CATALOG_BATCH_INVALID' });
      return catalogService.getCaptureContext(campaignId,sourceId);
    },
    captureBatch(body) { return catalogService.captureExtensionBatch(body); },
    currentRpaContext() { return catalogService.currentRpaContext(); },
    claimNext(body) { return catalogService.claimNextSource(body?.campaign_id); },
    sourceOpened(body) { return catalogService.sourceOpened(body); },
    checkpoint(body) { return catalogService.saveRpaCheckpoint(body); },
    manualRequired(body) { return catalogService.markRpaManualRequired(body); },
    resume(body) { return catalogService.resumeRpa(body); },
    extensionCheckpoint(body) { return catalogService.saveExtensionCheckpoint(body); },
    extensionManualRequired(body) { return catalogService.markExtensionManualRequired(body); },
    extensionResume(body) { return catalogService.resumeExtensionRunner(body); },
    sourceComplete(body) { return catalogService.completeRpaSource(body); },
    status(searchParams) {
      const campaignId=searchParams.get('campaign_id');
      if (!campaignId) throw new AppError('Catalog status需要campaign_id。',{ code:'CATALOG_BATCH_INVALID' });
      return catalogService.getStatus(campaignId);
    }
  };
}

function mapOperatorCurrent(context,qa=null) {
  if (!context) return null;
  if (context.campaign.campaignType==='initial') return { campaign_id:context.campaign.id,campaign_type:'initial',
    category_key:context.campaign.categoryKey,category_profile_version:context.campaign.categoryProfileVersion,
    campaign_name:context.campaign.name,baseline_count:0,target_count:null,remaining:null,target_reached:null,
    quantity_mode:'OPEN_ENDED',capture_limit:null,current_unique:context.campaign.nonElectronicUniqueCount,
    status:context.campaign.status,capture_mode:context.campaign.browserControlMode,
    binding_status:context.queue.checkpoint?.runner_state??'UNBOUND',queue_id:context.queue.id,source_id:context.source.id,
    qa:qa?{status:qa.status,qa_run_id:qa.qaRunId??null,qa_candidate_count:qa.qaCandidateCount,
      live_unique_count:qa.liveUniqueCount,unreviewed_delta:qa.unreviewedDelta,checks:qa.checks??[],
      failure_codes:qa.failureCodes??[],duration_ms:qa.durationMs??null}:null };
  const requested=Number(context.campaign.targetCount-context.campaign.baselinePoolCount);
  return { campaign_id:context.campaign.id,category_key:context.campaign.categoryKey,
    category_profile_version:context.campaign.categoryProfileVersion,campaign_name:context.campaign.name,
    baseline_count:context.campaign.baselinePoolCount,target_count:context.campaign.targetCount,
    current_unique:context.campaign.nonElectronicUniqueCount,remaining:Math.max(0,context.campaign.targetCount-context.campaign.nonElectronicUniqueCount),
    requested_new_count:requested,status:context.campaign.status,capture_mode:context.campaign.browserControlMode,
    binding_status:context.queue.checkpoint?.runner_state ?? 'UNBOUND',queue_id:context.queue.id,source_id:context.source.id };
}
function assertCampaignBodyIdentity(campaignId,body) { if (String(body?.campaign_id??'')!==String(campaignId)) throw new AppError(
  'URL Campaign与请求体不匹配。',{code:'INITIAL_CAMPAIGN_IDENTITY_INVALID'}); }
