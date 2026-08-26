import { AppError } from '../../shared/errors.mjs';

export function createCatalogController({ catalogService }) {
  return {
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
