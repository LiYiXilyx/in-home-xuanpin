import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { runLifecycleAnalysis } from '../../src/modules/analysis/lifecycle-service.mjs';
import { loadArtifactTool } from '../../src/modules/analysis/artifact-runtime.mjs';

test('Day10 persists one lifecycle metric per active product, exports Excel and preserves Product Pool',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-lifecycle-'));t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  const databasePath=path.join(directory,'v2.db');migrateDatabase({ databasePath });seed(databasePath);
  const config={ configPath:path.join(directory,'config.json'),app:{ databasePath } };const outputDir=path.join(directory,'week2');
  const result=await runLifecycleAnalysis(config,{ expectedActiveCount:3,outputDir,asOfDate:'2026-08-24',now:() => new Date('2026-08-24T12:00:00Z'),render:false });
  assert.equal(result.qa.pass,true);assert.equal(result.summary.activeProducts,3);assert.equal(result.summary.reviewedProducts,2);assert.equal(result.summary.dataInsufficient,1);
  const db=openDatabase(databasePath,{ readOnly:true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) count FROM product_lifecycle_runs').get().count,1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM product_lifecycle_metrics').get().count,3);
    const counts=db.prepare('SELECT (SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM catalog_memberships) memberships,(SELECT COUNT(*) FROM product_snapshots) snapshots').get();
    assert.equal(counts.products,3);assert.equal(counts.memberships,3);assert.equal(counts.snapshots,3);
  } finally { db.close(); }
  const { FileBlob,SpreadsheetFile }=await loadArtifactTool();const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(result.workbookPath));
  assert.deepEqual(workbook.worksheets.items.map(sheet => sheet.name),['生命周期总览','生命周期明细','字段说明']);
  assert.equal(workbook.worksheets.getItem('生命周期明细').getUsedRange(true).values.length-1,3);
});

function seed(databasePath) {
  const db=openDatabase(databasePath);try {
    db.prepare(`INSERT INTO crawl_jobs(id,job_type,status,target_count,config_json,requested_at,created_at,updated_at,started_at,finished_at)
      VALUES('catalog-job','catalog','completed',3,'{}','2026-08-21','2026-08-21','2026-08-21','2026-08-21','2026-08-21')`).run();
    db.prepare(`INSERT INTO crawl_jobs(id,job_type,status,target_count,config_json,requested_at,created_at,updated_at,started_at,finished_at)
      VALUES('review-job','reviews','completed',2,'{}','2026-08-24','2026-08-24','2026-08-24','2026-08-24','2026-08-24')`).run();
    const product=db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,source_url,title,status,first_seen_at,last_seen_at)
      VALUES('temu',?,?,?,?, 'active','2026-08-21','2026-08-24')`);
    const membership=db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,source_page_url,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id)
      VALUES(?,'德国','en','EUR','Automotive','Motorcycle','https://www.temu.com/category','Top Sales',?,1,'2026-08-21','2026-08-24','catalog-job')`);
    const snapshot=db.prepare(`INSERT INTO product_snapshots(job_id,product_id,captured_at,source_url,title,price_amount,currency,sales_count,rating,review_count,listing_rank)
      VALUES('catalog-job',?,'2026-08-21',?,?,10,'EUR',100,4.8,?,?)`);
    const coverage=db.prepare(`INSERT INTO review_capture_coverage(job_id,product_id,goods_id,cutoff_date,reviews_captured,pages_scanned,crawl_completeness,task_status,stop_reason,checkpoint_json,created_at,updated_at,finished_at)
      VALUES('review-job',?,?, '2026-07-25',?,1,?,?,'CUTOFF_REACHED','{}','2026-08-24','2026-08-24','2026-08-24')`);
    const review=db.prepare(`INSERT INTO reviews(capture_job_id,product_id,goods_id,review_id,rating,content,review_date,has_image,image_urls_json,source_url,captured_at,content_fingerprint,dedupe_key,raw_json)
      VALUES('review-job',?,?,?,?,? ,?,0,'[]',?,'2026-08-24',?,?, '{}')`);
    for (let index=1;index<=3;index+=1) {
      const goodsId=`g${index}`;const url=`https://www.temu.com/goods.html?goods_id=${goodsId}`;const id=Number(product.run(goodsId,url,url,`Product ${index}`).lastInsertRowid);
      membership.run(id,index);snapshot.run(id,url,`Product ${index}`,index===1?20:500,index);
      if (index<3) {
        const dates=index===1?['2026-08-24','2026-08-18']:['2026-08-20','2026-08-10','2026-08-05'];coverage.run(id,goodsId,dates.length,'complete','completed');
        dates.forEach((date,i) => review.run(id,goodsId,`${goodsId}-${i}`,5,`review ${i}`,date,url,`${goodsId}-fp-${i}`,`${goodsId}-key-${i}`));
      }
    }
  } finally { db.close(); }
}
