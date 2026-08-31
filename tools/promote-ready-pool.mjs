import { loadConfig } from '../src/config/load.mjs';
import { openDatabase,transaction } from '../src/db/client.mjs';
import { createId } from '../src/shared/ids.mjs';
import { assertTemuMutationAllowed } from '../src/modules/sourcing/machine-role.mjs';
import { validateCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';

assertTemuMutationAllowed('Active Pool promote');
const poolId=process.argv[2];if(!poolId)throw new Error('用法：node tools/promote-ready-pool.mjs <ready-pool-id> --config config.json');
const configFlag=process.argv.indexOf('--config');const config=await loadConfig(configFlag>=0?process.argv[configFlag+1]:'config.json');const db=openDatabase(config.app.databasePath);
try { console.log(JSON.stringify(transaction(db,()=>promote(db,poolId)),null,2)); } finally { db.close(); }

function promote(db,id) {
  const pool=db.prepare(`SELECT * FROM catalog_pool_versions WHERE id=?`).get(id);if(!pool||pool.status!=='ready')throw new Error('目标必须是 ready Pool Version。');
  const campaign=db.prepare('SELECT config_json FROM catalog_campaigns WHERE id=? AND category_key=? AND category_profile_version=?')
    .get(pool.campaign_id,pool.category_key,pool.category_profile_version);
  if(!campaign)throw new Error('ready Pool 缺少匹配的 Campaign/Profile scope。');
  const profile=validateCategoryProfile(JSON.parse(campaign.config_json??'{}').categoryProfile);
  if(profile.category_key!==pool.category_key||profile.category_profile_version!==pool.category_profile_version)throw new Error('ready Pool 与冻结 Category Profile 不匹配。');
  const scope=profile.membership_scope;
  const gate=db.prepare(`SELECT COUNT(*) rows,COUNT(DISTINCT platform||char(31)||goods_id) identities FROM catalog_pool_version_items WHERE pool_version_id=?`).get(id);
  if(Number(gate.rows)!==Number(pool.product_count)||Number(gate.identities)!==Number(pool.product_count))throw new Error('ready Pool 的声明数量或身份唯一性不一致。');
  const missing=db.prepare(`SELECT i.*,s.* FROM catalog_pool_version_items i JOIN catalog_staging_products s ON s.id=i.staging_product_id
    LEFT JOIN products p ON p.platform=i.platform AND p.external_product_id=i.goods_id WHERE i.pool_version_id=? AND p.id IS NULL`).all(id);
  if(missing.some(x=>!String(x.latest_source_url??'').trim()||!String(x.canonical_url??'').trim()))throw new Error('存在无法以真实观察链接物化的商品，拒绝激活。');
  const now=new Date().toISOString(),jobId=createId('catalog_promotion');
  db.prepare(`INSERT INTO crawl_jobs(id,job_type,mode,site_country,language,currency,primary_category,subcategory,source_url,sort_order,target_count,status,checkpoint_json,config_json,total_items,processed_items,success_items,failed_items,discovered_count,stored_count,error_count,requested_at,started_at,heartbeat_at,updated_at,finished_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'completed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId,'catalog','ready_pool_promotion',scope.site_country,scope.language,scope.currency,scope.primary_category,scope.subcategory,null,scope.sort_order,Number(pool.product_count),JSON.stringify({purpose:'OPERATOR_APPROVED_READY_POOL_PROMOTION',poolId:id}),JSON.stringify({poolId:id,categoryKey:pool.category_key,categoryProfileVersion:pool.category_profile_version}),missing.length,missing.length,missing.length,0,missing.length,missing.length,0,now,now,now,now,now,now);
  const insertProduct=db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,source_domain,title,status,first_seen_at,last_seen_at,raw_identity_json,source_url) VALUES(?,?,?,?,?,'active',?,?,?,?)`);
  const findProduct=db.prepare(`SELECT id FROM products WHERE platform=? AND external_product_id=?`);
  const insertSnapshot=db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title,price_amount,currency,sales_count,rating,review_count,listing_rank,image_url,availability,missing_fields_json,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertMembership=db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,source_page_url,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id,category_key,category_profile_version,campaign_id,source_id) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`);
  for(const row of missing){insertProduct.run(row.platform,row.goods_id,row.canonical_url,'www.temu.com',row.latest_title??null,now,now,JSON.stringify({promotedFromReadyPool:id,stagingProductId:row.staging_product_id}),row.latest_source_url);const product=findProduct.get(row.platform,row.goods_id);insertSnapshot.run(jobId,product.id,row.last_seen_at??now,row.latest_source_url,row.latest_title??null,row.price_amount,row.currency,row.sales_count,row.rating,row.review_count,row.first_seen_sequence,row.image_url,'observed','[]',row.raw_json??'{}');insertMembership.run(product.id,scope.site_country,scope.language,scope.currency,scope.primary_category,scope.subcategory,null,scope.sort_order,row.first_seen_sequence,now,now,jobId,pool.category_key,pool.category_profile_version,row.campaign_id,row.latest_source_id);}
  const scopedRows=listScopedMemberships(db,profile);
  const before=scopedRows.filter(row=>Number(row.active)===1).length;
  const deactivate=db.prepare('UPDATE catalog_memberships SET active=0 WHERE id=? AND category_key=?');
  const deactivateLegacy=db.prepare('UPDATE catalog_memberships SET active=0 WHERE id=? AND category_key IS NULL');
  for(const row of scopedRows)(row.category_key===null?deactivateLegacy:deactivate).run(...(row.category_key===null?[row.id]:[row.id,pool.category_key]));
  const targetIds=resolvePoolMembershipIds(db,id,profile);
  const activate=db.prepare('UPDATE catalog_memberships SET active=1 WHERE id=?');
  for(const membershipId of targetIds)activate.run(membershipId);
  const active=listScopedMemberships(db,profile).filter(row=>Number(row.active)===1).length;if(active!==Number(pool.product_count))throw new Error(`Category-scoped membership 数量不一致：${active}/${pool.product_count}`);
  db.prepare(`UPDATE catalog_pool_versions SET status='superseded',superseded_at=?,updated_at=? WHERE category_key=? AND status='active'`).run(now,now,pool.category_key);
  db.prepare(`UPDATE catalog_pool_versions SET status='active',activated_at=?,updated_at=?,qa_summary_json=? WHERE id=?`).run(now,now,JSON.stringify({purpose:'OPERATOR_APPROVED_FORMAL_POOL_PROMOTION',promotedFrom:'ready',identityCount:active}),id);
  db.prepare(`INSERT INTO catalog_pool_activation_history(id,category_key,new_pool_version_id,previous_pool_version_id,legacy_active_membership_ids_json,activated_at) VALUES(?,?,?,?,?,?)`).run(createId('catalog_activation'),pool.category_key,id,db.prepare(`SELECT id FROM catalog_pool_versions WHERE category_key=? AND status='superseded' ORDER BY superseded_at DESC LIMIT 1`).get(pool.category_key)?.id??null,JSON.stringify([]),now);
  return {poolId:id,promotedProducts:missing.length,activeBefore:before,activeAfter:active,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check};
}

function listScopedMemberships(db,profile) {
  const scopes=[{...profile.membership_scope,category_key:profile.category_key},...(profile.legacy_membership_scopes??[]).map(scope=>({...scope,category_key:null}))];
  const rows=[];
  for(const scope of scopes){const categorySql=scope.category_key===null?'category_key IS NULL':'category_key=?';const params=[];if(scope.category_key!==null)params.push(scope.category_key);params.push(scope.site_country,scope.language,scope.currency,scope.primary_category,scope.subcategory,scope.sort_order);rows.push(...db.prepare(`SELECT id,product_id,active,category_key FROM catalog_memberships WHERE ${categorySql} AND site_country=? AND language=? AND currency=? AND primary_category=? AND subcategory=? AND sort_order=?`).all(...params));}
  return [...new Map(rows.map(row=>[row.id,row])).values()];
}

function resolvePoolMembershipIds(db,poolId,profile) {
  const poolProducts=db.prepare(`SELECT p.id FROM catalog_pool_version_items i JOIN products p ON p.platform=i.platform AND p.external_product_id=i.goods_id WHERE i.pool_version_id=? ORDER BY p.id`).all(poolId);
  const scoped=listScopedMemberships(db,profile);const ids=[];
  for(const product of poolProducts){const candidates=scoped.filter(row=>Number(row.product_id)===Number(product.id));if(candidates.length!==1)throw new Error(`Pool 商品 membership scope 无法唯一解析：product_id=${product.id}, candidates=${candidates.length}`);ids.push(Number(candidates[0].id));}
  if(ids.length!==poolProducts.length||new Set(ids).size!==ids.length)throw new Error('Pool membership identity 无法唯一解析。');
  return ids;
}
