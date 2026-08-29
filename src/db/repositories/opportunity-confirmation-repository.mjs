import { createId,stableId } from '../../shared/ids.mjs';

export const OPPORTUNITY_DECISIONS=Object.freeze(['approved','rejected','needs_more_evidence']);

export function createOpportunityConfirmationRepository(db,{ now=()=>new Date().toISOString() }={}) {
  function getSnapshot(id){return db.prepare('SELECT * FROM opportunity_analysis_snapshots WHERE id=?').get(id)??null;}
  function getCandidateById(id){return db.prepare('SELECT * FROM opportunity_product_candidates WHERE id=?').get(id)??null;}
  function getConfirmation(snapshotId,candidateId){return mapConfirmation(db.prepare('SELECT * FROM opportunity_confirmations WHERE snapshot_id=? AND candidate_id=?').get(snapshotId,candidateId));}
  function listCandidates(snapshotId){return db.prepare(`SELECT c.id candidate_id,c.snapshot_id,c.platform,c.goods_id,c.product_type,c.tier,c.candidate_rank,
      c.product_score,c.estimated_gmv,c.opportunity_reasons_json,c.major_risks_json,c.next_validation_action,c.manual_review_required,
      i.title,i.level1_scene,i.level3_segment,i.price_amount,i.sales_count,i.rating,i.review_count,i.logistics_type,i.fitment_type,i.ip_risk,i.warning_codes_json,
      m.opportunity_score segment_opportunity_score,m.top3_sales_share,m.risk_level segment_risk_level,
      x.confirmation_id,x.decision,x.reason,x.reviewed_by,x.reviewed_at,x.created_at confirmation_created_at,x.updated_at confirmation_updated_at
    FROM opportunity_product_candidates c
    LEFT JOIN opportunity_snapshot_items i ON i.snapshot_id=c.snapshot_id AND i.platform=c.platform AND i.goods_id=c.goods_id
    LEFT JOIN opportunity_segment_metrics m ON m.snapshot_id=c.snapshot_id AND m.product_type=c.product_type
    LEFT JOIN opportunity_confirmations x ON x.snapshot_id=c.snapshot_id AND x.candidate_id=c.id
    WHERE c.snapshot_id=? ORDER BY c.candidate_rank,c.id`).all(snapshotId).map(mapCandidate);}
  function saveConfirmation({snapshotId,candidateId,platform,goodsId,decision,reason,reviewedBy,reviewedAt}){
    const existing=getConfirmation(snapshotId,candidateId);const timestamp=now();
    if(existing&&existing.decision===decision&&existing.reason===reason&&existing.reviewedBy===reviewedBy)return {...existing,changed:false,idempotent:true};
    const confirmationId=existing?.confirmationId??stableId('opportunity_confirmation',snapshotId,candidateId);
    if(existing)db.prepare(`UPDATE opportunity_confirmations SET decision=?,reason=?,reviewed_by=?,reviewed_at=?,updated_at=?
      WHERE confirmation_id=?`).run(decision,reason,reviewedBy,reviewedAt,timestamp,confirmationId);
    else db.prepare(`INSERT INTO opportunity_confirmations(confirmation_id,snapshot_id,candidate_id,platform,goods_id,decision,reason,reviewed_by,reviewed_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(confirmationId,snapshotId,candidateId,platform,goodsId,decision,reason,reviewedBy,reviewedAt,timestamp,timestamp);
    db.prepare(`INSERT INTO opportunity_confirmation_events(event_id,confirmation_id,snapshot_id,candidate_id,platform,goods_id,previous_decision,decision,reason,reviewed_by,reviewed_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(createId('opportunity_confirmation_event'),confirmationId,snapshotId,candidateId,platform,goodsId,existing?.decision??null,decision,reason,reviewedBy,reviewedAt,timestamp);
    return {...getConfirmation(snapshotId,candidateId),changed:true,idempotent:false,previousDecision:existing?.decision??null};
  }
  function listEvents(snapshotId,candidateId){return db.prepare(`SELECT * FROM opportunity_confirmation_events WHERE snapshot_id=? AND candidate_id=?
    ORDER BY created_at,event_id`).all(snapshotId,candidateId).map(mapEvent);}
  function counts(snapshotId){const rows=db.prepare(`SELECT COALESCE(x.decision,'unconfirmed') state,COUNT(*) count
    FROM opportunity_product_candidates c LEFT JOIN opportunity_confirmations x ON x.snapshot_id=c.snapshot_id AND x.candidate_id=c.id
    WHERE c.snapshot_id=? GROUP BY COALESCE(x.decision,'unconfirmed')`).all(snapshotId);const result={approved:0,rejected:0,needs_more_evidence:0,unconfirmed:0};for(const row of rows)result[row.state]=Number(row.count);return result;}
  return {getSnapshot,getCandidateById,getConfirmation,listCandidates,saveConfirmation,listEvents,counts};
}

function mapConfirmation(r){return r?{confirmationId:r.confirmation_id,snapshotId:r.snapshot_id,candidateId:Number(r.candidate_id),platform:r.platform,goodsId:String(r.goods_id),decision:r.decision,reason:r.reason,reviewedBy:r.reviewed_by,reviewedAt:r.reviewed_at,createdAt:r.created_at,updatedAt:r.updated_at}:null;}
function mapEvent(r){return {eventId:r.event_id,confirmationId:r.confirmation_id,snapshotId:r.snapshot_id,candidateId:Number(r.candidate_id),platform:r.platform,goodsId:String(r.goods_id),previousDecision:r.previous_decision,decision:r.decision,reason:r.reason,reviewedBy:r.reviewed_by,reviewedAt:r.reviewed_at,createdAt:r.created_at};}
function mapCandidate(r){return {candidateId:Number(r.candidate_id),snapshotId:r.snapshot_id,platform:r.platform,goodsId:String(r.goods_id),title:r.title??null,subcategory:r.level3_segment??r.product_type??null,level1Scene:r.level1_scene??null,productType:r.product_type,productOpportunityScore:Number(r.product_score),segmentOpportunityScore:num(r.segment_opportunity_score),price:num(r.price_amount),sales:num(r.sales_count),rating:num(r.rating),reviewCount:num(r.review_count),estimatedGmv:Number(r.estimated_gmv),top3SalesShare:num(r.top3_sales_share),top3Signal:r.top3_sales_share===null||r.top3_sales_share===undefined?null:Number(r.top3_sales_share)>=0.65,logistics:r.logistics_type??null,fitment:r.fitment_type??null,ipRisk:r.ip_risk??null,segmentRiskLevel:r.segment_risk_level??null,tier:r.tier,majorRisks:parse(r.major_risks_json,[]),warningCodes:parse(r.warning_codes_json,[]),opportunityReasons:parse(r.opportunity_reasons_json,[]),manualReviewRequired:Boolean(r.manual_review_required),recommendedHumanAction:r.next_validation_action??null,confirmationState:r.decision??'unconfirmed',confirmation:r.confirmation_id?{confirmationId:r.confirmation_id,decision:r.decision,reason:r.reason,reviewedBy:r.reviewed_by,reviewedAt:r.reviewed_at,createdAt:r.confirmation_created_at,updatedAt:r.confirmation_updated_at}:null};}
function parse(v,f){try{return v?JSON.parse(v):f;}catch{return f;}}
function num(v){return v===null||v===undefined?null:Number(v);}
