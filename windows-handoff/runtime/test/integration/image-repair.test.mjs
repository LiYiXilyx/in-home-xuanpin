import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createImageRepository } from '../../src/db/repositories/image-repository.mjs';

test('duplicate image retry is idempotent and a failed retry cannot downgrade completed cache',t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-image-repair-'));
  const databasePath=path.join(directory,'v2.db');
  migrateDatabase({ databasePath });
  const db=openDatabase(databasePath);
  t.after(() => db.close());
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,first_seen_at,last_seen_at)
    VALUES('temu','1','https://www.temu.com/goods.html?goods_id=1','2026-08-21','2026-08-21')`).run();
  const productId=Number(db.prepare("SELECT id FROM products WHERE external_product_id='1'").get().id);
  const repository=createImageRepository(db,{ now:() => '2026-08-21T00:00:00.000Z' });
  const completed={ source_url:'https://img.test/1.avif',local_path:'outputs/image-cache/1.avif',
    content_type:'image/avif',content_sha256:'abc',byte_length:2048,download_status:'completed',
    downloaded_at:'2026-08-21T00:00:00.000Z',fetch_strategy:'browser' };
  repository.upsert(productId,completed);
  repository.upsert(productId,completed);
  repository.upsert(productId,{ source_url:completed.source_url,download_status:'failed',error_message:'temporary timeout' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM product_images').get().count,1);
  const row=db.prepare('SELECT * FROM product_images').get();
  assert.equal(row.download_status,'completed');
  assert.equal(row.local_path,completed.local_path);
  assert.equal(row.content_sha256,'abc');
  assert.equal(row.last_error,null);
  assert.equal(row.downloaded_at,'2026-08-21T00:00:00.000Z');
});
