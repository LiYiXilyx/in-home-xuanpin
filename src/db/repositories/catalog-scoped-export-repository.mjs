import {AppError} from '../../shared/errors.mjs';

export function createCatalogScopedExportRepository(db){
  const campaignQuery=db.prepare('SELECT id,campaign_type,category_key,category_profile_version,created_at FROM catalog_campaigns WHERE id=?');
  const stateQuery=db.prepare('SELECT current_revision,candidate_count FROM catalog_initial_pool_candidate_state WHERE campaign_id=?');
  const previewRows=db.prepare(`SELECT platform,goods_id,activation_payload_json,created_at FROM catalog_initial_pool_candidate_items
    WHERE campaign_id=? ORDER BY platform COLLATE BINARY,goods_id COLLATE BINARY`);
  const poolQuery=db.prepare('SELECT id,campaign_id,category_key,category_profile_version,status,activated_at FROM catalog_pool_versions WHERE id=?');
  const poolRows=db.prepare(`SELECT i.platform,i.goods_id,s.latest_title title,s.latest_source_url source_url,s.canonical_url,
    s.image_url,s.price_amount,s.currency,s.sales_count,s.rating,s.review_count,s.first_seen_sequence listing_rank,
    s.first_seen_at capture_time,CASE WHEN EXISTS(SELECT 1 FROM products p JOIN product_images pi ON pi.product_id=p.id
      WHERE p.platform=i.platform AND p.external_product_id=i.goods_id AND pi.download_status='completed'
        AND pi.local_path IS NOT NULL AND TRIM(pi.local_path)<>'') THEN 'OK' ELSE 'MISS' END image_status
    FROM catalog_pool_version_items i JOIN catalog_staging_products s ON s.id=i.staging_product_id
    WHERE i.pool_version_id=? AND i.category_key=? ORDER BY i.platform COLLATE BINARY,i.goods_id COLLATE BINARY`);

  function readPreview({campaignId,candidateRevision,categoryKey,categoryProfileVersion}={}){
    const identity=requiredScope({campaignId,categoryKey,categoryProfileVersion});
    const campaign=campaignQuery.get(identity.campaignId);if(!campaign||campaign.campaign_type!=='initial')throw fault('CATALOG_PREVIEW_SCOPE_MISMATCH','Preview需要明确 Initial Campaign。');
    if(campaign.category_key!==identity.categoryKey||campaign.category_profile_version!==identity.categoryProfileVersion)throw fault('CATALOG_PREVIEW_SCOPE_MISMATCH','Preview Campaign scope不匹配。');
    const state=stateQuery.get(identity.campaignId),revision=Number(candidateRevision);
    if(!state||!Number.isInteger(revision)||revision!==Number(state.current_revision))throw fault('CATALOG_PREVIEW_REVISION_STALE','Preview candidate revision 已变化。');
    const products=previewRows.all(identity.campaignId).map(row=>{const payload=JSON.parse(row.activation_payload_json);return{
      ...payload,platform:String(row.platform),goods_id:String(row.goods_id),capture_time:row.created_at,image_status:'MISS'
    };});
    return{scope:{export_type:'PREVIEW',activation_status:'NOT_ACTIVE_POOL',campaign_id:identity.campaignId,candidate_revision:revision,
      category_key:identity.categoryKey,category_profile_version:identity.categoryProfileVersion,pool_version_id:null},products};
  }
  function readFormalPool({poolVersionId,categoryKey,categoryProfileVersion}={}){
    const poolId=required(poolVersionId),key=required(categoryKey),version=required(categoryProfileVersion);
    if(!poolId||!key||!version)throw fault('CATALOG_POOL_SCOPE_REQUIRED','Formal export需要明确 Pool/Category/Profile。');
    const pool=poolQuery.get(poolId);if(!pool)throw fault('CATALOG_POOL_NOT_FOUND','找不到明确 Pool。');
    if(pool.category_key!==key||pool.category_profile_version!==version||pool.status!=='active')throw fault('CATALOG_POOL_SCOPE_MISMATCH','Formal Pool scope或状态不匹配。');
    return{scope:{export_type:'FORMAL_POOL',activation_status:'ACTIVE_POOL',campaign_id:pool.campaign_id,candidate_revision:null,
      category_key:key,category_profile_version:version,pool_version_id:poolId,activated_at:pool.activated_at},products:poolRows.all(poolId,key)};
  }
  return Object.freeze({readPreview,readFormalPool});
}
function requiredScope(value){const result={campaignId:required(value.campaignId),categoryKey:required(value.categoryKey),categoryProfileVersion:required(value.categoryProfileVersion)};
  if(Object.values(result).some(item=>!item))throw fault('CATALOG_PREVIEW_SCOPE_MISMATCH','Preview scope不完整。');return result;}
function required(value){return String(value??'').trim();}
function fault(code,message){return new AppError(message,{code});}
