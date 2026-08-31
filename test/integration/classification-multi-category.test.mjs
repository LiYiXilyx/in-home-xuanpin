import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { createClassificationRepository } from '../../src/db/repositories/classification-repository.mjs';
import { assertTaxonomyBinding } from '../../src/modules/catalog-scale/category-profile.mjs';
import { loadCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';
import { createOpportunityAnalysisService } from '../../src/modules/opportunity/opportunity-analysis-service.mjs';
import { fileURLToPath } from 'node:url';

const motorcycleProfilePath=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('classification reads only the explicit category pool and rejects a foreign taxonomy',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-classification-scope-'));
  const databasePath=path.join(directory,'fixture.db');migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  seed(db);
  const repository=createClassificationRepository(db);
  assert.deepEqual(repository.listPoolProducts({poolVersionId:'pool-b',categoryKey:'category-b'}).map(row=>row.goods_id),['2001','2003']);
  assert.throws(()=>repository.listPoolProducts({poolVersionId:'pool-a',categoryKey:'category-b'}),error=>error.code==='POOL_CATEGORY_MISMATCH');

  const profile={ category_key:'category-b',taxonomy_bindings:{
    classify:{taxonomy_name:'category-b-rules',taxonomy_version:null,rule_version:'category-b-rule-v1'}
  }};
  assert.throws(()=>assertTaxonomyBinding({profile,pipeline:'classify',taxonomyName:'week1-motorcycle-accessories',taxonomyVersion:null,ruleVersion:'week1-rule-v1'}),
    error=>error.code==='TAXONOMY_BINDING_MISMATCH');
  assert.deepEqual(assertTaxonomyBinding({profile,pipeline:'classify',taxonomyName:'category-b-rules',taxonomyVersion:null,ruleVersion:'category-b-rule-v1'}),{
    taxonomyName:'category-b-rules',taxonomyVersion:null,ruleVersion:'category-b-rule-v1',categoryScope:'category-b'
  });
});

test('Opportunity rejects a new category bound to an unimplemented taxonomy before snapshot writes',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-opportunity-binding-'));
  const databasePath=path.join(directory,'fixture.db');migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const base=await loadCategoryProfile(motorcycleProfilePath);
  const profile={ ...structuredClone(base),category_key:'category-b',category_profile_version:'category-b-v1',
    display_name:'Category B',legacy_membership_scopes:[],membership_scope:{...base.membership_scope,subcategory:'Category B'},
    taxonomy_bindings:{...structuredClone(base.taxonomy_bindings),opportunity:{taxonomy_name:'category-b-opportunity',taxonomy_version:null,rule_version:'category-b-v1'}} };
  assert.throws(()=>createOpportunityAnalysisService(db).analyzeActivePool({profile,poolVersionId:'pool-b'}),error=>error.code==='TAXONOMY_BINDING_MISMATCH');
  assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM opportunity_analysis_snapshots').get().count),0);
});

function seed(db) {
  db.exec('PRAGMA foreign_keys=OFF');
  const at='2026-08-31T00:00:00.000Z';
  for (const [id,key] of [['campaign-a','category-a'],['campaign-b','category-b']]) {
    db.prepare(`INSERT INTO catalog_campaigns(id,name,campaign_type,category_key,category_profile_version,target_gate,target_count,status,config_json,created_at,updated_at)
      VALUES(?,?,'refresh',?,'v1','non_electronic_unique_count',2,'completed','{}',?,?)`).run(id,id,key,at,at);
    db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,product_count,non_electronic_unique_count,status,created_at,updated_at)
      VALUES(?,?,?,?,2,2,'active',?,?)`).run(`pool-${key.at(-1)}`,id,key,'v1',at,at);
  }
  for (const goodsId of ['2001','2002','2003']) db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at)
    VALUES('temu',?,?,?, ?,?)`).run(goodsId,`https://www.temu.com/goods.html?goods_id=${goodsId}`,`Product ${goodsId}`,at,at);
  for (const [pool,key,goodsIds] of [['pool-a','category-a',['2001','2002']],['pool-b','category-b',['2001','2003']]]) {
    for (const goodsId of goodsIds) {
      db.prepare(`INSERT INTO catalog_pool_version_items(pool_version_id,staging_product_id,platform,goods_id,category_key,created_at)
        VALUES(?,1,'temu',?,?,?)`).run(pool,goodsId,key,at);
    }
  }
  db.exec('PRAGMA foreign_keys=ON');
}
