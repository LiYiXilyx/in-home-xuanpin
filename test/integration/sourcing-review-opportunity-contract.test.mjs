import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createTemuSourcingContextRepository,openTemuContextDatabase } from '../../src/db/repositories/temu-sourcing-context-repository.mjs';

test('Temu review contexts are batch read-only and never take an unscoped latest sourcing cluster',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'review-context-'));
  const dbPath=path.join(root,'temu.db'),imageRoot=path.join(root,'images');fs.mkdirSync(imageRoot);
  const db=new DatabaseSync(dbPath);db.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY,platform TEXT,external_product_id TEXT,title TEXT);
    CREATE TABLE product_images(id INTEGER PRIMARY KEY,product_id INTEGER,image_kind TEXT,source_url TEXT,local_path TEXT,status TEXT,download_status TEXT,sha256 TEXT,content_sha256 TEXT);
    CREATE TABLE product_classifications(id INTEGER PRIMARY KEY,product_id INTEGER,level1 TEXT,level2 TEXT,level3 TEXT,created_at TEXT);
    CREATE TABLE sourcing_run_items(run_id TEXT,temu_goods_id TEXT,similar_cluster TEXT);
    INSERT INTO products VALUES(1,'temu','601','Title 601');
    INSERT INTO product_classifications VALUES(1,1,'DB-L1','DB-L2','DB-L3','2026-09-01');
    INSERT INTO sourcing_run_items VALUES('unrelated-newer','601','WRONG CLUSTER');
  `);db.close();
  const before=fs.readFileSync(dbPath);
  const readonly=openTemuContextDatabase(dbPath);
  try {
    const repo=createTemuSourcingContextRepository(readonly,{projectRoot:root,imageCacheRoot:imageRoot});
    const contexts=repo.getTemuContexts(['601','missing']);
    assert.equal(contexts.get('601').temu_title,'Title 601');
    assert.equal(contexts.get('601').similar_cluster,null);
    assert.equal(contexts.get('missing').temu_context_status,'MISSING');
  } finally { readonly.close(); }
  assert.deepEqual(fs.readFileSync(dbPath),before);
  fs.rmSync(root,{recursive:true,force:true});
});
