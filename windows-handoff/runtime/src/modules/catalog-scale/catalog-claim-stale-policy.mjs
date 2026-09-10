export const CLAIM_RECOVERY_MINIMUMS=Object.freeze({heartbeatTimeoutMs:1800000,doubleInspectionIntervalMs:10000,bindingLeaseMs:30000,legacyNoHeartbeatMs:86400000});
const LIVE_FIELDS=Object.freeze(['liveWorker','liveBinding','inFlightCapture','inFlightQa','inFlightActivation','inFlightExcelExport','liveSourceRunner']);

export function resolveClaimRecoveryThresholds(config={}){
  const result={};for(const [key,floor] of Object.entries(CLAIM_RECOVERY_MINIMUMS)){const value=Number(config?.[key]??floor);if(!Number.isFinite(value)||value<floor)throw new Error(`catalog.claimRecovery.${key}不得低于${floor}`);result[key]=value;}return Object.freeze(result);
}

export function evaluateClaimStale({current,previous=null,activity,thresholds=CLAIM_RECOVERY_MINIMUMS,now=new Date().toISOString()}){
  const reasons=[];
  if(current?.campaignStatus!=='paused')return {determination:'NOT_ELIGIBLE',reasons:['PARENT_CAMPAIGN_NOT_PAUSED']};
  if(!['opening','waiting_page_ready','capturing','waiting_load_more','manual_required'].includes(current?.queueStatus))return {determination:'NOT_ELIGIBLE',reasons:['QUEUE_NOT_ACTIVE']};
  for(const field of LIVE_FIELDS){if(typeof activity?.[field]!=='boolean')reasons.push(`${field.toUpperCase()}_UNKNOWN`);else if(activity[field])reasons.push(`${field.toUpperCase()}_PRESENT`);}
  if(reasons.length)return {determination:'STALE_NOT_PROVEN',reasons};
  const nowMs=Date.parse(now),bindingMs=Date.parse(current.bindingHeartbeatAt??'');
  if(Number.isFinite(bindingMs)&&nowMs-bindingMs<thresholds.bindingLeaseMs)return {determination:'STALE_NOT_PROVEN',reasons:['BINDING_LEASE_LIVE']};
  const heartbeatMs=Date.parse(current.heartbeatAt??'');
  const inactive=Number.isFinite(heartbeatMs)?nowMs-heartbeatMs>=thresholds.heartbeatTimeoutMs:
    nowMs-Date.parse(current.latestActivityAt??'')>=thresholds.legacyNoHeartbeatMs;
  if(!inactive)return {determination:'STALE_NOT_PROVEN',reasons:['INACTIVITY_THRESHOLD_NOT_REACHED']};
  if(!previous)return {determination:'STALE_NOT_PROVEN',reasons:['SECOND_INSPECTION_REQUIRED']};
  if(!sameClaim(current,previous))return {determination:'STALE_NOT_PROVEN',reasons:['CLAIM_OR_PROGRESS_CHANGED']};
  return {determination:'STALE_CONFIRMED',reasons:['PAUSED','NO_LIVE_ACTIVITY','INACTIVITY_CONFIRMED','STABLE_DOUBLE_INSPECTION']};
}
function sameClaim(a,b){return a.campaignId===b.campaignId&&a.queueId===b.queueId&&a.sourceId===b.sourceId&&a.claimToken===b.claimToken&&Number(a.claimGeneration)===Number(b.claimGeneration)&&a.progressFingerprint===b.progressFingerprint&&a.bindingFingerprint===b.bindingFingerprint;}
