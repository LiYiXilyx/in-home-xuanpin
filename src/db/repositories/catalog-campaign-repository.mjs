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

  function setCampaignBrowserContext(id,{ profileName=null,profileDirectory=null,controlMode=null }={}) {
    db.prepare(`UPDATE catalog_campaigns SET browser_profile_name=?,browser_profile_directory=?,
      browser_control_mode=?,updated_at=? WHERE id=?`).run(profileName,profileDirectory,controlMode,now(),id);
    return getCampaign(id);
  }

  function captureCampaignBaseline(campaignId) {
    const timestamp=now();
    db.prepare(`INSERT INTO catalog_campaign_baseline_items(
      campaign_id,product_id,platform,goods_id,membership_id,captured_at
    ) SELECT ?,p.id,p.platform,p.external_product_id,m.id,?
      FROM products p
      JOIN catalog_memberships m ON m.product_id=p.id AND m.active=1
      WHERE m.id=(SELECT m2.id FROM catalog_memberships m2
        WHERE m2.product_id=p.id AND m2.active=1 ORDER BY m2.last_seen_at DESC,m2.id DESC LIMIT 1)
      ON CONFLICT(campaign_id,platform,goods_id) DO NOTHING`).run(campaignId,timestamp);
    const count=Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_campaign_baseline_items WHERE campaign_id=?').get(campaignId).count);
    db.prepare('UPDATE catalog_campaigns SET baseline_pool_count=?,updated_at=? WHERE id=?').run(count,timestamp,campaignId);
    return count;
  }

  function isCampaignBaselineItem(campaignId,platform,goodsId) {
    return Boolean(db.prepare(`SELECT 1 FROM catalog_campaign_baseline_items
      WHERE campaign_id=? AND platform=? AND goods_id=? LIMIT 1`).get(campaignId,platform,goodsId));
  }

  function hasCampaignStagingItem(campaignId,platform,goodsId) {
    return Boolean(db.prepare(`SELECT 1 FROM catalog_staging_products
      WHERE campaign_id=? AND platform=? AND goods_id=? LIMIT 1`).get(campaignId,platform,goodsId));
  }

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
      non_electronic_unique_count=CASE WHEN campaign_type='expansion' THEN
        (SELECT COUNT(*) FROM catalog_campaign_baseline_items WHERE campaign_id=?) +
        (SELECT COUNT(*) FROM catalog_staging_products s WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
          AND NOT EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b
            WHERE b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id))
        ELSE (SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='passed') END,
      business_eligible_count=(SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='passed' AND business_eligible=1),
      reviewable_unique_count=(SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='passed' AND reviewable=1),
      source_count=(SELECT COUNT(*) FROM catalog_sources WHERE campaign_id=?),
      completed_source_count=(SELECT COUNT(*) FROM catalog_sources WHERE campaign_id=? AND status='completed'),
      updated_at=? WHERE id=?`).run(campaignId,campaignId,campaignId,campaignId,campaignId,campaignId,campaignId,campaignId,campaignId,timestamp,campaignId);
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

  function recordNavigationRisk(campaignId,input) {
    const timestamp=now();
    db.prepare(`INSERT INTO catalog_navigation_risk_observations(
      campaign_id,platform,goods_id,historical_url_status,fresh_navigation_status,
      category_card_available,search_context_mismatch,navigation_not_resolved,evidence_json,observed_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id,platform,goods_id) DO UPDATE SET
      historical_url_status=excluded.historical_url_status,
      fresh_navigation_status=excluded.fresh_navigation_status,
      category_card_available=excluded.category_card_available,
      search_context_mismatch=excluded.search_context_mismatch,
      navigation_not_resolved=excluded.navigation_not_resolved,
      evidence_json=excluded.evidence_json,observed_at=excluded.observed_at,updated_at=excluded.updated_at`).run(
      campaignId,input.platform ?? 'temu',String(input.goodsId),input.historicalUrlStatus ?? 'not_checked',
      input.freshNavigationStatus ?? 'not_checked',input.categoryCardAvailable ? 1:0,
      input.searchContextMismatch ? 1:0,input.navigationNotResolved ? 1:0,
      JSON.stringify(input.evidence ?? {}),input.observedAt ?? timestamp,timestamp
    );
  }

  function getRefreshComparison(campaignId) {
    const row=db.prepare(`SELECT
      (SELECT COUNT(*) FROM catalog_campaign_baseline_items WHERE campaign_id=?) AS old_active_count,
      (SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='passed') AS new_observed_unique_count,
      (SELECT COUNT(*) FROM catalog_campaign_baseline_items b JOIN catalog_staging_products s
        ON s.campaign_id=b.campaign_id AND s.platform=b.platform AND s.goods_id=b.goods_id
        WHERE b.campaign_id=? AND s.electronic_screening_status='passed') AS intersection_count,
      (SELECT COUNT(*) FROM catalog_staging_products s LEFT JOIN catalog_campaign_baseline_items b
        ON b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id
        WHERE s.campaign_id=? AND s.electronic_screening_status='passed' AND b.id IS NULL) AS new_goods_count,
      (SELECT COUNT(*) FROM catalog_campaign_baseline_items b LEFT JOIN catalog_staging_products s
        ON s.campaign_id=b.campaign_id AND s.platform=b.platform AND s.goods_id=b.goods_id
          AND s.electronic_screening_status='passed'
        WHERE b.campaign_id=? AND s.id IS NULL) AS not_seen_count`).get(campaignId,campaignId,campaignId,campaignId,campaignId);
    return Object.fromEntries(Object.entries(row).map(([key,value]) => [key,Number(value)]));
  }

  function getNavigationRiskMetrics(campaignId) {
    const row=db.prepare(`SELECT
      SUM(CASE WHEN historical_url_status='available' THEN 1 ELSE 0 END) AS historical_url_available_count,
      SUM(CASE WHEN historical_url_status='sold_out' THEN 1 ELSE 0 END) AS historical_url_sold_out_count,
      SUM(CASE WHEN fresh_navigation_status='recovered' THEN 1 ELSE 0 END) AS fresh_navigation_recovered_count,
      SUM(category_card_available) AS category_card_available_count,
      SUM(search_context_mismatch) AS search_context_mismatch_count,
      SUM(navigation_not_resolved) AS navigation_not_resolved_count
      FROM catalog_navigation_risk_observations WHERE campaign_id=?`).get(campaignId);
    return Object.fromEntries(Object.entries(row).map(([key,value]) => [key,Number(value ?? 0)]));
  }

  function getQualityMetrics(campaignId) {
    const row=db.prepare(`SELECT COUNT(*) AS total,
      COUNT(DISTINCT goods_id) AS distinct_goods,
      SUM(CASE WHEN latest_title IS NOT NULL AND TRIM(latest_title)<>'' THEN 1 ELSE 0 END) AS title_count,
      SUM(CASE WHEN price_amount IS NOT NULL THEN 1 ELSE 0 END) AS price_count,
      SUM(CASE WHEN image_url IS NOT NULL AND TRIM(image_url)<>'' THEN 1 ELSE 0 END) AS image_count,
      SUM(CASE WHEN sales_count IS NOT NULL THEN 1 ELSE 0 END) AS sales_count,
      SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) AS rating_count,
      SUM(CASE WHEN review_count IS NOT NULL THEN 1 ELSE 0 END) AS review_count_count,
      SUM(CASE WHEN electronic_screening_status='manual_review_required' THEN 1 ELSE 0 END) AS manual_review_count
      FROM catalog_staging_products WHERE campaign_id=?`).get(campaignId);
    const total=Number(row.total);
    const coverage=value => total ? Number(value)/total:0;
    return { total,duplicateGoodsIdCount:total-Number(row.distinct_goods),manualReviewCount:Number(row.manual_review_count),
      titleCoverage:coverage(row.title_count),priceCoverage:coverage(row.price_count),imageCoverage:coverage(row.image_count),
      salesCoverage:coverage(row.sales_count),ratingCoverage:coverage(row.rating_count),reviewCountCoverage:coverage(row.review_count_count),
      electronicInStagingCount:Number(db.prepare(`SELECT COUNT(*) AS count FROM catalog_staging_products s
        WHERE s.campaign_id=? AND EXISTS(SELECT 1 FROM catalog_exclusion_observations e
          WHERE e.campaign_id=s.campaign_id AND e.goods_id=s.goods_id)`).get(campaignId).count) };
  }

  function getExpansionComparison(campaignId) {
    const campaign=getCampaign(campaignId);
    const row=db.prepare(`SELECT
      (SELECT COUNT(*) FROM catalog_campaign_baseline_items WHERE campaign_id=?) AS baseline_count,
      (SELECT COUNT(*) FROM catalog_staging_products s WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
        AND NOT EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b
          WHERE b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id)) AS new_non_electronic_count,
      (SELECT COUNT(*) FROM catalog_staging_products s WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
        AND EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b
          WHERE b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id)) AS baseline_overlap_count,
      (SELECT COUNT(*) FROM catalog_staging_products WHERE campaign_id=? AND electronic_screening_status='manual_review_required') AS manual_review_count
    `).get(campaignId,campaignId,campaignId,campaignId);
    const baselineCount=Number(row.baseline_count);const newCount=Number(row.new_non_electronic_count);
    return { baselineCount,targetCount:campaign.targetCount,newUniqueNeeded:Math.max(0,campaign.targetCount-baselineCount),
      newNonElectronicCount:newCount,activeCandidateCount:baselineCount+newCount,
      baselineOverlapCount:Number(row.baseline_overlap_count),manualReviewCount:Number(row.manual_review_count) };
  }

  function getExpansionQualityMetrics(campaignId) {
    const row=db.prepare(`WITH combined AS (
      SELECT i.platform,i.goods_id,s.latest_title,s.price_amount,s.image_url,s.sales_count,s.rating,s.review_count
      FROM catalog_pool_versions v JOIN catalog_pool_version_items i ON i.pool_version_id=v.id
      JOIN catalog_staging_products s ON s.id=i.staging_product_id
      WHERE v.category_key=(SELECT category_key FROM catalog_campaigns WHERE id=?) AND v.status='active'
      UNION ALL
      SELECT s.platform,s.goods_id,s.latest_title,s.price_amount,s.image_url,s.sales_count,s.rating,s.review_count
      FROM catalog_staging_products s WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
        AND NOT EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b
          WHERE b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id)
    ) SELECT COUNT(*) AS total,COUNT(DISTINCT platform || CHAR(31) || goods_id) AS distinct_goods,
      SUM(CASE WHEN latest_title IS NOT NULL AND TRIM(latest_title)<>'' THEN 1 ELSE 0 END) AS title_count,
      SUM(CASE WHEN price_amount IS NOT NULL THEN 1 ELSE 0 END) AS price_count,
      SUM(CASE WHEN image_url IS NOT NULL AND TRIM(image_url)<>'' THEN 1 ELSE 0 END) AS image_count,
      SUM(CASE WHEN sales_count IS NOT NULL THEN 1 ELSE 0 END) AS sales_count,
      SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) AS rating_count,
      SUM(CASE WHEN review_count IS NOT NULL THEN 1 ELSE 0 END) AS review_count_count FROM combined`).get(campaignId,campaignId);
    const total=Number(row.total);const coverage=value => total ? Number(value)/total:0;
    const electronicInCandidateCount=Number(db.prepare(`SELECT COUNT(*) AS count FROM catalog_staging_products s
      WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
        AND EXISTS(SELECT 1 FROM catalog_exclusion_observations e WHERE e.campaign_id=s.campaign_id AND e.goods_id=s.goods_id)`).get(campaignId).count);
    const manualReviewCount=Number(db.prepare(`SELECT COUNT(*) AS count FROM catalog_staging_products
      WHERE campaign_id=? AND electronic_screening_status='manual_review_required'`).get(campaignId).count);
    return { total,duplicateGoodsIdCount:total-Number(row.distinct_goods),electronicInCandidateCount,manualReviewCount,
      titleCoverage:coverage(row.title_count),priceCoverage:coverage(row.price_count),imageCoverage:coverage(row.image_count),
      salesCoverage:coverage(row.sales_count),ratingCoverage:coverage(row.rating_count),reviewCountCoverage:coverage(row.review_count_count) };
  }

  function materializeRefresh(campaign) {
    const existing=db.prepare('SELECT * FROM catalog_refresh_materializations WHERE campaign_id=?').get(campaign.id);
    if (existing) return mapMaterialization(existing);
    const profile=campaign.config.categoryProfile;
    const timestamp=now();
    const before=coreCounts(db);
    const jobId=createId('catalog_refresh_job');
    db.prepare(`INSERT INTO crawl_jobs(
      id,job_type,mode,site_country,language,currency,primary_category,subcategory,sort_order,target_count,
      status,checkpoint_json,config_json,total_items,processed_items,success_items,failed_items,
      discovered_count,stored_count,error_count,resume_count,requested_at,started_at,heartbeat_at,
      updated_at,finished_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      jobId,'catalog','catalog_scale_refresh',profile.site_country,profile.language,profile.currency,
      profile.navigation?.breadcrumbs?.[0] ?? 'Automotive',profile.display_name,profile.sort_order,campaign.targetCount,
      'completed','{}',JSON.stringify({ campaignId:campaign.id,categoryKey:campaign.categoryKey }),
      campaign.nonElectronicUniqueCount,campaign.nonElectronicUniqueCount,campaign.nonElectronicUniqueCount,0,
      campaign.nonElectronicUniqueCount,campaign.nonElectronicUniqueCount,0,0,
      timestamp,timestamp,timestamp,timestamp,timestamp,timestamp
    );
    const rows=db.prepare(`SELECT * FROM catalog_staging_products
      WHERE campaign_id=? AND electronic_screening_status='passed' ORDER BY first_seen_sequence`).all(campaign.id);
    let productsInserted=0,membershipsInserted=0,snapshotsInserted=0;
    for (const row of rows) {
      let product=db.prepare('SELECT id FROM products WHERE platform=? AND external_product_id=?').get(row.platform,row.goods_id);
      if (!product) {
        const inserted=db.prepare(`INSERT INTO products(platform,external_product_id,source_url,canonical_url,source_domain,title,status,
          first_seen_at,last_seen_at,raw_identity_json) VALUES(?,?,?,?,? ,?,'active',?,?,?)`).run(
          row.platform,row.goods_id,row.latest_source_url,row.canonical_url,'www.temu.com',row.latest_title,
          row.first_seen_at,row.last_seen_at,JSON.stringify({ platform:row.platform,goods_id:row.goods_id })
        );
        product={ id:Number(inserted.lastInsertRowid) };productsInserted+=1;
      } else {
        db.prepare(`UPDATE products SET source_url=COALESCE(?,source_url),canonical_url=?,title=COALESCE(?,title),
          last_seen_at=? WHERE id=?`).run(row.latest_source_url,row.canonical_url,row.latest_title,row.last_seen_at,product.id);
      }
      const snapshot=db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title,price_amount,currency,
        sales_count,rating,review_count,listing_rank,image_url,availability,missing_fields_json,raw_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id,product_id) DO NOTHING`).run(
        jobId,product.id,row.last_seen_at,row.latest_source_url ?? row.canonical_url,row.latest_title,row.price_amount,row.currency,
        row.sales_count,row.rating,row.review_count,row.first_seen_sequence,row.image_url,'observed',
        JSON.stringify(missingSnapshotFields(row)),row.raw_json
      );
      snapshotsInserted+=Number(snapshot.changes);
      const membership=db.prepare(`SELECT id FROM catalog_memberships WHERE product_id=? ORDER BY active DESC,last_seen_at DESC,id DESC LIMIT 1`).get(product.id);
      if (membership) {
        db.prepare(`UPDATE catalog_memberships SET source_page_url=COALESCE(?,source_page_url),current_rank=?,last_seen_at=?,
          last_job_id=?,category_key=?,category_profile_version=?,campaign_id=?,source_id=? WHERE id=?`).run(
          row.latest_source_url,row.first_seen_sequence,row.last_seen_at,jobId,campaign.categoryKey,campaign.categoryProfileVersion,
          campaign.id,row.latest_source_id,membership.id
        );
      } else {
        db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,
          source_page_url,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id,category_key,
          category_profile_version,campaign_id,source_id) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`).run(
          product.id,profile.site_country,profile.language,profile.currency,profile.navigation?.breadcrumbs?.[0] ?? 'Automotive',
          profile.display_name,row.latest_source_url,profile.sort_order,row.first_seen_sequence,row.first_seen_at,row.last_seen_at,
          jobId,campaign.categoryKey,campaign.categoryProfileVersion,campaign.id,row.latest_source_id
        );membershipsInserted+=1;
      }
      recordCampaignObservation(campaign.id,{ productId:product.id,platform:row.platform,goodsId:row.goods_id },'seen',{
        source:'catalog_staging',snapshotJobId:jobId
      });
    }
    const notSeen=db.prepare(`SELECT b.product_id,b.platform,b.goods_id FROM catalog_campaign_baseline_items b
      LEFT JOIN catalog_staging_products s ON s.campaign_id=b.campaign_id AND s.platform=b.platform
        AND s.goods_id=b.goods_id AND s.electronic_screening_status='passed'
      WHERE b.campaign_id=? AND s.id IS NULL`).all(campaign.id);
    for (const row of notSeen) recordCampaignObservation(campaign.id,{ productId:row.product_id,platform:row.platform,goodsId:row.goods_id },
      'not_seen_in_campaign',{ meaning:'observation only; product and active membership preserved' });
    const after=coreCounts(db);
    db.prepare(`INSERT INTO catalog_refresh_materializations(
      campaign_id,snapshot_job_id,products_before,products_after,memberships_before,memberships_after,
      snapshots_before,snapshots_after,reviews_before,reviews_after,products_inserted,memberships_inserted,
      snapshots_inserted,materialized_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(campaign.id,jobId,before.products,after.products,before.memberships,
      after.memberships,before.snapshots,after.snapshots,before.reviews,after.reviews,productsInserted,membershipsInserted,
      snapshotsInserted,timestamp);
    return mapMaterialization(db.prepare('SELECT * FROM catalog_refresh_materializations WHERE campaign_id=?').get(campaign.id));
  }

  function materializeExpansion(campaign) {
    const existing=db.prepare('SELECT * FROM catalog_expansion_materializations WHERE campaign_id=?').get(campaign.id);
    if (existing) return mapExpansionMaterialization(existing);
    const comparison=getExpansionComparison(campaign.id);const needed=comparison.newUniqueNeeded;
    const rows=db.prepare(`SELECT s.* FROM catalog_staging_products s
      WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
        AND NOT EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b
          WHERE b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id)
      ORDER BY s.first_seen_sequence LIMIT ?`).all(campaign.id,needed);
    if (rows.length!==needed) throw new Error(`Expansion净新增不足：${rows.length}/${needed}`);
    const profile=campaign.config.categoryProfile;const timestamp=now();const before=coreCounts(db);const jobId=createId('catalog_expansion_job');
    db.prepare(`INSERT INTO crawl_jobs(
      id,job_type,mode,site_country,language,currency,primary_category,subcategory,sort_order,target_count,
      status,checkpoint_json,config_json,total_items,processed_items,success_items,failed_items,
      discovered_count,stored_count,error_count,resume_count,requested_at,started_at,heartbeat_at,
      updated_at,finished_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      jobId,'catalog','catalog_scale_expansion',profile.site_country,profile.language,profile.currency,
      profile.navigation?.breadcrumbs?.[0] ?? 'Automotive',profile.display_name,profile.sort_order,needed,
      'completed','{}',JSON.stringify({ campaignId:campaign.id,categoryKey:campaign.categoryKey,baselineCount:comparison.baselineCount }),
      needed,needed,needed,0,needed,needed,0,0,timestamp,timestamp,timestamp,timestamp,timestamp,timestamp
    );
    let productsInserted=0,membershipsInserted=0,snapshotsInserted=0,historicalProductsReactivated=0;
    for (const row of rows) {
      let product=db.prepare('SELECT id FROM products WHERE platform=? AND external_product_id=?').get(row.platform,row.goods_id);
      if (!product) {
        const inserted=db.prepare(`INSERT INTO products(platform,external_product_id,source_url,canonical_url,source_domain,title,status,
          first_seen_at,last_seen_at,raw_identity_json) VALUES(?,?,?,?,? ,?,'active',?,?,?)`).run(
          row.platform,row.goods_id,row.latest_source_url,row.canonical_url,'www.temu.com',row.latest_title,
          row.first_seen_at,row.last_seen_at,JSON.stringify({ platform:row.platform,goods_id:row.goods_id })
        );
        product={ id:Number(inserted.lastInsertRowid) };productsInserted+=1;
      } else {
        const active=db.prepare('SELECT 1 FROM catalog_memberships WHERE product_id=? AND active=1 LIMIT 1').get(product.id);
        if (!active) historicalProductsReactivated+=1;
        db.prepare(`UPDATE products SET source_url=COALESCE(?,source_url),canonical_url=?,title=COALESCE(?,title),
          last_seen_at=? WHERE id=?`).run(row.latest_source_url,row.canonical_url,row.latest_title,row.last_seen_at,product.id);
      }
      const snapshot=db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title,price_amount,currency,
        sales_count,rating,review_count,listing_rank,image_url,availability,missing_fields_json,raw_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id,product_id) DO NOTHING`).run(
        jobId,product.id,row.last_seen_at,row.latest_source_url ?? row.canonical_url,row.latest_title,row.price_amount,row.currency,
        row.sales_count,row.rating,row.review_count,row.first_seen_sequence,row.image_url,'observed',
        JSON.stringify(missingSnapshotFields(row)),row.raw_json
      );
      snapshotsInserted+=Number(snapshot.changes);
      const membership=db.prepare(`SELECT id FROM catalog_memberships WHERE product_id=? ORDER BY active DESC,last_seen_at DESC,id DESC LIMIT 1`).get(product.id);
      if (membership) {
        db.prepare(`UPDATE catalog_memberships SET source_page_url=COALESCE(?,source_page_url),current_rank=?,last_seen_at=?,
          last_job_id=?,category_key=?,category_profile_version=?,campaign_id=?,source_id=? WHERE id=?`).run(
          row.latest_source_url,row.first_seen_sequence,row.last_seen_at,jobId,campaign.categoryKey,campaign.categoryProfileVersion,
          campaign.id,row.latest_source_id,membership.id
        );
      } else {
        db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,
          source_page_url,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id,category_key,
          category_profile_version,campaign_id,source_id) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`).run(
          product.id,profile.site_country,profile.language,profile.currency,profile.navigation?.breadcrumbs?.[0] ?? 'Automotive',
          profile.display_name,row.latest_source_url,profile.sort_order,row.first_seen_sequence,row.first_seen_at,row.last_seen_at,
          jobId,campaign.categoryKey,campaign.categoryProfileVersion,campaign.id,row.latest_source_id
        );membershipsInserted+=1;
      }
      recordCampaignObservation(campaign.id,{ productId:product.id,platform:row.platform,goodsId:row.goods_id },'seen',{
        source:'catalog_expansion_staging',snapshotJobId:jobId
      });
    }
    const after=coreCounts(db);
    db.prepare(`INSERT INTO catalog_expansion_materializations(
      campaign_id,snapshot_job_id,baseline_count,target_count,new_unique_count,products_before,products_after,
      memberships_before,memberships_after,snapshots_before,snapshots_after,reviews_before,reviews_after,
      products_inserted,memberships_inserted,snapshots_inserted,historical_products_reactivated,materialized_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(campaign.id,jobId,comparison.baselineCount,campaign.targetCount,rows.length,
      before.products,after.products,before.memberships,after.memberships,before.snapshots,after.snapshots,before.reviews,after.reviews,
      productsInserted,membershipsInserted,snapshotsInserted,historicalProductsReactivated,timestamp);
    return getExpansionMaterialization(campaign.id);
  }

  function saveExpansionAudit(campaignId,audit) {
    db.prepare(`INSERT INTO catalog_expansion_audits(
      campaign_id,baseline_count,target_count,new_unique_needed,new_non_electronic_count,active_candidate_count,
      duplicate_goods_id_count,electronic_in_candidate_count,manual_review_count,title_coverage,price_coverage,
      image_coverage,sales_coverage,rating_coverage,review_count_coverage,qa_passed,qa_details_json,checked_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id) DO UPDATE SET baseline_count=excluded.baseline_count,target_count=excluded.target_count,
      new_unique_needed=excluded.new_unique_needed,new_non_electronic_count=excluded.new_non_electronic_count,
      active_candidate_count=excluded.active_candidate_count,duplicate_goods_id_count=excluded.duplicate_goods_id_count,
      electronic_in_candidate_count=excluded.electronic_in_candidate_count,manual_review_count=excluded.manual_review_count,
      title_coverage=excluded.title_coverage,price_coverage=excluded.price_coverage,image_coverage=excluded.image_coverage,
      sales_coverage=excluded.sales_coverage,rating_coverage=excluded.rating_coverage,
      review_count_coverage=excluded.review_count_coverage,qa_passed=excluded.qa_passed,
      qa_details_json=excluded.qa_details_json,checked_at=excluded.checked_at`).run(
      campaignId,audit.baselineCount,audit.targetCount,audit.newUniqueNeeded,audit.newNonElectronicCount,audit.activeCandidateCount,
      audit.duplicateGoodsIdCount,audit.electronicInCandidateCount,audit.manualReviewCount,audit.titleCoverage,audit.priceCoverage,
      audit.imageCoverage,audit.salesCoverage,audit.ratingCoverage,audit.reviewCountCoverage,audit.qaPassed?1:0,
      JSON.stringify(audit.qaDetails),now());
    return getExpansionAudit(campaignId);
  }

  function getExpansionAudit(campaignId) {
    const row=db.prepare('SELECT * FROM catalog_expansion_audits WHERE campaign_id=?').get(campaignId);
    return row ? { ...row,qa_details_json:parseJson(row.qa_details_json) }:null;
  }

  function getExpansionMaterialization(campaignId) {
    return mapExpansionMaterialization(db.prepare('SELECT * FROM catalog_expansion_materializations WHERE campaign_id=?').get(campaignId));
  }

  function saveRefreshAudit(campaignId,audit) {
    db.prepare(`INSERT INTO catalog_refresh_audits(
      campaign_id,old_active_count,new_observed_unique_count,intersection_count,new_goods_count,not_seen_count,
      historical_url_available_count,historical_url_sold_out_count,fresh_navigation_recovered_count,
      category_card_available_count,search_context_mismatch_count,navigation_not_resolved_count,
      duplicate_goods_id_count,electronic_in_staging_count,manual_review_count,title_coverage,price_coverage,
      image_coverage,sales_coverage,rating_coverage,review_count_coverage,qa_passed,qa_details_json,checked_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id) DO UPDATE SET
      old_active_count=excluded.old_active_count,new_observed_unique_count=excluded.new_observed_unique_count,
      intersection_count=excluded.intersection_count,new_goods_count=excluded.new_goods_count,not_seen_count=excluded.not_seen_count,
      historical_url_available_count=excluded.historical_url_available_count,
      historical_url_sold_out_count=excluded.historical_url_sold_out_count,
      fresh_navigation_recovered_count=excluded.fresh_navigation_recovered_count,
      category_card_available_count=excluded.category_card_available_count,
      search_context_mismatch_count=excluded.search_context_mismatch_count,
      navigation_not_resolved_count=excluded.navigation_not_resolved_count,
      duplicate_goods_id_count=excluded.duplicate_goods_id_count,electronic_in_staging_count=excluded.electronic_in_staging_count,
      manual_review_count=excluded.manual_review_count,title_coverage=excluded.title_coverage,
      price_coverage=excluded.price_coverage,image_coverage=excluded.image_coverage,sales_coverage=excluded.sales_coverage,
      rating_coverage=excluded.rating_coverage,review_count_coverage=excluded.review_count_coverage,
      qa_passed=excluded.qa_passed,qa_details_json=excluded.qa_details_json,checked_at=excluded.checked_at`).run(
      campaignId,audit.oldActiveCount,audit.newObservedUniqueCount,audit.intersectionCount,audit.newGoodsCount,audit.notSeenCount,
      audit.historicalUrlAvailableCount,audit.historicalUrlSoldOutCount,audit.freshNavigationRecoveredCount,
      audit.categoryCardAvailableCount,audit.searchContextMismatchCount,audit.navigationNotResolvedCount,
      audit.duplicateGoodsIdCount,audit.electronicInStagingCount,audit.manualReviewCount,audit.titleCoverage,
      audit.priceCoverage,audit.imageCoverage,audit.salesCoverage,audit.ratingCoverage,audit.reviewCountCoverage,
      audit.qaPassed ? 1:0,JSON.stringify(audit.qaDetails),now()
    );
    return getRefreshAudit(campaignId);
  }

  function getRefreshAudit(campaignId) {
    const row=db.prepare('SELECT * FROM catalog_refresh_audits WHERE campaign_id=?').get(campaignId);
    return row ? { ...row,qa_details_json:parseJson(row.qa_details_json) }:null;
  }

  function getRefreshMaterialization(campaignId) {
    return mapMaterialization(db.prepare('SELECT * FROM catalog_refresh_materializations WHERE campaign_id=?').get(campaignId));
  }

  function activatePoolVersion(campaign,qaSummary={}) {
    const timestamp=now();
    const previous=db.prepare(`SELECT id,product_count FROM catalog_pool_versions WHERE category_key=? AND status='active'`).get(campaign.categoryKey);
    const legacyMembershipIds=db.prepare(`SELECT id FROM catalog_memberships WHERE active=1 ORDER BY id`).all().map(row => Number(row.id));
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
    if (campaign.campaignType==='expansion') {
      if (!previous || Number(previous.product_count)!==campaign.baselinePoolCount) throw new Error('Expansion baseline Pool与当前active Pool不一致。');
      db.prepare(`INSERT INTO catalog_pool_version_items(
        pool_version_id,staging_product_id,platform,goods_id,category_key,membership_status,created_at
      ) SELECT ?,staging_product_id,platform,goods_id,category_key,'seen',? FROM catalog_pool_version_items
        WHERE pool_version_id=?`).run(id,timestamp,previous.id);
      db.prepare(`INSERT INTO catalog_pool_version_items(
        pool_version_id,staging_product_id,platform,goods_id,category_key,membership_status,created_at
      ) SELECT ?,s.id,s.platform,s.goods_id,s.category_key,'seen',? FROM catalog_staging_products s
        WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
          AND NOT EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b
            WHERE b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id)
        ORDER BY s.first_seen_sequence LIMIT ?`).run(id,timestamp,campaign.id,campaign.targetCount-campaign.baselinePoolCount);
      const itemCount=Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_pool_version_items WHERE pool_version_id=?').get(id).count);
      if (itemCount!==campaign.targetCount) throw new Error(`Expansion Pool数量错误：${itemCount}/${campaign.targetCount}`);
      db.prepare('UPDATE catalog_memberships SET active=0 WHERE active=1').run();
      db.prepare(`UPDATE catalog_memberships SET active=1 WHERE id IN (
        SELECT (SELECT m.id FROM catalog_memberships m JOIN products p ON p.id=m.product_id
          WHERE p.platform=i.platform AND p.external_product_id=i.goods_id
          ORDER BY m.last_seen_at DESC,m.id DESC LIMIT 1)
        FROM catalog_pool_version_items i WHERE i.pool_version_id=?
      )`).run(id);
      const activeCount=Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count);
      if (activeCount!==campaign.targetCount) throw new Error(`Expansion active membership数量错误：${activeCount}/${campaign.targetCount}`);
    } else {
      db.prepare(`INSERT INTO catalog_pool_version_items(
        pool_version_id,staging_product_id,platform,goods_id,category_key,membership_status,created_at
      ) SELECT ?,id,platform,goods_id,category_key,'seen',? FROM catalog_staging_products
        WHERE campaign_id=? AND electronic_screening_status='passed'`).run(id,timestamp,campaign.id);
    }
    db.prepare(`INSERT INTO catalog_pool_activation_history(
      id,category_key,new_pool_version_id,previous_pool_version_id,legacy_active_membership_ids_json,activated_at
    ) VALUES(?,?,?,?,?,?)`).run(createId('catalog_activation'),campaign.categoryKey,id,previous?.id ?? null,
      JSON.stringify(legacyMembershipIds),timestamp);
    return mapPoolVersion(db.prepare('SELECT * FROM catalog_pool_versions WHERE id=?').get(id));
  }

  function completePendingSources(campaignId,stopReason='TARGET_GATE_REACHED_BEFORE_SOURCE') {
    const timestamp=now();
    const queues=db.prepare(`SELECT q.id,q.source_id,q.checkpoint_json FROM catalog_rpa_queue q
      WHERE q.campaign_id=? AND q.status='pending'`).all(campaignId);
    for (const queue of queues) {
      const checkpoint={ ...(parseJson(queue.checkpoint_json) ?? {}),phase:'completed',stopReason,completedAt:timestamp };
      db.prepare(`UPDATE catalog_rpa_queue SET status='completed',checkpoint_json=?,heartbeat_at=?,updated_at=? WHERE id=?`)
        .run(JSON.stringify(checkpoint),timestamp,timestamp,queue.id);
      db.prepare(`UPDATE catalog_sources SET status='completed',last_error_code=NULL,updated_at=? WHERE id=?`).run(timestamp,queue.source_id);
    }
    refreshCampaignCounts(campaignId);
    return queues.length;
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
      (SELECT COALESCE(SUM(b.received_count),0) FROM catalog_capture_batches b WHERE b.source_id=s.id) AS raw_observed_count,
      COUNT(DISTINCT o.platform || CHAR(31) || o.goods_id) AS source_unique_count,
      COUNT(DISTINCT CASE WHEN first_seen.first_source_id=s.id AND baseline.goods_id IS NULL THEN o.platform || CHAR(31) || o.goods_id END) AS campaign_new_unique_count,
      COUNT(DISTINCT CASE WHEN baseline.goods_id IS NOT NULL OR first_seen.first_source_id<>s.id OR source_seen.observation_count>1
        THEN o.platform || CHAR(31) || o.goods_id END) AS campaign_overlap_count,
      COUNT(DISTINCT CASE WHEN p.first_source_id=s.id AND p.electronic_screening_status='passed' AND baseline.goods_id IS NULL
        THEN p.platform || CHAR(31) || p.goods_id END) AS eligible_new_count,
      (SELECT COUNT(DISTINCT e.goods_id) FROM catalog_exclusion_observations e WHERE e.source_id=s.id) AS electronic_excluded_count,
      COUNT(DISTINCT CASE WHEN p.first_source_id=s.id AND p.electronic_screening_status='manual_review_required' THEN p.goods_id END) AS manual_review_count
    FROM catalog_sources s
    LEFT JOIN catalog_product_source_observations o ON o.campaign_id=s.campaign_id AND o.source_id=s.id
    LEFT JOIN (
      SELECT ranked.campaign_id,ranked.platform,ranked.goods_id,ranked.source_id AS first_source_id FROM (
        SELECT campaign_id,platform,goods_id,source_id,id,
          ROW_NUMBER() OVER(PARTITION BY campaign_id,platform,goods_id ORDER BY id) AS row_number
        FROM catalog_product_source_observations
      ) ranked WHERE ranked.row_number=1
    ) first_seen ON first_seen.campaign_id=o.campaign_id AND first_seen.platform=o.platform AND first_seen.goods_id=o.goods_id
    LEFT JOIN (
      SELECT campaign_id,source_id,platform,goods_id,COUNT(*) AS observation_count
      FROM catalog_product_source_observations GROUP BY campaign_id,source_id,platform,goods_id
    ) source_seen ON source_seen.campaign_id=o.campaign_id AND source_seen.source_id=o.source_id
      AND source_seen.platform=o.platform AND source_seen.goods_id=o.goods_id
    LEFT JOIN catalog_campaign_baseline_items baseline ON baseline.campaign_id=o.campaign_id
      AND baseline.platform=o.platform AND baseline.goods_id=o.goods_id
    LEFT JOIN catalog_staging_products p ON p.campaign_id=s.campaign_id AND p.platform=o.platform AND p.goods_id=o.goods_id
    WHERE s.campaign_id=? GROUP BY s.id,s.source_key ORDER BY s.priority,s.id`).all(campaignId).map(row => ({
      sourceId:row.source_id,sourceKey:row.source_key,rawObservedCount:Number(row.raw_observed_count),sourceUniqueCount:Number(row.source_unique_count),
      campaignNewUniqueCount:Number(row.campaign_new_unique_count),campaignOverlapCount:Number(row.campaign_overlap_count),
      eligibleNewCount:Number(row.eligible_new_count),electronicExcludedCount:Number(row.electronic_excluded_count),
      manualReviewCount:Number(row.manual_review_count)
    }));
  }

  return { createCampaign,getCampaign,setCampaignBrowserContext,captureCampaignBaseline,isCampaignBaselineItem,hasCampaignStagingItem,transitionCampaign,createSource,getSource,createSourceRun,registerBatch,
    completeBatch,recordSourceObservation,upsertStaging,recordExclusion,hasCampaignExclusion,removeStagingForExclusion,refreshCampaignCounts,recordCampaignObservation,
    recordNavigationRisk,getRefreshComparison,getNavigationRiskMetrics,getQualityMetrics,getExpansionComparison,getExpansionQualityMetrics,
    materializeRefresh,materializeExpansion,saveRefreshAudit,getRefreshAudit,getRefreshMaterialization,
    saveExpansionAudit,getExpansionAudit,getExpansionMaterialization,activatePoolVersion,completePendingSources,
    getRpaQueueForSource,getRpaQueue,getNextRpaQueue,listActiveRpaQueues,listRpaQueues,claimRpaQueue,
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
    browserProfileName:row.browser_profile_name,browserProfileDirectory:row.browser_profile_directory,
    browserControlMode:row.browser_control_mode,startedAt:row.started_at,finishedAt:row.finished_at,
    createdAt:row.created_at,updatedAt:row.updated_at };
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
function coreCounts(db) {
  return { products:Number(db.prepare('SELECT COUNT(*) AS count FROM products').get().count),
    memberships:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships').get().count),
    snapshots:Number(db.prepare('SELECT COUNT(*) AS count FROM product_snapshots').get().count),
    reviews:Number(db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count) };
}
function missingSnapshotFields(row) {
  return [['title','latest_title'],['price_amount','price_amount'],['currency','currency'],['sales_count','sales_count'],
    ['rating','rating'],['review_count','review_count'],['listing_rank','first_seen_sequence'],['image_url','image_url']]
    .filter(([,column]) => row[column]===null || row[column]===undefined || row[column]==='').map(([field]) => field);
}
function mapMaterialization(row) {
  return row ? { campaignId:row.campaign_id,snapshotJobId:row.snapshot_job_id,productsBefore:Number(row.products_before),
    productsAfter:Number(row.products_after),membershipsBefore:Number(row.memberships_before),membershipsAfter:Number(row.memberships_after),
    snapshotsBefore:Number(row.snapshots_before),snapshotsAfter:Number(row.snapshots_after),reviewsBefore:Number(row.reviews_before),
    reviewsAfter:Number(row.reviews_after),productsInserted:Number(row.products_inserted),membershipsInserted:Number(row.memberships_inserted),
    snapshotsInserted:Number(row.snapshots_inserted),materializedAt:row.materialized_at }:null;
}
function mapExpansionMaterialization(row) {
  return row ? { campaignId:row.campaign_id,snapshotJobId:row.snapshot_job_id,baselineCount:Number(row.baseline_count),
    targetCount:Number(row.target_count),newUniqueCount:Number(row.new_unique_count),productsBefore:Number(row.products_before),
    productsAfter:Number(row.products_after),membershipsBefore:Number(row.memberships_before),membershipsAfter:Number(row.memberships_after),
    snapshotsBefore:Number(row.snapshots_before),snapshotsAfter:Number(row.snapshots_after),reviewsBefore:Number(row.reviews_before),
    reviewsAfter:Number(row.reviews_after),productsInserted:Number(row.products_inserted),membershipsInserted:Number(row.memberships_inserted),
    snapshotsInserted:Number(row.snapshots_inserted),historicalProductsReactivated:Number(row.historical_products_reactivated),
    materializedAt:row.materialized_at }:null;
}
