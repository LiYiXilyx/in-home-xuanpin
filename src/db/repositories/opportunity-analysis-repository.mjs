import { createId } from '../../shared/ids.mjs';

export function createOpportunityAnalysisRepository(db,{ now=()=>new Date().toISOString() }={}) {
  function freezeSourcePool(campaignId) {
    const campaign=db.prepare('SELECT * FROM catalog_campaigns WHERE id=?').get(campaignId);
    if(!campaign || campaign.campaign_type!=='expansion')throw new Error('Opportunity冻结要求Expansion Campaign。');
    const active=db.prepare("SELECT * FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get(campaign.category_key);
    if(!active)throw new Error('Opportunity冻结缺少Active baseline Pool。');
    const existing=db.prepare('SELECT * FROM catalog_pool_versions WHERE campaign_id=?').get(campaignId);
    if(existing){
      const count=poolIdentityCount(existing.id);if(count!==Number(existing.product_count))throw new Error('既有Opportunity Source Pool行数不一致。');
      return mapPool(existing);
    }
    const id=createId('catalog_pool');const timestamp=now();
    db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,
      product_count,non_electronic_unique_count,business_eligible_count,reviewable_unique_count,status,
      qa_summary_json,created_at,updated_at) VALUES(?,?,?,?,0,0,0,0,'ready',?,?,?)`).run(
      id,campaignId,campaign.category_key,campaign.category_profile_version,
      JSON.stringify({ purpose:'OPPORTUNITY_ANALYSIS_SOURCE',activeBaselinePoolVersionId:active.id }),timestamp,timestamp
    );
    db.prepare(`INSERT INTO catalog_pool_version_items(pool_version_id,staging_product_id,platform,goods_id,category_key,membership_status,created_at)
      SELECT ?,COALESCE(current.id,base.staging_product_id),base.platform,base.goods_id,base.category_key,'seen',?
      FROM catalog_pool_version_items base
      LEFT JOIN catalog_staging_products current ON current.campaign_id=? AND current.platform=base.platform
        AND current.goods_id=base.goods_id AND current.electronic_screening_status='passed'
      WHERE base.pool_version_id=?`).run(id,timestamp,campaignId,active.id);
    db.prepare(`INSERT INTO catalog_pool_version_items(pool_version_id,staging_product_id,platform,goods_id,category_key,membership_status,created_at)
      SELECT ?,s.id,s.platform,s.goods_id,s.category_key,'seen',?
      FROM catalog_staging_products s
      WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
        AND NOT EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b WHERE b.campaign_id=s.campaign_id
          AND b.platform=s.platform AND b.goods_id=s.goods_id)
      ORDER BY s.first_seen_sequence`).run(id,timestamp,campaignId);
    const count=poolIdentityCount(id);const goods=Number(db.prepare('SELECT COUNT(DISTINCT goods_id) n FROM catalog_pool_version_items WHERE pool_version_id=?').get(id).n);
    if(count!==goods || count!==Number(campaign.non_electronic_unique_count))throw new Error(`Opportunity Source Pool唯一性不一致：rows=${count}, goods=${goods}, campaign=${campaign.non_electronic_unique_count}`);
    db.prepare('UPDATE catalog_pool_versions SET product_count=?,non_electronic_unique_count=?,updated_at=? WHERE id=?').run(count,count,timestamp,id);
    return mapPool(db.prepare('SELECT * FROM catalog_pool_versions WHERE id=?').get(id));
  }

  function stopCampaignForAnalysis(campaignId) {
    const timestamp=now();
    const queues=db.prepare('SELECT * FROM catalog_rpa_queue WHERE campaign_id=?').all(campaignId);
    for(const q of queues){const cp={ ...parse(q.checkpoint_json,{}),phase:q.status==='pending'?'cancelled':'completed',
      stopReason:'OPPORTUNITY_ANALYSIS_FREEZE',frozenAt:timestamp };
      const next=q.status==='pending'?'cancelled':'completed';
      db.prepare('UPDATE catalog_rpa_queue SET status=?,checkpoint_json=?,heartbeat_at=?,updated_at=? WHERE id=?').run(next,JSON.stringify(cp),timestamp,timestamp,q.id);
      db.prepare('UPDATE catalog_sources SET status=?,last_error_code=NULL,updated_at=? WHERE id=?').run(q.status==='pending'?'cancelled':'exhausted',timestamp,q.source_id);
    }
    db.prepare("UPDATE catalog_source_runs SET stop_reason='OPPORTUNITY_ANALYSIS_FREEZE',finished_at=? WHERE campaign_id=? AND finished_at IS NULL").run(timestamp,campaignId);
    db.prepare("UPDATE catalog_campaigns SET status='paused',qa_summary_json=?,updated_at=? WHERE id=?").run(
      JSON.stringify({ phase:'OPPORTUNITY_ANALYSIS',reason:'Stopped expansion below 3000 by operator decision' }),timestamp,campaignId);
    return db.prepare('SELECT id,status,non_electronic_unique_count FROM catalog_campaigns WHERE id=?').get(campaignId);
  }

  function createSnapshot({ sourcePoolVersionId,sourceCampaignId,siteCountry='DE',language='en',currency='EUR',sortContext='Top Sales',config={} }) {
    const pool=db.prepare('SELECT * FROM catalog_pool_versions WHERE id=?').get(sourcePoolVersionId);
    if(!pool || !['ready','active'].includes(pool.status))throw new Error('Opportunity Snapshot要求ready或active Source Pool。');
    const id=createId('opportunity_snapshot');const timestamp=now();
    db.prepare(`INSERT INTO opportunity_analysis_snapshots(id,source_pool_version_id,source_campaign_id,source_pool_count,
      category_key,site_country,language,currency,sort_context,status,config_json,generated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'frozen',?,?)`).run(id,pool.id,sourceCampaignId,pool.product_count,pool.category_key,siteCountry,language,currency,sortContext,JSON.stringify(config),timestamp);
    db.prepare(`INSERT INTO opportunity_snapshot_items(snapshot_id,pool_version_item_id,staging_product_id,sequence,
      platform,goods_id,title,current_source_url,canonical_url,image_url,price_amount,currency,sales_count,rating,review_count,
      estimated_gmv,raw_json,created_at)
      SELECT ?,i.id,i.staging_product_id,ROW_NUMBER() OVER(ORDER BY i.id),i.platform,i.goods_id,s.latest_title,
        s.latest_source_url,s.canonical_url,s.image_url,s.price_amount,s.currency,s.sales_count,s.rating,s.review_count,
        CASE WHEN s.price_amount IS NULL OR s.sales_count IS NULL THEN NULL ELSE s.price_amount*s.sales_count END,
        s.raw_json,?
      FROM catalog_pool_version_items i JOIN catalog_staging_products s ON s.id=i.staging_product_id
      WHERE i.pool_version_id=? ORDER BY i.id`).run(id,timestamp,pool.id);
    const count=Number(db.prepare('SELECT COUNT(*) n FROM opportunity_snapshot_items WHERE snapshot_id=?').get(id).n);
    const distinct=Number(db.prepare("SELECT COUNT(DISTINCT platform || char(31) || goods_id) n FROM opportunity_snapshot_items WHERE snapshot_id=?").get(id).n);
    if(count!==Number(pool.product_count)||count!==distinct)throw new Error(`Opportunity Snapshot冻结不完整：${count}/${distinct}/${pool.product_count}`);
    return getSnapshot(id);
  }

  function getSnapshot(id){return mapSnapshot(db.prepare('SELECT * FROM opportunity_analysis_snapshots WHERE id=?').get(id));}
  function latestSnapshot(){return mapSnapshot(db.prepare('SELECT * FROM opportunity_analysis_snapshots ORDER BY generated_at DESC,id DESC LIMIT 1').get());}
  function listItems(snapshotId){return db.prepare('SELECT * FROM opportunity_snapshot_items WHERE snapshot_id=? ORDER BY sequence').all(snapshotId).map(mapItem);}
  function updateItemAnalysis(snapshotId,goodsId,result){db.prepare(`UPDATE opportunity_snapshot_items SET included=?,data_quality_json=?,hard_exclusion_codes_json=?,warning_codes_json=?,
    level1_scene=?,product_type=?,physical_form=?,fitment_type=?,logistics_type=?,ip_risk=?,classification_method=?,classification_confidence=?,
    classification_reasons_json=?,manual_review_required=?,level3_segment=? WHERE snapshot_id=? AND goods_id=?`).run(
      result.included?1:0,JSON.stringify(result.dataQuality),JSON.stringify(result.hardExclusions),JSON.stringify(result.warnings),
      result.level1Scene,result.productType,result.physicalForm,result.fitmentType,result.logisticsType,result.ipRisk,result.classificationMethod,
      result.confidence,JSON.stringify(result.reasons),result.manualReviewRequired?1:0,result.level3Segment??null,snapshotId,goodsId);}
  function saveSegments(snapshotId,segments){const timestamp=now();db.prepare('DELETE FROM opportunity_segment_metrics WHERE snapshot_id=?').run(snapshotId);const insert=db.prepare(`INSERT INTO opportunity_segment_metrics(
    snapshot_id,level1_scene,product_type,sku_count,total_sales,average_sales,median_sales,average_price,estimated_gmv,gmv_per_sku,
    average_rating,average_review_count,review_density,top3_sales_share,opportunity_score,score_components_json,sample_status,
    dominance_type,dominance_reason,replicability,risk_level,manual_review_required,reasons_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);for(const x of segments)insert.run(snapshotId,x.level1Scene,x.productType,x.skuCount,x.totalSales,x.averageSales,x.medianSales,x.averagePrice,x.estimatedGmv,x.gmvPerSku,x.averageRating,x.averageReviewCount,x.reviewDensity,x.top3SalesShare,x.opportunityScore,JSON.stringify(x.scoreComponents),x.sampleStatus,x.dominanceType,x.dominanceReason,x.replicability,x.riskLevel,x.manualReviewRequired?1:0,JSON.stringify(x.reasons),timestamp);}
  function saveCandidates(snapshotId,candidates){const timestamp=now();db.prepare('DELETE FROM opportunity_product_candidates WHERE snapshot_id=?').run(snapshotId);const insert=db.prepare(`INSERT INTO opportunity_product_candidates(snapshot_id,platform,goods_id,product_type,tier,candidate_rank,product_score,estimated_gmv,
    opportunity_reasons_json,major_risks_json,next_validation_action,manual_review_required,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);for(const x of candidates)insert.run(snapshotId,x.platform,x.goodsId,x.productType,x.tier,x.candidateRank,x.productScore,x.estimatedGmv,JSON.stringify(x.opportunityReasons),JSON.stringify(x.majorRisks),x.nextValidationAction,1,timestamp);}
  function completeSnapshot(id,summary){const timestamp=now();db.prepare("UPDATE opportunity_analysis_snapshots SET status='awaiting_confirmation',summary_json=?,completed_at=? WHERE id=?").run(JSON.stringify(summary),timestamp,id);return getSnapshot(id);}
  function failSnapshot(id,error){db.prepare("UPDATE opportunity_analysis_snapshots SET status='failed',summary_json=?,completed_at=? WHERE id=?").run(JSON.stringify({error:error?.message??String(error)}),now(),id);}
  function listSegments(id){return db.prepare('SELECT * FROM opportunity_segment_metrics WHERE snapshot_id=? ORDER BY sample_status,opportunity_score DESC,total_sales DESC').all(id).map(mapSegment);}
  function listCandidates(id){return db.prepare(`SELECT c.*,i.title,i.current_source_url,i.canonical_url,i.image_url,i.price_amount,i.sales_count,i.rating,i.review_count,
    i.level1_scene,i.physical_form,i.fitment_type,i.logistics_type,i.ip_risk,i.warning_codes_json
    FROM opportunity_product_candidates c JOIN opportunity_snapshot_items i ON i.snapshot_id=c.snapshot_id AND i.platform=c.platform AND i.goods_id=c.goods_id
    WHERE c.snapshot_id=? ORDER BY c.candidate_rank`).all(id).map(mapCandidate);}
  function coreCounts(){return {products:count('products'),snapshots:count('product_snapshots'),reviews:count('reviews'),activeMemberships:Number(db.prepare('SELECT COUNT(*) n FROM catalog_memberships WHERE active=1').get().n),integrity:db.prepare('PRAGMA integrity_check').get().integrity_check};}
  function poolIdentityCount(id){return Number(db.prepare("SELECT COUNT(DISTINCT platform || char(31) || goods_id) n FROM catalog_pool_version_items WHERE pool_version_id=?").get(id).n);}
  function count(table){return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);}
  return { freezeSourcePool,stopCampaignForAnalysis,createSnapshot,getSnapshot,latestSnapshot,listItems,updateItemAnalysis,
    saveSegments,saveCandidates,completeSnapshot,failSnapshot,listSegments,listCandidates,coreCounts };
}

function mapPool(r){return r?{id:r.id,campaignId:r.campaign_id,categoryKey:r.category_key,productCount:Number(r.product_count),status:r.status}:null;}
function mapSnapshot(r){return r?{id:r.id,sourcePoolVersionId:r.source_pool_version_id,sourceCampaignId:r.source_campaign_id,sourcePoolCount:Number(r.source_pool_count),categoryKey:r.category_key,siteCountry:r.site_country,language:r.language,currency:r.currency,sortContext:r.sort_context,status:r.status,config:parse(r.config_json,{}),summary:parse(r.summary_json,null),generatedAt:r.generated_at,completedAt:r.completed_at}:null;}
function mapItem(r){return {id:Number(r.id),snapshotId:r.snapshot_id,poolVersionItemId:Number(r.pool_version_item_id),stagingProductId:Number(r.staging_product_id),sequence:Number(r.sequence),platform:r.platform,goodsId:String(r.goods_id),title:r.title??'',currentSourceUrl:r.current_source_url,canonicalUrl:r.canonical_url,imageUrl:r.image_url,priceAmount:num(r.price_amount),currency:r.currency,salesCount:num(r.sales_count),rating:num(r.rating),reviewCount:num(r.review_count),estimatedGmv:num(r.estimated_gmv),included:Boolean(r.included),dataQuality:parse(r.data_quality_json,[]),hardExclusionCodes:parse(r.hard_exclusion_codes_json,[]),warningCodes:parse(r.warning_codes_json,[]),level1Scene:r.level1_scene,productType:r.product_type,level3Segment:r.level3_segment??'其它/待细分',physicalForm:r.physical_form,fitmentType:r.fitment_type,logisticsType:r.logistics_type,ipRisk:r.ip_risk,classificationMethod:r.classification_method,classificationConfidence:Number(r.classification_confidence),classificationReasons:parse(r.classification_reasons_json,[]),manualReviewRequired:Boolean(r.manual_review_required),raw:parse(r.raw_json,{})};}
function mapSegment(r){return {snapshotId:r.snapshot_id,level1Scene:r.level1_scene,productType:r.product_type,skuCount:Number(r.sku_count),totalSales:Number(r.total_sales),averageSales:Number(r.average_sales),medianSales:Number(r.median_sales),averagePrice:Number(r.average_price),estimatedGmv:Number(r.estimated_gmv),gmvPerSku:Number(r.gmv_per_sku),averageRating:num(r.average_rating),averageReviewCount:num(r.average_review_count),reviewDensity:num(r.review_density),top3SalesShare:Number(r.top3_sales_share),opportunityScore:num(r.opportunity_score),scoreComponents:parse(r.score_components_json,{}),sampleStatus:r.sample_status,dominanceType:r.dominance_type,dominanceReason:r.dominance_reason,replicability:r.replicability,riskLevel:r.risk_level,manualReviewRequired:Boolean(r.manual_review_required),reasons:parse(r.reasons_json,[])};}
function mapCandidate(r){return {snapshotId:r.snapshot_id,platform:r.platform,goodsId:String(r.goods_id),productType:r.product_type,tier:r.tier,candidateRank:Number(r.candidate_rank),productScore:Number(r.product_score),estimatedGmv:Number(r.estimated_gmv),opportunityReasons:parse(r.opportunity_reasons_json,[]),majorRisks:parse(r.major_risks_json,[]),nextValidationAction:r.next_validation_action,manualReviewRequired:Boolean(r.manual_review_required),title:r.title,currentSourceUrl:r.current_source_url,canonicalUrl:r.canonical_url,imageUrl:r.image_url,priceAmount:num(r.price_amount),salesCount:num(r.sales_count),rating:num(r.rating),reviewCount:num(r.review_count),level1Scene:r.level1_scene,physicalForm:r.physical_form,fitmentType:r.fitment_type,logisticsType:r.logistics_type,ipRisk:r.ip_risk,warningCodes:parse(r.warning_codes_json,[])};}
function parse(v,f){try{return v?JSON.parse(v):f;}catch{return f;}}
function num(v){return v===null||v===undefined?null:Number(v);}
