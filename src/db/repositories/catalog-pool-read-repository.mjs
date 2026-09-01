import { AppError } from '../../shared/errors.mjs';

export function createCatalogPoolReadRepository(db){
  const findPool=db.prepare(`SELECT id,category_key,category_profile_version FROM catalog_pool_versions WHERE id=?`);
  const listProducts=db.prepare(`SELECT i.platform,i.goods_id,s.latest_title AS title,s.image_url,
    CASE WHEN EXISTS(
      SELECT 1 FROM products p JOIN product_images pi ON pi.product_id=p.id
      WHERE p.platform=i.platform AND p.external_product_id=i.goods_id
        AND pi.source_url=s.image_url AND pi.download_status='completed'
        AND pi.local_path IS NOT NULL AND TRIM(pi.local_path)<>''
    ) THEN 'OK' ELSE 'MISS' END AS image_status
    FROM catalog_pool_version_items i
    JOIN catalog_staging_products s ON s.id=i.staging_product_id
    WHERE i.pool_version_id=? AND i.category_key=?
    ORDER BY i.platform COLLATE BINARY ASC,i.goods_id COLLATE BINARY ASC`);
  return{listPoolProducts({poolVersionId,categoryKey,categoryProfileVersion}={}){
    const identity={poolVersionId:required(poolVersionId),categoryKey:required(categoryKey),categoryProfileVersion:required(categoryProfileVersion)};
    if(!identity.poolVersionId||!identity.categoryKey||!identity.categoryProfileVersion)throw new AppError(
      'Pool Products读取需要明确pool_version_id、category_key和category_profile_version。',{code:'CATALOG_POOL_SCOPE_REQUIRED'});
    const pool=findPool.get(identity.poolVersionId);if(!pool)throw new AppError('找不到明确的Catalog Pool。',{code:'CATALOG_POOL_NOT_FOUND'});
    if(String(pool.category_key)!==identity.categoryKey||String(pool.category_profile_version)!==identity.categoryProfileVersion)throw new AppError(
      'Pool、Category与Profile scope不匹配。',{code:'CATALOG_POOL_SCOPE_MISMATCH'});
    const scope=Object.freeze({pool_version_id:String(pool.id),category_key:String(pool.category_key),
      category_profile_version:String(pool.category_profile_version)});
    return{scope,products:listProducts.all(scope.pool_version_id,scope.category_key).map(row=>({
      ...scope,platform:String(row.platform),goods_id:String(row.goods_id),title:row.title??null,image_url:row.image_url??null,
      image_status:String(row.image_status)
    }))};
  }};
}

function required(value){return typeof value==='string'?value.trim():'';}
