import { createId } from '../../shared/ids.mjs';

export function createCatalogClaimRecoveryRepository(db,{now=()=>new Date().toISOString()}={}) {
  function listBlockerRows() {
    return db.prepare(`SELECT q.id queue_id,q.status queue_status,q.claim_token,q.claim_generation,q.claimed_at,
      q.heartbeat_at,q.checkpoint_json,q.updated_at queue_updated_at,
      c.id campaign_id,c.category_key,c.category_profile_version,c.campaign_type,c.status campaign_status,c.updated_at campaign_updated_at,
      s.id source_id,s.status source_status,s.updated_at source_updated_at,
      (SELECT MAX(r.finished_at IS NULL) FROM catalog_source_runs r WHERE r.source_id=s.id) has_open_source_run
      FROM catalog_rpa_queue q
      JOIN catalog_campaigns c ON c.id=q.campaign_id
      JOIN catalog_sources s ON s.id=q.source_id
      WHERE q.status IN ('opening','waiting_page_ready','capturing','waiting_load_more','manual_required')
      ORDER BY COALESCE(q.claimed_at,q.updated_at) DESC,q.id`).all().map(mapBlocker);
  }

  function insertInspection(record) {
    const id=record.id ?? createId('catalog_claim_inspection');
    const inspectedAt=record.inspectedAt ?? now();
    db.prepare(`INSERT INTO catalog_rpa_claim_inspections(
      id,campaign_id,category_key,category_profile_version,queue_id,source_id,previous_inspection_id,
      claim_token,claim_generation,determination,evidence_schema_version,evidence_json,inspected_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,record.campaignId,record.categoryKey,record.categoryProfileVersion,
      record.queueId,record.sourceId,record.previousInspectionId ?? null,record.claimToken ?? null,
      record.claimGeneration,record.determination,record.evidenceSchemaVersion,JSON.stringify(record.evidence),inspectedAt);
    return getInspection(id);
  }

  function getInspection(id) {
    const row=db.prepare('SELECT * FROM catalog_rpa_claim_inspections WHERE id=?').get(id);
    return row ? {id:row.id,campaignId:row.campaign_id,categoryKey:row.category_key,
      categoryProfileVersion:row.category_profile_version,queueId:row.queue_id,sourceId:row.source_id,
      previousInspectionId:row.previous_inspection_id,claimToken:row.claim_token,
      claimGeneration:Number(row.claim_generation),determination:row.determination,
      evidenceSchemaVersion:row.evidence_schema_version,evidence:JSON.parse(row.evidence_json),inspectedAt:row.inspected_at}:null;
  }
  function getTerminationAuditByRequestId(requestId){const row=db.prepare('SELECT * FROM catalog_rpa_claim_termination_audits WHERE request_id=?').get(requestId);return row?mapAudit(row):null;}
  function terminalizeClaim({campaignId,queueId,sourceId,firstInspectionId,secondInspectionId,claimToken,claimGeneration,requestId,evidence,hooks={}}){
    const campaign=db.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(campaignId),queue=db.prepare('SELECT * FROM catalog_rpa_queue WHERE id=?').get(queueId),source=db.prepare('SELECT * FROM catalog_sources WHERE id=?').get(sourceId),timestamp=now();
    const previous={campaign:campaign.status,queue:queue.status,source:source.status};
    db.prepare("UPDATE catalog_campaigns SET status='cancelled',finished_at=?,updated_at=? WHERE id=?").run(timestamp,timestamp,campaignId);hooks.afterCampaign?.();
    db.prepare("UPDATE catalog_rpa_queue SET status='cancelled',last_error_code='STALE_CLAIM_ENDED_BY_OPERATOR',updated_at=? WHERE id=?").run(timestamp,queueId);hooks.afterQueue?.();
    db.prepare("UPDATE catalog_sources SET status='cancelled',last_error_code='STALE_CLAIM_ENDED_BY_OPERATOR',updated_at=? WHERE id=?").run(timestamp,sourceId);hooks.afterSource?.();
    db.prepare("UPDATE catalog_source_runs SET stop_reason='STALE_CLAIM_ENDED_BY_OPERATOR',finished_at=? WHERE source_id=? AND finished_at IS NULL").run(timestamp,sourceId);hooks.afterSourceRuns?.();
    const id=createId('catalog_claim_termination');
    db.prepare(`INSERT INTO catalog_rpa_claim_termination_audits(id,request_id,campaign_id,category_key,category_profile_version,
      queue_id,source_id,first_inspection_id,second_inspection_id,claim_token,claim_generation,termination_reason,
      previous_statuses_json,new_statuses_json,stale_evidence_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,requestId,campaignId,campaign.category_key,campaign.category_profile_version,queueId,sourceId,firstInspectionId,secondInspectionId,
      claimToken,claimGeneration,'STALE_CLAIM_ENDED_BY_OPERATOR',JSON.stringify(previous),JSON.stringify({campaign:'cancelled',queue:'cancelled',source:'cancelled'}),JSON.stringify(evidence),timestamp);
    return getTerminationAuditByRequestId(requestId);
  }
  return {db,listBlockerRows,insertInspection,getInspection,getTerminationAuditByRequestId,terminalizeClaim};
}

function mapBlocker(row) {
  return {campaignId:row.campaign_id,categoryKey:row.category_key,categoryProfileVersion:row.category_profile_version,
    campaignType:row.campaign_type,campaignStatus:row.campaign_status,queueId:row.queue_id,
    queueStatus:row.queue_status,sourceId:row.source_id,sourceStatus:row.source_status,
    claimToken:row.claim_token,claimGeneration:Number(row.claim_generation),claimedAt:row.claimed_at,
    heartbeatAt:row.heartbeat_at,checkpoint:safeJson(row.checkpoint_json),queueUpdatedAt:row.queue_updated_at,
    campaignUpdatedAt:row.campaign_updated_at,sourceUpdatedAt:row.source_updated_at,hasOpenSourceRun:Boolean(row.has_open_source_run)};
}
function safeJson(value){try{return JSON.parse(value ?? '{}');}catch{return {};}}
function mapAudit(row){return{id:row.id,requestId:row.request_id,campaignId:row.campaign_id,categoryKey:row.category_key,categoryProfileVersion:row.category_profile_version,queueId:row.queue_id,sourceId:row.source_id,firstInspectionId:row.first_inspection_id,secondInspectionId:row.second_inspection_id,claimToken:row.claim_token,claimGeneration:Number(row.claim_generation),terminationReason:row.termination_reason,previousStatuses:safeJson(row.previous_statuses_json),newStatuses:safeJson(row.new_statuses_json),staleEvidence:safeJson(row.stale_evidence_json),createdAt:row.created_at};}
