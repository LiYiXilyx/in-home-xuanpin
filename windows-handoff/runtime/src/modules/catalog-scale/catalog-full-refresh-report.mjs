import { createCatalogCampaignService } from './catalog-campaign-service.mjs';

export function buildFullRefreshReport(db,campaignId) {
  const status=createCatalogCampaignService(db).getStatus(campaignId);
  if (status.campaign.campaignType!=='refresh') throw new Error('Full Refresh报告只支持 refresh Campaign。');
  const refreshJobId=status.materialization?.snapshotJobId??null;
  const staged=db.prepare(`SELECT s.*,p.id AS product_id,b.id AS baseline_item_id,
      old.id AS old_snapshot_id,old.captured_at AS old_captured_at,old.title AS old_title,
      old.price_amount AS old_price_amount,old.sales_count AS old_sales_count,old.rating AS old_rating,
      old.review_count AS old_review_count,old.image_url AS old_image_url,old.source_url AS old_source_url
    FROM catalog_staging_products s
    LEFT JOIN catalog_campaign_baseline_items b ON b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id
    LEFT JOIN products p ON p.platform=s.platform AND p.external_product_id=s.goods_id
    LEFT JOIN product_snapshots old ON old.id=(
      SELECT ps.id FROM product_snapshots ps WHERE ps.product_id=p.id
        AND (? IS NULL OR ps.job_id<>?) ORDER BY ps.captured_at DESC,ps.id DESC LIMIT 1
    )
    WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
    ORDER BY s.first_seen_sequence`).all(refreshJobId,refreshJobId,campaignId);
  const rows=staged.map(row=>comparisonRow(row));
  const sales={ unchanged:0,changed:0,increased:0,decreased:0,likelyHistoricalParseErrors:0,
    nullBeforeNowValid:0,validBeforeNowNull:0,parseFailures:0,rawEvidenceMissing:0 };
  for(const row of rows){
    if(row.old_sales_count===null&&row.new_sales_count!==null)sales.nullBeforeNowValid+=1;
    if(row.old_sales_count!==null&&row.new_sales_count===null)sales.validBeforeNowNull+=1;
    if(row.sales_change_classification==='UNCHANGED')sales.unchanged+=1;
    else if(row.old_sales_count!==null&&row.new_sales_count!==null)sales.changed+=1;
    if(row.sales_delta>0)sales.increased+=1;if(row.sales_delta<0)sales.decreased+=1;
    if(row.sales_quality_flag==='LIKELY_OLD_PARSE_ERROR')sales.likelyHistoricalParseErrors+=1;
    if(row.new_sales_count===null)sales.parseFailures+=1;if(!row.raw_sales_text)sales.rawEvidenceMissing+=1;
  }
  const byAbsolute=[...rows].filter(row=>row.sales_delta!==null).sort((a,b)=>Math.abs(b.sales_delta)-Math.abs(a.sales_delta)).slice(0,50);
  const byRatio=[...rows].filter(row=>row.sales_change_ratio!==null).sort((a,b)=>ratioDistance(b.sales_change_ratio)-ratioDistance(a.sales_change_ratio)).slice(0,50);
  const transports=rows.reduce((result,row)=>{result[row.capture_transport]=(result[row.capture_transport]??0)+1;return result;},{});
  const newProductsCreated=status.materialization?.productsInserted??rows.filter(row=>row.product_id===null).length;
  return { campaign:status.campaign,comparison:status.refreshComparison,quality:status.qualityMetrics,materialization:status.materialization,
    refreshedUnique:rows.length,activePoolRefreshed:rows.filter(row=>row.baseline_item===true).length,
    nonBaselineObserved:rows.filter(row=>row.baseline_item===false).length,existingProductsRefreshed:rows.length-newProductsCreated,
    newProductsCreated,duplicateGoodsId:rows.length-new Set(rows.map(row=>`${row.platform}\u001f${row.goods_id}`)).size,
    sales,transports,rows,top50LargestAbsoluteChanges:byAbsolute,top50LargestRatioChanges:byRatio };
}

export function formalCatalogState(db) {
  const activePool=db.prepare("SELECT id,product_count FROM catalog_pool_versions WHERE status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get()??null;
  const opportunity=db.prepare('SELECT id,status FROM opportunity_analysis_snapshots ORDER BY generated_at DESC,id DESC LIMIT 1').get()??null;
  return { products:count(db,'products'),memberships:count(db,'catalog_memberships'),activeMemberships:Number(db.prepare('SELECT COUNT(*) count FROM catalog_memberships WHERE active=1').get().count),
    snapshots:count(db,'product_snapshots'),reviews:count(db,'reviews'),activePoolId:activePool?.id??null,activePoolCount:Number(activePool?.product_count??0),
    opportunitySnapshotId:opportunity?.id??null,opportunityStatus:opportunity?.status??null,
    opportunitySnapshots:count(db,'opportunity_analysis_snapshots'),opportunityCandidates:count(db,'opportunity_product_candidates'),
    opportunityConfirmations:count(db,'opportunity_confirmations'),opportunityConfirmationEvents:count(db,'opportunity_confirmation_events'),
    migrationMax:db.prepare('SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1').get()?.filename??null,
    sqliteIntegrity:String(db.prepare('PRAGMA integrity_check').get().integrity_check),foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length };
}

function comparisonRow(row){
  const raw=parseJson(row.raw_json);const oldSales=numberOrNull(row.old_sales_count),newSales=numberOrNull(row.sales_count);
  const delta=oldSales===null||newSales===null?null:newSales-oldSales;
  const ratio=oldSales===null||newSales===null||oldSales===0?null:newSales/oldSales;
  const rawSales=stringOrNull(raw.raw_sales_text),parsed=numberOrNull(raw.parsed_sales_count),provenance=stringOrNull(raw.sales_provenance??raw.field_provenance?.sales_count);
  const likelyOld=oldSales!==null&&newSales!==null&&oldSales>0&&ratio>=100&&/[KMB]\+?\s*sold/i.test(rawSales??'')&&parsed===newSales;
  const classification=oldSales===null&&newSales!==null?'MISSING_BEFORE':oldSales!==null&&newSales===null?'MISSING_NOW':
    oldSales===newSales?'UNCHANGED':likelyOld?'SUSPICIOUS_CORRECTION':'CHANGED';
  const quality=likelyOld?'LIKELY_OLD_PARSE_ERROR':ratio!==null&&(ratio>=100||ratio<=0.01)?'NEEDS_MANUAL_REVIEW':
    ratio!==null&&(ratio>=10||ratio<=0.1)?'AMBIGUOUS':'NORMAL_MARKET_CHANGE';
  return { platform:row.platform,goods_id:String(row.goods_id),product_id:row.product_id===null?null:Number(row.product_id),baseline_item:row.baseline_item_id!==null,old_snapshot_id:row.old_snapshot_id??null,
    old_captured_at:row.old_captured_at??null,captured_at:row.last_seen_at,raw_sales_text:rawSales,parsed_sales_count:parsed,
    final_sales_count:newSales,sales_provenance:provenance,old_sales_count:oldSales,new_sales_count:newSales,sales_delta:delta,
    sales_change_ratio:ratio,sales_change_classification:classification,sales_quality_flag:quality,
    capture_transport:stringOrNull(raw.capture_transport)??'DOM',network_endpoint:stringOrNull(raw.network_endpoint),
    fields:{ title:compare(row.old_title,row.latest_title),price:compare(numberOrNull(row.old_price_amount),numberOrNull(row.price_amount)),
      sales_count:compare(oldSales,newSales),rating:compare(numberOrNull(row.old_rating),numberOrNull(row.rating)),
      review_count:compare(numberOrNull(row.old_review_count),numberOrNull(row.review_count)),image_url:compare(row.old_image_url,row.image_url),
      source_url:compare(row.old_source_url,row.latest_source_url) } };
}
function compare(oldValue,newValue){const before=oldValue??null,after=newValue??null;return { old:before,new:after,classification:before===null&&after!==null?'MISSING_BEFORE':before!==null&&after===null?'MISSING_NOW':before===after?'UNCHANGED':'CHANGED' };}
function ratioDistance(value){return value>=1?value:1/value;}
function numberOrNull(value){const number=Number(value);return value===null||value===undefined||value===''||!Number.isFinite(number)?null:number;}
function stringOrNull(value){const text=String(value??'').trim();return text||null;}
function parseJson(value){try{return JSON.parse(value??'{}')??{};}catch{return{};}}
function count(db,table){return Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);}
