import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createClassificationRepository } from '../../src/db/repositories/classification-repository.mjs';

test('classification persistence is idempotent and stores explainable rule fields',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-classification-'));
  const databasePath=path.join(directory,'v2.db'); migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);
  t.after(() => { db.close(); fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  db.prepare(`INSERT INTO crawl_jobs(id,job_type,status,target_count,config_json,requested_at,created_at,updated_at)
    VALUES('job-1','catalog','completed',1,'{}','2026-01-01','2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,first_seen_at,last_seen_at)
    VALUES('temu','1','https://www.temu.com/goods.html?goods_id=1','Phone mount','2026-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,
    sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id)
    VALUES(1,'德国','en','EUR','Automotive','Motorcycle','Top Sales',1,1,'2026-01-01','2026-01-01','job-1')`).run();
  const repository=createClassificationRepository(db);
  const item={ productId:1,taxonomy:'week1',categoryKey:'phone',categoryLabel:'手机支架',level1:'摩托车配件',
    level2:'安装与携带',level3:'手机支架',method:'rule',ruleVersion:'v1',confidence:0.78,needsReview:false,
    reasons:[{ code:'KEYWORD_MATCH',matchedKeywords:['phone mount'] }] };
  repository.replaceAll('job-1',[item],{ now:'2026-01-02' });
  repository.replaceAll('job-1',[item],{ now:'2026-01-03' });
  const row=db.prepare('SELECT * FROM product_classifications').get();
  assert.equal(db.prepare('SELECT COUNT(*) count FROM product_classifications').get().count,1);
  assert.equal(row.level1,'摩托车配件'); assert.equal(row.level3,'手机支架'); assert.equal(row.method,'rule');
  assert.equal(row.rule_version,'v1'); assert.equal(row.needs_review,0);
  assert.deepEqual(JSON.parse(row.reasons_json)[0].matchedKeywords,['phone mount']);
});
