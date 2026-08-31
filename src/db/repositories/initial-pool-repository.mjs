import { createId } from '../../shared/ids.mjs';
import { CANDIDATE_HASH_VERSION,FIELD_SET_VERSION,NORMALIZATION_VERSION,canonicalJson,
  hashInitialCandidate } from '../../modules/catalog-scale/initial-candidate-hash.mjs';

export function createInitialPoolRepository(db, { now = () => new Date().toISOString() } = {}) {
  function getInitialEligibility(profile) {
    const scope = profile.membership_scope;
    const poolHistory = db.prepare(`SELECT id,status,category_profile_version FROM catalog_pool_versions
      WHERE category_key=? ORDER BY created_at,id`).all(profile.category_key);
    const activeMemberships = db.prepare(`SELECT id,product_id FROM catalog_memberships
      WHERE category_key=? AND site_country=? AND language=? AND currency=?
        AND primary_category=? AND subcategory=? AND sort_order=? AND active=1 ORDER BY id`).all(
      profile.category_key, scope.site_country, scope.language, scope.currency,
      scope.primary_category, scope.subcategory, scope.sort_order
    );
    const priorInitials = db.prepare(`SELECT id,status FROM catalog_campaigns
      WHERE category_key=? AND campaign_type='initial'
        AND status NOT IN ('completed','failed','cancelled') ORDER BY created_at,id`).all(profile.category_key);
    return {
      categoryKey: profile.category_key, categoryProfileVersion: profile.category_profile_version,
      poolHistoryCount: poolHistory.length, poolHistory,
      activeMembershipCount: activeMemberships.length, activeMembershipIds: activeMemberships.map(row => row.id),
      priorNonterminalInitialCount: priorInitials.length, priorInitials,
      eligible: poolHistory.length === 0 && activeMemberships.length === 0 && priorInitials.length === 0
    };
  }

  function recordInitialEligibilityAudit(campaign, eligibility) {
    db.prepare(`INSERT INTO catalog_initial_pool_eligibility_audits(
      campaign_id,category_key,category_profile_version,pool_history_count,active_membership_count,
      prior_nonterminal_initial_count,pool_history_json,active_membership_ids_json,eligible,checked_at
    ) VALUES(?,?,?,?,?,?,?,?,1,?)`).run(
      campaign.id, campaign.categoryKey, campaign.categoryProfileVersion, eligibility.poolHistoryCount,
      eligibility.activeMembershipCount, eligibility.priorNonterminalInitialCount,
      JSON.stringify(eligibility.poolHistory), JSON.stringify(eligibility.activeMembershipIds), now()
    );
  }

  function initializeCandidateState(campaign) {
    db.prepare(`INSERT INTO catalog_initial_pool_candidate_state(
      campaign_id,category_key,category_profile_version,current_revision,current_hash,candidate_count,
      candidate_hash_version,normalization_version,field_set_version,updated_at
    ) VALUES(?,?,?,0,?,0,'v1','v1','initial-pool-activation-v1',?)`).run(
      campaign.id, campaign.categoryKey, campaign.categoryProfileVersion, '0'.repeat(64), now()
    );
  }

  function findInitialByRequestId(requestId) {
    const row = db.prepare(`SELECT id FROM catalog_campaigns
      WHERE campaign_type='initial' AND json_extract(config_json,'$.operatorCreate.requestId')=?
      ORDER BY created_at,id LIMIT 1`).get(requestId);
    return row?.id ?? null;
  }

  function getCandidateState(campaignId) {
    return mapCandidateState(db.prepare('SELECT * FROM catalog_initial_pool_candidate_state WHERE campaign_id=?').get(campaignId));
  }

  function listCandidateItems(campaignId) {
    return db.prepare(`SELECT * FROM catalog_initial_pool_candidate_items WHERE campaign_id=?
      ORDER BY platform,goods_id`).all(campaignId).map(mapCandidateItem);
  }

  function applyCandidateItems(campaign,items) {
    if (campaign.campaignType!=='initial') throw new Error('Candidate ledger只接受Initial Campaign。');
    const select=db.prepare(`SELECT * FROM catalog_initial_pool_candidate_items
      WHERE campaign_id=? AND platform=? AND goods_id=?`);
    const nextSequence=()=>Number(db.prepare(`SELECT COALESCE(MAX(first_seen_sequence),0)+1 AS value
      FROM catalog_initial_pool_candidate_items WHERE campaign_id=?`).get(campaign.id).value);
    const insert=db.prepare(`INSERT INTO catalog_initial_pool_candidate_items(
      campaign_id,platform,goods_id,category_key,category_profile_version,source_id,first_batch_id,
      staging_product_id,activation_payload_json,row_hash,first_seen_sequence,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const update=db.prepare(`UPDATE catalog_initial_pool_candidate_items SET staging_product_id=?,
      activation_payload_json=?,row_hash=?,updated_at=? WHERE campaign_id=? AND platform=? AND goods_id=?`);
    for (const input of items) {
      const existing=select.get(campaign.id,String(input.platform),String(input.goods_id));
      const payload=existing ? { ...input,source_id:existing.source_id,first_batch_id:existing.first_batch_id }:input;
      const normalized=hashInitialCandidate([payload],{hashVersion:CANDIDATE_HASH_VERSION}).rows[0];
      const payloadJson=canonicalJson(normalized);
      const rowHash=hashInitialCandidate([normalized],{hashVersion:CANDIDATE_HASH_VERSION}).hash;
      if (!existing) insert.run(campaign.id,normalized.platform,normalized.goods_id,campaign.categoryKey,
        campaign.categoryProfileVersion,normalized.source_id,normalized.first_batch_id,input.staging_product_id ?? null,
        payloadJson,rowHash,nextSequence(),now(),now());
      else if (existing.row_hash!==rowHash) update.run(input.staging_product_id ?? existing.staging_product_id,
        payloadJson,rowHash,now(),campaign.id,normalized.platform,normalized.goods_id);
    }
    const candidates=listCandidateItems(campaign.id);
    const hashed=hashInitialCandidate(candidates.map(row=>row.activationPayload),{hashVersion:CANDIDATE_HASH_VERSION});
    const before=getCandidateState(campaign.id);
    const revision=before.currentHash===hashed.hash ? before.currentRevision:before.currentRevision+1;
    db.prepare(`UPDATE catalog_initial_pool_candidate_state SET current_revision=?,current_hash=?,candidate_count=?,
      candidate_hash_version=?,normalization_version=?,field_set_version=?,updated_at=? WHERE campaign_id=?`).run(
      revision,hashed.hash,hashed.count,CANDIDATE_HASH_VERSION,NORMALIZATION_VERSION,FIELD_SET_VERSION,now(),campaign.id);
    db.prepare(`UPDATE catalog_campaigns SET non_electronic_unique_count=?,updated_at=? WHERE id=?`)
      .run(hashed.count,now(),campaign.id);
    return getCandidateState(campaign.id);
  }

  function freezeQaCandidate({qaRunId,campaignId}) {
    const rows=listCandidateItems(campaignId);
    const insert=db.prepare(`INSERT INTO catalog_initial_pool_qa_candidate_items(
      qa_run_id,ordinal,platform,goods_id,category_key,category_profile_version,source_id,first_batch_id,
      staging_product_id,activation_payload_json,row_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    rows.forEach((row,index)=>insert.run(qaRunId,index+1,row.platform,row.goodsId,row.categoryKey,
      row.categoryProfileVersion,row.sourceId,row.firstBatchId,row.stagingProductId,
      canonicalJson(row.activationPayload),row.rowHash,now()));
    return rows.length;
  }

  function recordBatchContext({campaign,source,batchId,captureMode,pageUrl,pageContext,pageBinding}) {
    db.prepare(`INSERT INTO catalog_initial_pool_batch_contexts(
      campaign_id,source_id,batch_id,capture_mode,site_country,language,currency,category_key,
      category_profile_version,sort_order,page_url,binding_version,binding_fingerprint,page_health_status,
      dom_ready,network_ready,captcha_blocking,search_no_results,context_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'READY',1,1,0,0,?,?)`).run(
      campaign.id,source.id,String(batchId),captureMode,pageContext.siteCountry,pageContext.language,pageContext.currency,
      campaign.categoryKey,campaign.categoryProfileVersion,pageContext.sortOrder,pageUrl,pageBinding.binding_version,
      pageBinding.context_fingerprint,JSON.stringify({ pageContext,pageBinding }),now()
    );
  }

  function listBatchContexts(campaignId) {
    return db.prepare(`SELECT * FROM catalog_initial_pool_batch_contexts WHERE campaign_id=?
      ORDER BY created_at,source_id,batch_id`).all(campaignId).map(row=>({campaignId:row.campaign_id,
      sourceId:row.source_id,batchId:row.batch_id,captureMode:row.capture_mode,siteCountry:row.site_country,
      language:row.language,currency:row.currency,categoryKey:row.category_key,
      categoryProfileVersion:row.category_profile_version,sortOrder:row.sort_order,pageUrl:row.page_url,
      bindingVersion:row.binding_version,bindingFingerprint:row.binding_fingerprint,
      pageHealthStatus:row.page_health_status,domReady:Boolean(row.dom_ready),networkReady:Boolean(row.network_ready),
      captchaBlocking:Boolean(row.captcha_blocking),searchNoResults:Boolean(row.search_no_results)}));
  }

  function findQaByRequest(campaignId,requestId) {
    return mapQaRun(db.prepare(`SELECT * FROM catalog_initial_pool_qa_runs
      WHERE campaign_id=? AND request_id=?`).get(campaignId,requestId));
  }
  function createRunningQaRun({id,campaign,state,requestId}) {
    const timestamp=now();db.prepare(`INSERT INTO catalog_initial_pool_qa_runs(
      id,campaign_id,category_key,category_profile_version,request_id,status,candidate_count,candidate_revision,
      candidate_hash,candidate_hash_version,normalization_version,field_set_version,started_at,created_at
    ) VALUES(?,?,?,?,?,'RUNNING',?,?,?,?,?,?,?,?)`).run(id,campaign.id,campaign.categoryKey,
      campaign.categoryProfileVersion,requestId,state.candidateCount,state.currentRevision,state.currentHash,
      state.candidateHashVersion,state.normalizationVersion,state.fieldSetVersion,timestamp,timestamp);
    return getQaRun(id);
  }
  function getQaRun(id){return mapQaRun(db.prepare('SELECT * FROM catalog_initial_pool_qa_runs WHERE id=?').get(id));}
  function finalizeQaRun(id,result) {
    const status=result.passed?'PASSED':'FAILED';db.prepare(`UPDATE catalog_initial_pool_qa_runs SET
      status=?,mandatory_passed=?,checks_json=?,failure_codes_json=?,completed_at=?,duration_ms=? WHERE id=?`).run(
      status,result.passed?1:0,JSON.stringify(result.checks),JSON.stringify(result.failureCodes),now(),result.durationMs,id);
    const run=getQaRun(id);db.prepare('UPDATE catalog_campaigns SET qa_status=?,qa_summary_json=?,updated_at=? WHERE id=?').run(
      result.passed?'passed':'failed',JSON.stringify({initialQaRunId:id,status}),now(),run.campaignId);return getQaRun(id);
  }
  function getLatestQaRun(campaignId) {
    return mapQaRun(db.prepare(`SELECT * FROM catalog_initial_pool_qa_runs WHERE campaign_id=?
      ORDER BY created_at DESC,id DESC LIMIT 1`).get(campaignId));
  }
  function getLatestPassedQa(campaignId) {
    return mapQaRun(db.prepare(`SELECT * FROM catalog_initial_pool_qa_runs WHERE campaign_id=? AND status='PASSED'
      ORDER BY created_at DESC,id DESC LIMIT 1`).get(campaignId));
  }
  function listQaCandidateItems(qaRunId) {
    return db.prepare(`SELECT * FROM catalog_initial_pool_qa_candidate_items WHERE qa_run_id=? ORDER BY ordinal`)
      .all(qaRunId).map(row=>({qaRunId:row.qa_run_id,ordinal:Number(row.ordinal),platform:row.platform,
        goodsId:row.goods_id,categoryKey:row.category_key,categoryProfileVersion:row.category_profile_version,
        sourceId:row.source_id,firstBatchId:row.first_batch_id,stagingProductId:row.staging_product_id,
        activationPayload:JSON.parse(row.activation_payload_json),rowHash:row.row_hash}));
  }

  return { getInitialEligibility, recordInitialEligibilityAudit, initializeCandidateState,
    findInitialByRequestId, getCandidateState,listCandidateItems,applyCandidateItems,freezeQaCandidate,recordBatchContext,
    listBatchContexts,findQaByRequest,createRunningQaRun,getQaRun,finalizeQaRun,getLatestQaRun,getLatestPassedQa,listQaCandidateItems,
    createQaRunId: () => createId('initial_qa') };
}

function mapCandidateState(row) {
  return row ? { campaignId:row.campaign_id,categoryKey:row.category_key,
    categoryProfileVersion:row.category_profile_version,currentRevision:Number(row.current_revision),
    currentHash:row.current_hash,candidateCount:Number(row.candidate_count),
    candidateHashVersion:row.candidate_hash_version,normalizationVersion:row.normalization_version,
    fieldSetVersion:row.field_set_version,updatedAt:row.updated_at }:null;
}
function mapCandidateItem(row) {
  return { campaignId:row.campaign_id,platform:row.platform,goodsId:row.goods_id,categoryKey:row.category_key,
    categoryProfileVersion:row.category_profile_version,sourceId:row.source_id,firstBatchId:row.first_batch_id,
    stagingProductId:row.staging_product_id===null?null:Number(row.staging_product_id),
    activationPayload:JSON.parse(row.activation_payload_json),rowHash:row.row_hash,
    firstSeenSequence:Number(row.first_seen_sequence),createdAt:row.created_at,updatedAt:row.updated_at };
}
function mapQaRun(row) {
  return row?{id:row.id,campaignId:row.campaign_id,categoryKey:row.category_key,
    categoryProfileVersion:row.category_profile_version,requestId:row.request_id,status:row.status,
    candidateCount:Number(row.candidate_count),candidateRevision:Number(row.candidate_revision),candidateHash:row.candidate_hash,
    candidateHashVersion:row.candidate_hash_version,normalizationVersion:row.normalization_version,
    fieldSetVersion:row.field_set_version,mandatoryPassed:row.mandatory_passed===null?null:Boolean(row.mandatory_passed),
    checks:JSON.parse(row.checks_json),failureCodes:JSON.parse(row.failure_codes_json),startedAt:row.started_at,
    completedAt:row.completed_at,durationMs:row.duration_ms===null?null:Number(row.duration_ms),createdAt:row.created_at}:null;
}
