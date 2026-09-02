import { createHash } from 'node:crypto';
import { evaluateClaimStale } from './catalog-claim-stale-policy.mjs';

export function createCatalogClaimInspectionService({repository,activityRegistry,thresholds,now=()=>new Date().toISOString()}) {
  function listBlockers() {
    const allBlockers=repository.listBlockerRows().map(row=>{const current=evidenceFor(row);const evaluation=evaluateClaimStale({current,activity:activityRegistry.snapshot({campaignId:row.campaignId,queueId:row.queueId}),thresholds,now:now()});return {...row,staleDetermination:evaluation.determination,staleReasons:evaluation.reasons};});
    return {primaryBlocker:allBlockers[0] ?? null,allBlockers};
  }
  function inspect({campaignId,previousInspectionId=null}) {
    const row=repository.listBlockerRows().find(item=>item.campaignId===campaignId);
    if (!row) throw Object.assign(new Error('Catalog RPA claim blocker不存在。'),{code:'CATALOG_RPA_CLAIM_NOT_FOUND'});
    const current=evidenceFor(row),activity=activityRegistry.snapshot({campaignId:row.campaignId,queueId:row.queueId});
    const previousRecord=previousInspectionId?repository.getInspection(previousInspectionId):null;
    if(previousInspectionId&&!previousRecord)throw coded('CATALOG_RPA_INSPECTION_NOT_FOUND','前次Claim inspection不存在。');
    if(previousRecord&&(previousRecord.campaignId!==row.campaignId||previousRecord.queueId!==row.queueId||previousRecord.sourceId!==row.sourceId))throw coded('CATALOG_RPA_INSPECTION_SCOPE_MISMATCH','前后Claim inspection scope不一致。');
    if(previousRecord&&Date.parse(now())-Date.parse(previousRecord.inspectedAt)<thresholds.doubleInspectionIntervalMs)throw coded('CATALOG_RPA_INSPECTION_TOO_SOON','两次Claim inspection间隔不足。');
    const previous=previousRecord?.evidence??null;
    const evaluation=evaluateClaimStale({current,previous,activity,thresholds,now:now()});
    const evidence={...current,activity,thresholds};
    const stored=repository.insertInspection({...row,previousInspectionId,determination:evaluation.determination,
      evidenceSchemaVersion:'catalog-rpa-claim-evidence-v1',evidence,inspectedAt:now()});
    return {inspectionId:stored.id,...stored};
  }
  function recheckConfirmed({campaignId,firstInspectionId,secondInspectionId}){
    const first=repository.getInspection(firstInspectionId),second=repository.getInspection(secondInspectionId),row=repository.listBlockerRows().find(item=>item.campaignId===campaignId);
    if(!first||!second||!row||second.previousInspectionId!==first.id||second.determination!=='STALE_CONFIRMED')return {determination:'STALE_NOT_PROVEN',reasons:['CONFIRMED_INSPECTION_CHAIN_INVALID']};
    if([first,second].some(item=>item.campaignId!==row.campaignId||item.queueId!==row.queueId||item.sourceId!==row.sourceId))return {determination:'STALE_NOT_PROVEN',reasons:['INSPECTION_SCOPE_CHANGED']};
    const current=evidenceFor(row),activity=activityRegistry.snapshot({campaignId:row.campaignId,queueId:row.queueId});
    return {...evaluateClaimStale({current,previous:second.evidence,activity,thresholds,now:now()}),current,activity,first,second,row};
  }
  return {listBlockers,inspect,recheckConfirmed};
}

function evidenceFor(row){const checkpoint=row.checkpoint??{};return {...row,
  latestActivityAt:latest([row.heartbeatAt,row.queueUpdatedAt,row.sourceUpdatedAt,row.campaignUpdatedAt]),
  bindingHeartbeatAt:checkpoint.binding_heartbeat_at??null,
  progressFingerprint:hash({raw:checkpoint.raw_observation_count??0,unique:checkpoint.accepted_unique??checkpoint.campaign_new_unique_count??0,lastBatch:checkpoint.last_batch_id??checkpoint.last_batch??null}),
  bindingFingerprint:hash({generation:checkpoint.binding_generation??null,fingerprint:checkpoint.binding_fingerprint??checkpoint.context_fingerprint??null})};}
function latest(values){return values.filter(Boolean).sort().at(-1)??null;}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function coded(code,message){return Object.assign(new Error(message),{code});}
