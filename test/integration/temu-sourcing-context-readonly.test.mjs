import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  createTemuSourcingContextRepository,
  openTemuContextDatabase,
} from '../../src/db/repositories/temu-sourcing-context-repository.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { verifySourcingSafety } from '../../scripts/1688/verify-sourcing-safety.mjs';

function setup(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-context-ro-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const imageRoot=path.join(directory,'outputs/week1-mvp/image-cache');
  fs.mkdirSync(imageRoot,{recursive:true});
  fs.writeFileSync(path.join(imageRoot,'601.avif'),Buffer.from('validated-image'));
  fs.writeFileSync(path.join(imageRoot,'602.avif'),Buffer.from('second-image'));
  const databasePath=path.join(directory,'temu.db');
  const db=new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY,platform TEXT NOT NULL,external_product_id TEXT NOT NULL,title TEXT,UNIQUE(platform,external_product_id));
    CREATE TABLE product_images(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL,image_kind TEXT,source_url TEXT,local_path TEXT,status TEXT,download_status TEXT,sha256 TEXT,content_sha256 TEXT);
    CREATE TABLE product_classifications(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL,level1 TEXT,level2 TEXT,level3 TEXT,created_at TEXT);
    CREATE TABLE sourcing_run_items(run_id TEXT,temu_goods_id TEXT,similar_cluster TEXT);
    CREATE TABLE catalog_pool_versions(id TEXT,category_key TEXT,status TEXT,activated_at TEXT,product_count INTEGER);
    INSERT INTO products VALUES(1,'temu','601','Temu title 601'),(2,'temu','602','Temu title 602');
    INSERT INTO product_images VALUES
      (1,1,'main','https://img.example/601','outputs/week1-mvp/image-cache/601.avif','downloaded','completed','sha601','sha601'),
      (2,2,'main','https://img.example/602','outputs/week1-mvp/image-cache/602.avif','downloaded','completed','sha602','sha602');
    INSERT INTO product_classifications VALUES(1,1,'L1','L2','L3','2026-08-31T00:00:00Z');
    INSERT INTO sourcing_run_items VALUES('old','601','cluster-a');
    INSERT INTO catalog_pool_versions VALUES('pool','motorcycle-accessories','active','2026-08-31',2135);
  `);
  db.close();
  return {directory,databasePath,imageRoot};
}

test('dedicated Temu connection rejects INSERT UPDATE DELETE and DDL',t=>{
  const {databasePath}=setup(t);
  const db=openTemuContextDatabase(databasePath);
  t.after(()=>db.close());
  for(const sql of [
    "INSERT INTO products VALUES(3,'temu','603','x')",
    "UPDATE products SET title='changed' WHERE id=1",
    'DELETE FROM products WHERE id=1',
    'CREATE TABLE forbidden(id INTEGER)',
    'ALTER TABLE products ADD COLUMN forbidden TEXT',
  ]) assert.throws(()=>db.exec(sql),/read-only|readonly/i);
  assert.equal(db.prepare("SELECT title FROM products WHERE external_product_id='601'").get().title,'Temu title 601');
});

test('exact goods mapping returns title image and optional classification context',t=>{
  const {databasePath,directory}=setup(t);
  const db=openTemuContextDatabase(databasePath);
  t.after(()=>db.close());
  const repository=createTemuSourcingContextRepository(db,{projectRoot:directory});

  const context=repository.getTemuContext('601');
  assert.equal(context.temu_context_status,'AVAILABLE');
  assert.equal(context.temu_goods_id,'601');
  assert.equal(context.temu_title,'Temu title 601');
  assert.equal(context.temu_image_local_path,'outputs/week1-mvp/image-cache/601.avif');
  assert.equal(context.temu_image_canonical_path,fs.realpathSync(path.join(directory,'outputs/week1-mvp/image-cache/601.avif')));
  assert.deepEqual({level1:context.level1,level2:context.level2,level3:context.level3,similar_cluster:context.similar_cluster},{
    level1:'L1',level2:'L2',level3:'L3',similar_cluster:'cluster-a',
  });
  assert.equal(repository.getActivePoolCount(),2135);
});

test('missing or unsafe image mapping stays MISSING and never borrows cross-goods image',t=>{
  const {databasePath,directory}=setup(t);
  const writable=new DatabaseSync(databasePath);
  writable.prepare("UPDATE product_images SET local_path='outputs/week1-mvp/image-cache/602.avif' WHERE product_id=1").run();
  writable.close();
  const db=openTemuContextDatabase(databasePath);
  t.after(()=>db.close());
  const repository=createTemuSourcingContextRepository(db,{projectRoot:directory});

  const unsafe=repository.getTemuContext('601');
  assert.equal(unsafe.temu_context_status,'MISSING');
  assert.equal(unsafe.temu_title,'Temu title 601');
  assert.equal(unsafe.temu_image_local_path,null);
  assert.equal(repository.getTemuContext('missing').temu_context_status,'MISSING');
  assert.notEqual(unsafe.temu_image_canonical_path,path.join(directory,'outputs/week1-mvp/image-cache/602.avif'));
});

test('current 50 sourcing goods map exactly to 50 Temu contexts without logical drift',async t=>{
  const projectRoot=fileURLToPath(new URL('../..',import.meta.url));
  const sourcingPath=path.join(projectRoot,'data/1688_sourcing.db');
  const temuPath=path.join(projectRoot,'data/temu_research_v2.db');
  const before=await verifySourcingSafety({databasePath:temuPath,label:'r3-before'});
  const sourcing=openDatabase(sourcingPath,{readOnly:true});
  const ids=sourcing.prepare(`SELECT temu_goods_id FROM sourcing_run_items
    WHERE run_id='yingdao_random5_v1_20260831_001' ORDER BY temu_goods_id`).all().map(row=>String(row.temu_goods_id));
  sourcing.close();
  const temu=openTemuContextDatabase(temuPath);
  try {
    const repository=createTemuSourcingContextRepository(temu,{projectRoot});
    const contexts=ids.map(id=>repository.getTemuContext(id));
    assert.equal(ids.length,50);
    assert.equal(contexts.filter(row=>row.temu_context_status==='AVAILABLE').length,50);
    assert.equal(contexts.filter(row=>row.temu_context_status==='MISSING').length,0);
    assert.equal(contexts.every(row=>row.temu_title&&row.temu_image_canonical_path),true);
    assert.equal(repository.getActivePoolCount(),2135);
  } finally { temu.close(); }
  const after=await verifySourcingSafety({databasePath:temuPath,label:'r3-after'});
  assert.equal(after.temu.logical_sha256,before.temu.logical_sha256);
  assert.deepEqual(after.activePool,before.activePool);
  assert.equal(after.activePool.count,2135);
});
