import { createId } from '../../shared/ids.mjs';

export function createCatalogCampaignRepository(db,{ now=() => new Date().toISOString() }={}) {
  function createCampaign(input) {
    const timestamp=now();
    const id=input.id ?? createId('catalog_campaign');
    db.prepare(`INSERT INTO catalog_campaigns(
      id,name,campaign_type,category_key,category_profile_version,target_gate,target_count,
      baseline_pool_count,status,config_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,input.name,input.campaignType,input.categoryKey,input.categoryProfileVersion,input.targetGate,
      input.targetCount,input.baselinePoolCount ?? 0,input.status ?? 'pending',JSON.stringify(input.config ?? {}),timestamp,timestamp
    );
    return getCampaign(id);
  }

  function getCampaign(id) { return mapCampaign(db.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(id)); }

  function transitionCampaign(id,status,{ qaStatus,qaSummary,finished=false }={}) {
    const timestamp=now();
    db.prepare(`UPDATE catalog_campaigns SET status=?,qa_status=COALESCE(?,qa_status),
      qa_summary_json=COALESCE(?,qa_summary_json),
      started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,
      finished_at=CASE WHEN ? THEN ? ELSE finished_at END,updated_at=? WHERE id=?`).run(
      status,qaStatus ?? null,qaSummary === undefined ? null:JSON.stringify(qaSummary),status,timestamp,
      finished ? 1:0,timestamp,timestamp,id
    );
    return getCampaign(id);
  }

  function createSource(campaign,input) {
    const timestamp=now();
    const id=input.id ?? createId('catalog_source');
    db.prepare(`INSERT INTO catalog_sources(
      id,campaign_id,category_key,source_key,source_type,level2,level3,search_keyword,
      navigation_hint_json,sort_order,priority,target_quota,status,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,campaign.id,campaign.categoryKey,input.sourceKey,input.sourceType,input.level2 ?? null,input.level3 ?? null,
      input.searchKeyword ?? null,JSON.stringify(input.navigationHint ?? {}),input.sortOrder,
      input.priority ?? 100,input.targetQuota ?? null,input.status ?? 'pending',timestamp,timestamp
    );
    db.prepare(`INSERT INTO catalog_rpa_queue(id,campaign_id,source_id,status,created_at,updated_at)
      VALUES(?,?,?,'pending',?,?)`).run(createId('catalog_rpa'),campaign.id,id,timestamp,timestamp);
    refreshCampaignCounts(campaign.id);
    return getSource(id);
  }

  function getSource(id) { return mapSource(db.prepare('SELECT * FROM catalog_sources WHERE id=?').get(id)); }

  function createSourceRun(sourceId,runNumber=1) {
    const source=getSource(sourceId);
    const id=createId('catalog_source_run');
    db.prepare(`INSERT INTO catalog_source_runs(id,campaign_id,source_id,run_number,started_at)
      VALUES(?,?,?,?,?)`).run(id,source.campaignId,source.id,runNumber,now());
    return db.prepare('SELECT * FROM catalog_source_runs WHERE id=?').get(id);
  }

  function registerBatch(input) {
    const id=input.id ?? createId('catalog_batch');
    const result=db.prepare(`INSERT INTO catalog_capture_batches(
      id,campaign_id,source_id,batch_id,page_url,page_title,captured_at,payload_hash,received_count,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id,source_id,batch_id) DO NOTHING`).run(
      id,input.campaignId,input.sourceId,input.batchId,input.pageUrl ?? null,input.pageTitle ?? null,
      input.capturedAt,input.payloadHash ?? null,input.receivedCount,now()
    );
    const row=getBatch(input.campaignId,input.sourceId,input.batchId);
    return { inserted:Number(result.changes)===1,batch:mapBatch(row) };
  }

  function getBatch(campaignId,sourceId,batchId) {
    return db.prepare(`SELECT * FROM catalog_capture_batches
      WHERE campaign_id=? AND source_id=? AND batch_id=?`).get(campaignId,sourceId,batchId);
  }

  function completeBatch(id,counts) {
    db.prepare(`UPDATE catalog_capture_batches SET staging_count=?,excluded_count=?,duplicate_count=? WHERE id=?`)
      .run(counts.stagingCount,counts.excludedCount,counts.duplicateCount,id);
    return mapBatch(db.prepare('SELECT * FROM catalog_capture_batches WHERE id=?').get(id));
  }

  function recordSourceObservation(input) {
    const result=db.prepare(`INSERT INTO catalog_product_source_observations(
      campaign_id,source_id,batch_id,platform,goods_id,screening_decision,observed_at,raw_json
    ) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id,source_id,batch_id,platform,goods_id) DO NOTHING`).run(
      input.campaignId,input.sourceId,input.batchId,input.platform ?? 'temu',input.goodsId,
      input.screeningDecision,input.observedAt,JSON.stringify(input.raw ?? {})
    );
    return Number(result.changes)===1;
  }

  function upsertStaging(campaign,source,batchId,product,screeningStatus) {
    const existing=db.prepare(`SELECT id,first_source_id AS firstSourceId FROM catalog_staging_products
      WHERE campaign_id=? AND platform=? AND goods_id=?`).get(campaign.id,product.platform,product.goodsId);
    const sequence=Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_staging_products WHERE campaign_id=?').get(campaign.id).count)+1;
    db.prepare(`INSERT INTO catalog_staging_products(
      campaign_id,category_key,platform,goods_id,first_source_id,latest_source_id,first_batch_id,
      first_seen_sequence,latest_title,latest_source_url,canonical_url,image_url,price_amount,currency,
      sales_count,rating,review_count,electronic_screening_status,business_eligible,reviewable,
      quality_status,raw_json,first_seen_at,last_seen_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id,platform,goods_id) DO UPDATE SET
      latest_source_id=excluded.latest_source_id,latest_title=COALESCE(excluded.latest_title,catalog_staging_products.latest_title),
      latest_source_url=COALESCE(excluded.latest_source_url,catalog_staging_products.latest_source_url),
      image_url=COALESCE(excluded.image_url,catalog_staging_products.image_url),
      price_amount=COALESCE(excluded.price_amount,catalog_staging_products.price_amount),
      currency=COALESCE(excluded.currency,catalog_staging_products.currency),
      sales_count=COALESCE(excluded.sales_count,catalog_staging_products.sales_count),
      rating=COALESCE(excluded.rating,catalog_staging_products.rating),
      review_count=COALESCE(excluded.review_count,catalog_staging_products.review_count),
      electronic_screening_status=CASE
        WHEN catalog_staging_products.electronic_screening_status='manual_review_required' OR excluded.electronic_screening_status='manual_review_required'
        THEN 'manual_review_required' ELSE 'passed' END,
      business_eligible=COALESCE(excluded.business_eligible,catalog_staging_products.business_eligible),
      reviewable=COALESCE(excluded.reviewable,catalog_staging_products.reviewable),
      raw_json=excluded.raw_json,last_seen_at=excluded.last_seen_at`).run(
      campaign.id,campaign.categoryKey,product.platform,product.goodsId,source.id,source.id,batchId,sequence,
      product.title ?? null,product.sourceUrl ?? null,product.canonicalUrl,product.imageUrl ?? null,
      product.priceAmount ?? null,product.currency ?? null,product.salesCount ?? null,product.rating ?? null,
      product.reviewCount ?? null,screeningStatus,nullableBoolean(product.businessEligible),nullableBoolean(product.reviewable),
      product.qualityStatus ?? 'pending',JSON.stringify(product.raw ?? product),product.capturedAt,product.capturedAt
    );
    return { inserted:!existing,sourceOverlap:Boolean(existing && existing.firstSourceId !== source.id) };
  }

  function recordExclusion(input) {
    const result=db.prepare(`INSERT INTO catalog_exclusion_observations(
      campaign_id,source_id,batch_id,goods_id,title,exclusion_code,exclusion_reason,
      classifier_version,confidence,detected_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id,source_id,batch_id,goods_id,exclusion_code) DO NOTHING`).run(
      input.campaignId,input.sourceId,input.batchId,input.goodsId ?? null,input.title ?? null,input.exclusionCode,
      input.exclusionReason,input.classifierVersion,input.confidence ?? null,input.detectedAt
    );
    return Number(result.changes)===1;
  }

  function hasCampaignExclusion(campaignId,goodsId) {
    return Boolean(db.prepare(`SELECT 1 FROM catalog_exclusion_observations
      WHERE campaign_id=? AND goods_id=? LIMIT 1`).get(campaignId,goodsId));
  }

  function removeStagingForExclusion(campaignId,goodsId) {
    return Number(db.prepare(`DELETE FROM catalog_staging_products WHERE campaign_id=? AND platform='temu' AND goods_id=?`).run(campaignId,goodsId).changes);
  }

  function refreshCampaignCounts(campaignId) {
    const timestamp=now();
    db.prepare(`UPDATE catalog_campaigns SET
      raw_observed_count=(SELECT COALESCE(SUM(received_count),0) FROM catalog_capture_batches WHERE campaign_id=?),
      electronic_excluded_count=(SELECT COUNT(DISTINCT goods_id) FROM catalog_exclusion_observations WHERE campaign_id=? AND goods_id IS NOT NULL),
      non_electronic_unique_count=(SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='passed'),
      business_eligible_count=(SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='passed' AND business_eligible=1),
      reviewable_unique_count=(SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='passed' AND reviewable=1),
      source_count=(SELECT COUNT(*) FROM catalog_sources WHERE campaign_id=?),
      completed_source_count=(SELECT COUNT(*) FROM catalog_sources WHERE campaign_id=? AND status='completed'),
      updated_at=? WHERE id=?`).run(campaignId,campaignId,campaignId,campaignId,campaignId,campaignId,campaignId,timestamp,campaignId);
    return getCampaign(campaignId);
  }

  function recordCampaignObservation(campaignId,item,status,details={}) {
    db.prepare(`INSERT INTO catalog_campaign_product_observations(
      campaign_id,product_id,platform,goods_id,observation_status,details_json,observed_at
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id,platform,goods_id) DO UPDATE SET
      product_id=COALESCE(excluded.product_id,catalog_campaign_product_observations.product_id),
      observation_status=excluded.observation_status,details_json=excluded.details_json,observed_at=excluded.observed_at`).run(
      campaignId,item.productId ?? null,item.platform ?? 'temu',String(item.goodsId),status,JSON.stringify(details),now()
    );
  }

  function activatePoolVersion(campaign,qaSummary={}) {
    const timestamp=now();
    db.prepare(`UPDATE catalog_pool_versions SET status='superseded',superseded_at=?,updated_at=?
      WHERE category_key=? AND status='active'`).run(timestamp,timestamp,campaign.categoryKey);
    const id=createId('catalog_pool');
    db.prepare(`INSERT INTO catalog_pool_versions(
      id,campaign_id,category_key,category_profile_version,product_count,non_electronic_unique_count,
      business_eligible_count,reviewable_unique_count,status,qa_summary_json,activated_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?, 'active',?,?,?,?)`).run(
      id,campaign.id,campaign.categoryKey,campaign.categoryProfileVersion,campaign.nonElectronicUniqueCount,
      campaign.nonElectronicUniqueCount,campaign.businessEligibleCount,campaign.reviewableUniqueCount,
      JSON.stringify(qaSummary),timestamp,timestamp,timestamp
    );
    db.prepare(`INSERT INTO catalog_pool_version_items(
      pool_version_id,staging_product_id,platform,goods_id,category_key,membership_status,created_at
    ) SELECT ?,id,platform,goods_id,category_key,'seen',? FROM catalog_staging_products
      WHERE campaign_id=? AND electronic_screening_status='passed'`).run(id,timestamp,campaign.id);
    return mapPoolVersion(db.prepare('SELECT * FROM catalog_pool_versions WHERE id=?').get(id));
  }

  function getRpaQueueForSource(sourceId) { return db.prepare('SELECT * FROM catalog_rpa_queue WHERE source_id=?').get(sourceId); }

  function getRpaQueue(id) { return mapRpaQueue(db.prepare('SELECT * FROM catalog_rpa_queue WHERE id=?').get(id)); }

  function getNextRpaQueue(campaignId) {
    return mapRpaQueue(db.prepare(`SELECT q.* FROM catalog_rpa_queue q
      JOIN catalog_sources s ON s.id=q.source_id
      WHERE q.campaign_id=? AND q.status='pending'
      ORDER BY s.priority,s.id LIMIT 1`).get(campaignId));
  }

  function listActiveRpaQueues() {
    return db.prepare(`SELECT * FROM catalog_rpa_queue WHERE status IN (
      'opening','waiting_page_ready','capturing','waiting_load_more','manual_required'
    ) ORDER BY claimed_at DESC,id`).all().map(mapRpaQueue);
  }

  function listRpaQueues(campaignId) {
    return db.prepare('SELECT * FROM catalog_rpa_queue WHERE campaign_id=? ORDER BY created_at,id').all(campaignId).map(mapRpaQueue);
  }

  function claimRpaQueue(id,claimToken) {
    const timestamp=now();
    const result=db.prepare(`UPDATE catalog_rpa_queue SET status='opening',claim_token=?,claimed_at=?,heartbeat_at=?,
      attempt_count=attempt_count+1,last_error_code=NULL,last_error_message=NULL,updated_at=?
      WHERE id=? AND status='pending'`).run(claimToken,timestamp,timestamp,timestamp,id);
    if (Number(result.changes)!==1) return null;
    const queue=getRpaQueue(id);
    db.prepare("UPDATE catalog_sources SET status='opening',updated_at=? WHERE id=?").run(timestamp,queue.sourceId);
    return getRpaQueue(id);
  }

  function transitionRpaQueue(id,status,{ checkpoint,errorCode=null,errorMessage=null,clearError=false }={}) {
    const timestamp=now();
    db.prepare(`UPDATE catalog_rpa_queue SET status=?,heartbeat_at=?,checkpoint_json=COALESCE(?,checkpoint_json),
      last_error_code=CASE WHEN ? THEN NULL ELSE COALESCE(?,last_error_code) END,
      last_error_message=CASE WHEN ? THEN NULL ELSE COALESCE(?,last_error_message) END,updated_at=? WHERE id=?`).run(
      status,timestamp,checkpoint===undefined ? null:JSON.stringify(checkpoint),clearError ? 1:0,errorCode,
      clearError ? 1:0,errorMessage,timestamp,id
    );
    return getRpaQueue(id);
  }

  function transitionSource(id,status,{ errorCode=null }={}) {
    db.prepare('UPDATE catalog_sources SET status=?,last_error_code=?,updated_at=? WHERE id=?').run(status,errorCode,now(),id);
    return getSource(id);
  }

  function finishSourceRun(sourceId,metrics={}) {
    const row=db.prepare(`SELECT id FROM catalog_source_runs WHERE source_id=? AND finished_at IS NULL
      ORDER BY run_number DESC LIMIT 1`).get(sourceId);
    if (!row) return null;
    db.prepare(`UPDATE catalog_source_runs SET raw_observation_count=?,source_unique_count=?,campaign_new_unique_count=?,
      campaign_overlap_count=?,eligible_new_count=?,load_more_count=?,scroll_rounds=?,stop_reason=?,finished_at=? WHERE id=?`).run(
      Number(metrics.rawObservationCount ?? 0),Number(metrics.sourceUniqueCount ?? 0),Number(metrics.campaignNewUniqueCount ?? 0),
      Number(metrics.campaignOverlapCount ?? 0),Number(metrics.eligibleNewCount ?? 0),Number(metrics.loadMoreCount ?? 0),
      Number(metrics.scrollRounds ?? 0),metrics.stopReason ?? null,now(),row.id
    );
    return db.prepare('SELECT * FROM catalog_source_runs WHERE id=?').get(row.id);
  }

  function listSourceContributions(campaignId) {
    return db.prepare(`SELECT s.id AS source_id,s.source_key,
      COUNT(DISTINCT o.goods_id) AS source_unique_count,
      COUNT(DISTINCT CASE WHEN first_seen.first_source_id=s.id THEN o.goods_id END) AS campaign_new_unique_count,
      COUNT(DISTINCT CASE WHEN overlap.goods_id IS NOT NULL THEN o.goods_id END) AS campaign_overlap_count,
      COUNT(DISTINCT CASE WHEN p.first_source_id=s.id AND p.electronic_screening_status='passed' THEN p.goods_id END) AS eligible_new_count
    FROM catalog_sources s
    LEFT JOIN catalog_product_source_observations o ON o.campaign_id=s.campaign_id AND o.source_id=s.id
    LEFT JOIN (
      SELECT ranked.campaign_id,ranked.goods_id,ranked.source_id AS first_source_id FROM (
        SELECT campaign_id,goods_id,source_id,id,
          ROW_NUMBER() OVER(PARTITION BY campaign_id,goods_id ORDER BY id) AS row_number
        FROM catalog_product_source_observations
      ) ranked WHERE ranked.row_number=1
    ) first_seen ON first_seen.campaign_id=o.campaign_id AND first_seen.goods_id=o.goods_id
    LEFT JOIN (
      SELECT campaign_id,goods_id FROM catalog_product_source_observations
      GROUP BY campaign_id,goods_id HAVING COUNT(DISTINCT source_id)>1
    ) overlap ON overlap.campaign_id=o.campaign_id AND overlap.goods_id=o.goods_id
    LEFT JOIN catalog_staging_products p ON p.campaign_id=s.campaign_id AND p.goods_id=o.goods_id
    WHERE s.campaign_id=? GROUP BY s.id,s.source_key ORDER BY s.priority,s.id`).all(campaignId).map(row => ({
      sourceId:row.source_id,sourceKey:row.source_key,sourceUniqueCount:Number(row.source_unique_count),
      campaignNewUniqueCount:Number(row.campaign_new_unique_count),campaignOverlapCount:Number(row.campaign_overlap_count),
      eligibleNewCount:Number(row.eligible_new_count)
    }));
  }

  return { createCampaign,getCampaign,transitionCampaign,createSource,getSource,createSourceRun,registerBatch,
    completeBatch,recordSourceObservation,upsertStaging,recordExclusion,hasCampaignExclusion,removeStagingForExclusion,refreshCampaignCounts,recordCampaignObservation,
    activatePoolVersion,getRpaQueueForSource,getRpaQueue,getNextRpaQueue,listActiveRpaQueues,listRpaQueues,claimRpaQueue,
    transitionRpaQueue,transitionSource,finishSourceRun,listSourceContributions };
}

function mapCampaign(row) {
  if (!row) return null;
  return { id:row.id,name:row.name,campaignType:row.campaign_type,categoryKey:row.category_key,
    categoryProfileVersion:row.category_profile_version,targetGate:row.target_gate,targetCount:Number(row.target_count),
    baselinePoolCount:Number(row.baseline_pool_count),status:row.status,qaStatus:row.qa_status,
    rawObservedCount:Number(row.raw_observed_count),electronicExcludedCount:Number(row.electronic_excluded_count),
    nonElectronicUniqueCount:Number(row.non_electronic_unique_count),businessEligibleCount:Number(row.business_eligible_count),
    reviewableUniqueCount:Number(row.reviewable_unique_count),sourceCount:Number(row.source_count),
    completedSourceCount:Number(row.completed_source_count),config:parseJson(row.config_json),qaSummary:parseJson(row.qa_summary_json),
    startedAt:row.started_at,finishedAt:row.finished_at,createdAt:row.created_at,updatedAt:row.updated_at };
}
function mapSource(row) { return row ? { id:row.id,campaignId:row.campaign_id,categoryKey:row.category_key,sourceKey:row.source_key,
  sourceType:row.source_type,sortOrder:row.sort_order,priority:Number(row.priority),targetQuota:row.target_quota===null?null:Number(row.target_quota),
  status:row.status,navigationHint:parseJson(row.navigation_hint_json),createdAt:row.created_at,updatedAt:row.updated_at }:null; }
function mapBatch(row) { return row ? { id:row.id,campaignId:row.campaign_id,sourceId:row.source_id,batchId:row.batch_id,
  payloadHash:row.payload_hash,receivedCount:Number(row.received_count),stagingCount:Number(row.staging_count),
  excludedCount:Number(row.excluded_count),duplicateCount:Number(row.duplicate_count),capturedAt:row.captured_at }:null; }
function mapPoolVersion(row) { return row ? { id:row.id,campaignId:row.campaign_id,categoryKey:row.category_key,
  productCount:Number(row.product_count),nonElectronicUniqueCount:Number(row.non_electronic_unique_count),status:row.status,
  activatedAt:row.activated_at }:null; }
function mapRpaQueue(row) { return row ? { id:row.id,campaignId:row.campaign_id,sourceId:row.source_id,status:row.status,
  claimToken:row.claim_token,claimedAt:row.claimed_at,heartbeatAt:row.heartbeat_at,checkpoint:parseJson(row.checkpoint_json) ?? {},
  attemptCount:Number(row.attempt_count),lastErrorCode:row.last_error_code,lastErrorMessage:row.last_error_message,
  createdAt:row.created_at,updatedAt:row.updated_at }:null; }
function nullableBoolean(value) { return value===undefined || value===null ? null:value ? 1:0; }
function parseJson(value) { try { return value ? JSON.parse(value):null; } catch { return null; } }
