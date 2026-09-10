import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { validateCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';

const options=parseArgs(process.argv.slice(2));
const config=await loadConfig(options.config??'config.json');
const profilePath=fileURLToPath(new URL('../config/categories/motorcycle-accessories.json',import.meta.url));
const profile=validateCategoryProfile(JSON.parse(fs.readFileSync(profilePath,'utf8')));
const databasePath=path.resolve(config.app.databasePath);
const db=openDatabase(databasePath,{readOnly:true});
try {
  const nullRows=db.prepare(`SELECT m.id,m.product_id,m.active,m.site_country,m.language,m.currency,m.primary_category,m.subcategory,m.sort_order,
    p.platform,p.external_product_id goods_id FROM catalog_memberships m JOIN products p ON p.id=m.product_id
    WHERE m.category_key IS NULL ORDER BY m.product_id,m.id`).all();
  const activePools=db.prepare("SELECT id,category_key,category_profile_version,product_count,campaign_id FROM catalog_pool_versions WHERE status='active' ORDER BY category_key,id").all();
  const poolCategories=new Map();
  for(const pool of activePools){for(const item of db.prepare('SELECT platform,goods_id FROM catalog_pool_version_items WHERE pool_version_id=?').all(pool.id)){
    const key=`${item.platform}\u001f${item.goods_id}`,set=poolCategories.get(key)??new Set();set.add(pool.category_key);poolCategories.set(key,set);
  }}
  const byProduct=new Map();for(const row of nullRows){const values=byProduct.get(row.product_id)??[];values.push(row);byProduct.set(row.product_id,values);}
  let legacyMembershipsUniquelyResolved=0,legacyMembershipsUnresolved=0,legacyMembershipsAmbiguous=0;
  const scopes=[profile.membership_scope,...profile.legacy_membership_scopes];
  const motorcyclePool=activePools.filter(pool=>pool.category_key===profile.category_key);
  for(const rows of byProduct.values()){
    const matching=rows.filter(row=>scopes.some(scope=>sameScope(row,scope)));
    for(const row of rows.filter(item=>!matching.includes(item)))legacyMembershipsUnresolved+=1;
    if(!matching.length)continue;
    const categories=poolCategories.get(`${matching[0].platform}\u001f${matching[0].goods_id}`)??new Set();
    const profileConflict=motorcyclePool.length!==1||motorcyclePool[0].category_profile_version!==profile.category_profile_version;
    if(matching.length>1||categories.size>1){legacyMembershipsAmbiguous+=matching.length;continue;}
    if(profileConflict||categories.size!==1||!categories.has(profile.category_key)){legacyMembershipsUnresolved+=matching.length;continue;}
    legacyMembershipsUniquelyResolved+=matching.length;
  }
  const protectedCampaign=db.prepare(`SELECT id,name,status,target_count,non_electronic_unique_count,category_key,category_profile_version,
    baseline_pool_version_id,created_at FROM catalog_campaigns WHERE category_key=? AND campaign_type='refresh' AND target_count=2000
    ORDER BY CASE status WHEN 'paused' THEN 0 ELSE 1 END,created_at DESC LIMIT 1`).get(profile.category_key)??null;
  const protectedActivePool=motorcyclePool[0]??null;
  const result={
    databasePath,integrityCheck:db.prepare('PRAGMA integrity_check').get().integrity_check,
    foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length,
    LEGACY_MEMBERSHIP_NULL_CATEGORY_KEY:nullRows.length,
    LEGACY_ACTIVE_MEMBERSHIP_NULL_CATEGORY_KEY:nullRows.filter(row=>Number(row.active)===1).length,
    legacyMembershipsUniquelyResolved,legacyMembershipsUnresolved,legacyMembershipsAmbiguous,
    protectedProductCount:Number(protectedActivePool?.product_count??0),
    totalProductIdentityCount:Number(db.prepare('SELECT COUNT(*) count FROM products').get().count),
    protectedActivePool,protectedCampaign,
    historicalCampaignCount:Number(db.prepare('SELECT COUNT(*) count FROM catalog_campaigns').get().count),
    historicalSnapshotCount:Number(db.prepare('SELECT COUNT(*) count FROM product_snapshots').get().count)
  };
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
} finally { db.close(); }

function sameScope(row,scope){return row.site_country===scope.site_country&&row.language===scope.language&&row.currency===scope.currency&&row.primary_category===scope.primary_category&&row.subcategory===scope.subcategory&&row.sort_order===scope.sort_order;}
function parseArgs(values){const result={};for(let index=0;index<values.length;index+=1){if(values[index]==='--config')result.config=values[++index];else throw new Error(`未知参数：${values[index]}`);}return result;}
