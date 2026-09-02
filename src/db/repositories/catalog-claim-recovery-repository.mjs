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
  return {db,listBlockerRows,insertInspection,getInspection};
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
