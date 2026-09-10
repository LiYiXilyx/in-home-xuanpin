import { AppError } from '../../shared/errors.mjs';

export function resolveMembershipCandidates(db,{profile,poolVersionId,productId,activeOnly=false}) {
  const pool=db.prepare('SELECT category_key,category_profile_version FROM catalog_pool_versions WHERE id=?').get(poolVersionId);
  if (!pool || pool.category_key!==profile.category_key || pool.category_profile_version!==profile.category_profile_version) {
    throw error('POOL_CATEGORY_MISMATCH',{poolVersionId,categoryKey:profile.category_key});
  }
  const product=db.prepare('SELECT platform,external_product_id FROM products WHERE id=?').get(productId);
  if (!product) throw error('CATEGORY_SCOPE_UNRESOLVED',{productId});
  const inPool=db.prepare(`SELECT 1 FROM catalog_pool_version_items WHERE pool_version_id=? AND platform=? AND goods_id=?`).get(poolVersionId,product.platform,product.external_product_id);
  if (!inPool) throw error('CATEGORY_SCOPE_UNRESOLVED',{productId,poolVersionId,reason:'POOL_IDENTITY_MISSING'});
  const keyed=select(db,productId,profile.membership_scope,{categoryKey:profile.category_key,activeOnly});
  if (keyed.length===1) return result(keyed,false);
  if (keyed.length>1) throw error('CATEGORY_SCOPE_AMBIGUOUS',{productId,membershipIds:keyed.map(x=>x.id)});
  if (profile.category_key!=='motorcycle-accessories') throw error('CATEGORY_SCOPE_UNRESOLVED',{productId,reason:'LEGACY_FALLBACK_FORBIDDEN'});
  const legacy=(profile.legacy_membership_scopes??[]).flatMap(scope=>select(db,productId,scope,{categoryKey:null,activeOnly}));
  const unique=[...new Map(legacy.map(row=>[row.id,row])).values()];
  if (unique.length===1) return result(unique,true);
  if (unique.length>1) throw error('CATEGORY_SCOPE_AMBIGUOUS',{productId,membershipIds:unique.map(x=>x.id)});
  throw error('CATEGORY_SCOPE_UNRESOLVED',{productId,reason:'LEGACY_SCOPE_NOT_UNIQUE'});
}

function select(db,productId,scope,{categoryKey,activeOnly}) {
  const categorySql=categoryKey===null ? 'category_key IS NULL':'category_key=?';
  const parameters=[productId];if(categoryKey!==null)parameters.push(categoryKey);
  parameters.push(scope.site_country,scope.language,scope.currency,scope.primary_category,scope.subcategory,scope.sort_order);
  return db.prepare(`SELECT id FROM catalog_memberships WHERE product_id=? AND ${categorySql}
    AND site_country=? AND language=? AND currency=? AND primary_category=? AND subcategory=? AND sort_order=?${activeOnly?' AND active=1':''}
    ORDER BY id`).all(...parameters);
}
function result(rows,legacy){return {membershipIds:rows.map(row=>Number(row.id)),uniquelyResolved:legacy?1:0,unresolved:0,ambiguous:0};}
function error(code,details){return new AppError(code,{code,details});}
