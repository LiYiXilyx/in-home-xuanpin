export function createCatalogClaimInspectionService({repository,activityRegistry,thresholds,now=()=>new Date().toISOString()}) {
  function listBlockers() {
    const allBlockers=repository.listBlockerRows().map(row=>({...row,staleDetermination:'STALE_NOT_PROVEN'}));
    return {primaryBlocker:allBlockers[0] ?? null,allBlockers};
  }
  function inspect({campaignId,previousInspectionId=null}) {
    const row=repository.listBlockerRows().find(item=>item.campaignId===campaignId);
    if (!row) throw Object.assign(new Error('Catalog RPA claim blocker不存在。'),{code:'CATALOG_RPA_CLAIM_NOT_FOUND'});
    const evidence={...row,activity:activityRegistry.snapshot({campaignId:row.campaignId,queueId:row.queueId}),thresholds};
    const stored=repository.insertInspection({...row,previousInspectionId,determination:'STALE_NOT_PROVEN',
      evidenceSchemaVersion:'catalog-rpa-claim-evidence-v1',evidence,inspectedAt:now()});
    return {inspectionId:stored.id,...stored};
  }
  return {listBlockers,inspect};
}
