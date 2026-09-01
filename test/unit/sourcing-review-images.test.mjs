import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createSourcingReviewImageResolver } from '../../src/modules/sourcing/sourcing-review-images.mjs';

async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-images-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const supplierRoot=path.join(root,'supplier-cache');
  const temuRoot=path.join(root,'outputs/week1-mvp/image-cache');
  await fs.mkdir(path.join(supplierRoot,'601'),{recursive:true});
  await fs.mkdir(temuRoot,{recursive:true});
  const jpeg=await sharp({create:{width:8,height:6,channels:3,background:'#336699'}}).jpeg().toBuffer();
  const avif=await sharp({create:{width:8,height:6,channels:3,background:'#993366'}}).avif().toBuffer();
  await fs.writeFile(path.join(supplierRoot,'601','p1.jpg'),jpeg);
  await fs.writeFile(path.join(temuRoot,'601.avif'),avif);
  return {
    root,supplierRoot,temuRoot,jpeg,avif,
    run:{run_id:'run',image_cache_dir:supplierRoot},
    candidate:{
      temu_goods_id:'601','1688_product_id':'p1',supplier_product_id:'p1',
      '1688_image_local_path':'601/p1.jpg',supplier_image_local_path:'601/p1.jpg',
      '1688_image_url':'https://img.example/p1.jpg',supplier_image_url:'https://img.example/p1.jpg',
      image_download_status:'SUCCESS',image_sha256:sha256(jpeg),
    },
    temuContext:{
      temu_goods_id:'601',temu_context_status:'AVAILABLE',
      temu_image_local_path:'outputs/week1-mvp/image-cache/601.avif',
      temu_image_canonical_path:await fs.realpath(path.join(temuRoot,'601.avif')),
    },
  };
}

test('valid supplier cache is preferred and returns bytes without an absolute path',async t=>{
  const c=await setup(t);
  const resolver=createSourcingReviewImageResolver({projectRoot:c.root,temuImageRoot:c.temuRoot});
  const result=await resolver.resolveSupplierImage({run:c.run,candidate:c.candidate});
  assert.equal(result.kind,'LOCAL');
  assert.equal(result.contentType,'image/jpeg');
  assert.deepEqual(result.bytes,c.jpeg);
  assert.equal(result.display_anomaly,false);
  assert.equal(result.image_failed,false);
  assert.equal('path' in result,false);
  assert.equal('absolutePath' in result,false);
  assert.equal(JSON.stringify(result).includes(c.root),false);
});

test('missing local supplier cache falls back to recorded URL without downloading',async t=>{
  const c=await setup(t);
  const resolver=createSourcingReviewImageResolver({projectRoot:c.root,temuImageRoot:c.temuRoot});
  const candidate={...c.candidate,supplier_image_local_path:'601/missing.jpg','1688_image_local_path':'601/missing.jpg'};
  const result=await resolver.resolveSupplierImage({run:c.run,candidate});
  assert.deepEqual(result,{
    kind:'URL_FALLBACK',url:'https://img.example/p1.jpg',display_anomaly:true,image_failed:true,
  });
});

test('supplier mapping blocks traversal absolute cross-goods cross-product and symlink escape',async t=>{
  const c=await setup(t);
  const outside=path.join(c.root,'outside.jpg');
  await fs.writeFile(outside,c.jpeg);
  const symlink=path.join(c.supplierRoot,'601','symlink.jpg');
  await fs.symlink(outside,symlink);
  const resolver=createSourcingReviewImageResolver({projectRoot:c.root,temuImageRoot:c.temuRoot});
  for(const localPath of [
    '../outside.jpg',outside,'602/p1.jpg','601/other.jpg','601/symlink.jpg',
  ]) {
    const result=await resolver.resolveSupplierImage({
      run:c.run,candidate:{...c.candidate,supplier_image_local_path:localPath,'1688_image_local_path':localPath},
    });
    assert.equal(result.kind,'URL_FALLBACK',localPath);
    assert.equal(result.display_anomaly,true,localPath);
  }
});

test('supplier SHA mismatch, corrupt JPEG and undecodable JPEG are rejected',async t=>{
  const c=await setup(t);
  const resolver=createSourcingReviewImageResolver({projectRoot:c.root,temuImageRoot:c.temuRoot});
  let result=await resolver.resolveSupplierImage({run:c.run,candidate:{...c.candidate,image_sha256:'0'.repeat(64)}});
  assert.equal(result.kind,'URL_FALLBACK');
  await fs.writeFile(path.join(c.supplierRoot,'601','p1.jpg'),Buffer.from('not-jpeg'));
  result=await resolver.resolveSupplierImage({run:c.run,candidate:{...c.candidate,image_sha256:sha256(Buffer.from('not-jpeg'))}});
  assert.equal(result.kind,'URL_FALLBACK');
  const undecodable=Buffer.from([0xff,0xd8,0xff,0x00,0x00]);
  await fs.writeFile(path.join(c.supplierRoot,'601','p1.jpg'),undecodable);
  result=await resolver.resolveSupplierImage({run:c.run,candidate:{...c.candidate,image_sha256:sha256(undecodable)}});
  assert.equal(result.kind,'URL_FALLBACK');
});

test('Temu image uses exact context mapping and missing context stays MISSING',async t=>{
  const c=await setup(t);
  const resolver=createSourcingReviewImageResolver({projectRoot:c.root,temuImageRoot:c.temuRoot});
  const valid=await resolver.resolveTemuImage(c.temuContext);
  assert.equal(valid.kind,'LOCAL');
  assert.deepEqual(valid.bytes,c.avif);
  assert.equal('path' in valid,false);

  const crossGoods=await resolver.resolveTemuImage({...c.temuContext,temu_goods_id:'602'});
  assert.deepEqual(crossGoods,{kind:'MISSING'});
  assert.deepEqual(await resolver.resolveTemuImage({temu_goods_id:'601',temu_context_status:'MISSING'}),{kind:'MISSING'});
});

test('Temu image resolves from an explicit data path base after runtime relocation',async t=>{
  const c=await setup(t),runtimeRoot=path.join(c.root,'stable-runtime');
  await fs.mkdir(runtimeRoot);
  const resolver=createSourcingReviewImageResolver({
    projectRoot:runtimeRoot,temuPathBase:c.root,temuImageRoot:c.temuRoot,
  });
  const result=await resolver.resolveTemuImage(c.temuContext);
  assert.equal(result.kind,'LOCAL');
  assert.deepEqual(result.bytes,c.avif);
});

test('failed DB status is an image failure and empty URL yields placeholder',async t=>{
  const c=await setup(t);
  const resolver=createSourcingReviewImageResolver({projectRoot:c.root,temuImageRoot:c.temuRoot});
  const result=await resolver.resolveSupplierImage({run:c.run,candidate:{
    ...c.candidate,image_download_status:'FAILED',supplier_image_url:null,'1688_image_url':null,
  }});
  assert.deepEqual(result,{kind:'PLACEHOLDER',display_anomaly:false,image_failed:true});
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
