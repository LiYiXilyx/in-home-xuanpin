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
    const previous=previousInspectionId?repository.getInspection(previousInspectionId)?.evidence:null;
    const evaluation=evaluateClaimStale({current,previous,activity,thresholds,now:now()});
    const evidence={...current,activity,thresholds};
    const stored=repository.insertInspection({...row,previousInspectionId,determination:evaluation.determination,
      evidenceSchemaVersion:'catalog-rpa-claim-evidence-v1',evidence,inspectedAt:now()});
    return {inspectionId:stored.id,...stored};
  }
  return {listBlockers,inspect};
}

function evidenceFor(row){const checkpoint=row.checkpoint??{};return {...row,
  latestActivityAt:latest([row.heartbeatAt,row.queueUpdatedAt,row.sourceUpdatedAt,row.campaignUpdatedAt]),
  bindingHeartbeatAt:checkpoint.binding_heartbeat_at??null,
  progressFingerprint:hash({raw:checkpoint.raw_observation_count??0,unique:checkpoint.campaign_new_unique_count??0,lastBatch:checkpoint.last_batch_id??null}),
  bindingFingerprint:hash({generation:checkpoint.binding_generation??null,fingerprint:checkpoint.binding_fingerprint??checkpoint.context_fingerprint??null})};}
function latest(values){return values.filter(Boolean).sort().at(-1)??null;}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
