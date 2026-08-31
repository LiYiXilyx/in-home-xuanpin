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
    operatorCurrent() { return mapOperatorCurrent(catalogService.currentOperatorManualContext()); },
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

function mapOperatorCurrent(context) {
  if (!context) return null;
  const requested=Number(context.campaign.targetCount-context.campaign.baselinePoolCount);
  return { campaign_id:context.campaign.id,category_key:context.campaign.categoryKey,
    category_profile_version:context.campaign.categoryProfileVersion,campaign_name:context.campaign.name,
    baseline_count:context.campaign.baselinePoolCount,target_count:context.campaign.targetCount,
    current_unique:context.campaign.nonElectronicUniqueCount,remaining:Math.max(0,context.campaign.targetCount-context.campaign.nonElectronicUniqueCount),
    requested_new_count:requested,status:context.campaign.status,capture_mode:context.campaign.browserControlMode,
    binding_status:context.queue.checkpoint?.runner_state ?? 'UNBOUND',queue_id:context.queue.id,source_id:context.source.id };
}
