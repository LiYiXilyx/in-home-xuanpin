import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createFineClassificationRepository } from '../../src/db/repositories/fine-classification-repository.mjs';

test('fine classification audit is idempotent for the same product input and version',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-fine-idempotent-'));t.after(() => fs.rmSync(directory,{ recursive:true,force:true }));const databasePath=path.join(directory,'v2.db');migrateDatabase({ databasePath });const db=openDatabase(databasePath);
  try {
    db.prepare(`INSERT INTO crawl_jobs(id,job_type,status,target_count,config_json,requested_at,created_at,updated_at) VALUES('job','catalog','completed',1,'{}','2026-08-22','2026-08-22','2026-08-22')`).run();
    const productId=Number(db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,title,status,first_seen_at,last_seen_at) VALUES('temu','g1','https://example/g1','Tail bag','active','2026-08-22','2026-08-22')`).run().lastInsertRowid);
    const repository=createFineClassificationRepository(db);const attempt={ productId,jobId:'job',taxonomy:'week2-motorcycle-fine-v1',method:'rule',promptVersion:'week2-fine-prompt-v1',inputHash:'abc',structuredOutput:{ level3:'尾包与后座包' },validationResult:{ valid:true,errors:[] },confidence:0.9,unresolvedReason:null,classifiedAt:'2026-08-22T00:00:00.000Z' };
    repository.saveAttempts([attempt]);repository.saveAttempts([{ ...attempt,classifiedAt:'2026-08-22T00:01:00.000Z' }]);
    assert.equal(repository.count('job','week2-motorcycle-fine-v1').attempts,1);assert.equal(db.prepare('SELECT classified_at FROM fine_classification_attempts').get().classified_at,'2026-08-22T00:01:00.000Z');
  } finally { db.close(); }
});
