import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/db/client.mjs';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { createReportRepository } from '../../src/db/repositories/report-repository.mjs';
import { opportunityDefinitionRows } from '../../src/modules/opportunity/opportunity-workbook.mjs';
import { createOpportunityAnalysisService } from '../../src/modules/opportunity/opportunity-analysis-service.mjs';

test('Operations export rows are constrained to the explicit Category Pool',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-export-scope-'));
  const databasePath=path.join(directory,'fixture.db');migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  seed(db);
  const rows=createReportRepository(db).listProducts('job-b',{poolVersionId:'pool-b',categoryKey:'category-b'});
  assert.deepEqual(rows.map(row=>row.goods_id),['3001','3003']);
  assert.throws(()=>createReportRepository(db).listProducts('job-b',{poolVersionId:'pool-a',categoryKey:'category-b'}),
    error=>error.code==='POOL_CATEGORY_MISMATCH');
});

test('Opportunity workbook metadata uses the frozen snapshot versions verbatim',() => {
  const rows=opportunityDefinitionRows({snapshot:{id:'snapshot-v1',sourcePoolVersionId:'pool-b',sourceCampaignId:'campaign-b',sourcePoolCount:2,
    categoryKey:'category-b',siteCountry:'DE',language:'en',currency:'EUR',sortContext:'Top Sales',generatedAt:'2026-08-31T00:00:00Z',
    config:{taxonomyName:'category-b-opportunity',taxonomyVersion:'category-b-v1',ruleVersion:'category-b-rule-v1',sourceSemantics:'FROZEN'}},summary:{}});
  assert.deepEqual(rows.find(row=>row[0]==='taxonomy_name'),['taxonomy_name','category-b-opportunity']);
  assert.deepEqual(rows.find(row=>row[0]==='taxonomy_version'),['taxonomy_version','category-b-v1']);
  assert.deepEqual(rows.find(row=>row[0]==='rule_version'),['rule_version','category-b-rule-v1']);
});

test('Opportunity status and reanalyze reject an implicit latest snapshot',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-snapshot-scope-'));
  const databasePath=path.join(directory,'fixture.db');migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  const service=createOpportunityAnalysisService(db);
  assert.throws(()=>service.getResult(),error=>error.code==='SNAPSHOT_ID_REQUIRED');
  assert.throws(()=>service.reanalyze(),error=>error.code==='SNAPSHOT_ID_REQUIRED');
});

function seed(db) {
  db.exec('PRAGMA foreign_keys=OFF');const at='2026-08-31T00:00:00Z';
  for(const [id,key,job] of [['campaign-a','category-a','job-a'],['campaign-b','category-b','job-b']]) {
    db.prepare(`INSERT INTO crawl_jobs(id,job_type,status,target_count,config_json,requested_at,created_at,updated_at) VALUES(?,'catalog','completed',2,'{}',?,?,?)`).run(job,at,at,at);
    db.prepare(`INSERT INTO catalog_campaigns(id,name,campaign_type,category_key,category_profile_version,target_gate,target_count,status,config_json,created_at,updated_at)
      VALUES(?,?,'refresh',?,'v1','non_electronic_unique_count',2,'completed','{}',?,?)`).run(id,id,key,at,at);
    db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,product_count,non_electronic_unique_count,status,created_at,updated_at)
      VALUES(?,?,?,?,2,2,'active',?,?)`).run(`pool-${key.at(-1)}`,id,key,'v1',at,at);
  }
  for(const goodsId of ['3001','3002','3003']) {
    const product=db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at)
      VALUES('temu',?,?,?, ?,?)`).run(goodsId,`https://www.temu.com/goods.html?goods_id=${goodsId}`,`Product ${goodsId}`,at,at);
    const productId=Number(product.lastInsertRowid);
    for(const [key,job] of goodsId==='3001'?[['category-a','job-a'],['category-b','job-b']]:goodsId==='3002'?[['category-a','job-a']]:[['category-b','job-b']]) {
      db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id,category_key,category_profile_version)
        VALUES(?,'DE','en','EUR','Fixture',?,'Top Sales',1,1,?,?,?,?,'v1')`).run(productId,key,at,at,job,key);
      db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title,price_amount,currency,sales_count,rating,review_count)
        VALUES(?,?,?,?,?,10,'EUR',100,4.8,20) ON CONFLICT(job_id,product_id) DO NOTHING`).run(job,productId,at,`https://www.temu.com/${goodsId}`,`Product ${goodsId}`);
    }
  }
  for(const [pool,key,goodsIds] of [['pool-a','category-a',['3001','3002']],['pool-b','category-b',['3001','3003']]]) {
    for(const goodsId of goodsIds) db.prepare(`INSERT INTO catalog_pool_version_items(pool_version_id,staging_product_id,platform,goods_id,category_key,created_at)
      VALUES(?,1,'temu',?,?,?)`).run(pool,goodsId,key,at);
  }
  db.exec('PRAGMA foreign_keys=ON');
}
