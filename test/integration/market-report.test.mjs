import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { runMarketAnalysis } from '../../src/modules/analysis/market-analysis-service.mjs';
import { loadArtifactTool } from '../../src/modules/analysis/artifact-runtime.mjs';

test('market analysis reads only active products, records explicit runs, exports Excel and passes QA',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-market-report-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  const databasePath=path.join(directory,'v2.db');
  migrateDatabase({ databasePath });
  seed(databasePath);
  const config={ configPath:path.join(directory,'config.json'),app:{ databasePath } };
  const outputDir=path.join(directory,'week2');
  const first=await runMarketAnalysis(config,{ jobId:'job-test',expectedActiveCount:6,outputDir,now:() => new Date('2026-08-22T00:00:00Z') });
  const second=await runMarketAnalysis(config,{ jobId:'job-test',expectedActiveCount:6,outputDir,now:() => new Date('2026-08-22T00:01:00Z') });
  assert.notEqual(first.runId,second.runId);
  assert.equal(first.qa.pass,true);assert.equal(second.qa.pass,true);
  assert.equal(first.activeProducts,6);
  assert.deepEqual(first.businessSummary,{ total:6,eligibleCount:3,excludedCount:0,pendingFineClassificationCount:3,
    electronicsCount:0,usbCount:0,batteryCount:0,certificationRiskCount:0,priceBelow5Count:0,screeningWarningCount:5,needsFineClassificationCount:3 });
  assert.equal(first.categoryMetrics.reduce((sum,item) => sum+item.productCount,0),6);
  const db=openDatabase(databasePath,{ readOnly:true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM market_analysis_runs WHERE status='completed'").get().count,2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM category_metrics').get().count,6);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products WHERE external_product_id='inactive'").get().count,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM product_snapshots WHERE product_id=(SELECT id FROM products WHERE external_product_id='inactive')").get().count,1);
  } finally { db.close(); }
  const { FileBlob,SpreadsheetFile }=await loadArtifactTool();
  const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(second.workbookPath));
  assert.deepEqual(workbook.worksheets.items.map(sheet => sheet.name),['市场总览','类目分析','商品指标','字段说明']);
  const values=workbook.worksheets.getItem('商品指标').getUsedRange(true).values;
  assert.equal(values.length-1,6);
  assert.ok(!values.flat().includes('inactive'));
  const headers=values[0];const statusIndex=headers.indexOf('业务准入状态');const fineIndex=headers.indexOf('needs_fine_classification');
  assert.deepEqual(values.slice(1).map(row => row[statusIndex]),['可做','可做','待细分类','可做','待细分类','待细分类']);
  assert.equal(values.slice(1).filter(row => row[fineIndex] === '是').length,3);
  assert.ok(fs.existsSync(path.join(outputDir,'category-opportunity.json')));
  assert.ok(fs.existsSync(path.join(outputDir,'business-alignment.json')));
  const queue=JSON.parse(fs.readFileSync(path.join(outputDir,'day9-fine-classification-queue.json'),'utf8'));
  assert.equal(queue.count,3);
  assert.ok(fs.existsSync(path.join(outputDir,'market-analysis-qa.json')));
});

function seed(databasePath) {
  const db=openDatabase(databasePath);
  try {
    db.prepare(`INSERT INTO crawl_jobs(id,job_type,status,target_count,config_json,requested_at,created_at,updated_at,started_at,finished_at)
      VALUES('job-test','catalog','completed',6,'{}','2026-08-21','2026-08-21','2026-08-21','2026-08-21','2026-08-21')`).run();
    const insertProduct=db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,source_url,title,status,first_seen_at,last_seen_at)
      VALUES('temu',?,?,?,?, 'active','2026-08-21','2026-08-21')`);
    const insertMembership=db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,
      source_page_url,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id) VALUES(?,'德国','en','EUR','Automotive','Motorcycle',
      'https://www.temu.com/category','Top Sales',?,?, '2026-08-21','2026-08-21','job-test')`);
    const insertSnapshot=db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title,price_amount,currency,sales_count,rating,review_count,listing_rank)
      VALUES('job-test',?,'2026-08-21',?,?,?,'EUR',?,?,?,?)`);
    const insertClassification=db.prepare(`INSERT INTO product_classifications(product_id,job_id,taxonomy,category_key,category_label,confidence,
      rule_version,needs_review,evidence_json,created_at,level1,level2,level3,method,reasons_json)
      VALUES(?,'job-test','week1-motorcycle-accessories',?,?,?,'week1-rule-v1',?,'[]','2026-08-21','摩托车配件','测试',?,'rule','[]')`);
    const categories=['刹车/控制','刹车/控制','照明','照明','其他','其他'];
    for (let index=0;index<6;index+=1) {
      const goodsId=`g${index+1}`;const title=`Product ${goodsId}`;const url=`https://www.temu.com/goods.html?goods_id=${goodsId}`;
      const productId=Number(insertProduct.run(goodsId,url,url,title).lastInsertRowid);
      insertMembership.run(productId,index+1,1);
      insertSnapshot.run(productId,url,title,10+index*5,100+index*50,index === 4 ? null : 4.2+index*0.1,index === 4 ? null : 10+index*20,index+1);
      const category=categories[index];const needsReview=category === '其他' || index === 2 ? 1 : 0;
      insertClassification.run(productId,category === '其他' ? 'other' : `c${index}`,category,needsReview ? 0.35 : 0.8,needsReview,category);
    }
    const inactiveId=Number(insertProduct.run('inactive','https://www.temu.com/goods.html?goods_id=inactive','https://www.temu.com/goods.html?goods_id=inactive','Inactive Product').lastInsertRowid);
    insertMembership.run(inactiveId,7,0);
    insertSnapshot.run(inactiveId,'https://www.temu.com/goods.html?goods_id=inactive','Inactive Product',999,99999,5,9999,7);
  } finally { db.close(); }
}
