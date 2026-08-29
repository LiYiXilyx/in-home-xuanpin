import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createInputPackage,sha256File,validateInputPackage } from '../../src/modules/sourcing/input-package.mjs';

const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-image-'));
async function avif(file,color){await sharp({create:{width:12,height:8,channels:4,background:color}}).avif({quality:80}).toFile(file);}

test('valid AVIF becomes valid JPEG without changing source or goods mapping',async()=>{
  const root=temp(),a=path.join(root,'goods-a.avif'),b=path.join(root,'goods-b.avif');await avif(a,{r:255,g:0,b:0,alpha:0.7});await avif(b,{r:0,g:0,b:255,alpha:1});
  const beforeA=sha256File(a),beforeB=sha256File(b),out=path.join(root,'input','run-avif');
  const result=await createInputPackage({runId:'run-avif',gitCommit:'abc123',inputDir:out,goods:[{temu_goods_id:'goods-a',temu_title:'A',temu_image_path:a},{temu_goods_id:'goods-b',temu_title:'B',temu_image_path:b}]});
  const checked=await validateInputPackage(out,{expectedRunId:'run-avif',expectedTarget:2});assert.equal(sha256File(a),beforeA);assert.equal(sha256File(b),beforeB);
  assert.deepEqual(checked.goods.map(x=>x.temu_goods_id),['goods-a','goods-b']);assert.ok(checked.goods.every(x=>x.source_image_format==='AVIF'&&x.search_image_format==='JPEG'&&x.image_conversion==='AVIF_TO_JPEG'));
  assert.ok(checked.goods.every(x=>x.search_image_path===`images/${x.temu_goods_id}.jpg`));assert.notEqual(result.goods[0].search_image_sha256,result.goods[1].search_image_sha256);
});

test('invalid AVIF fails and cannot create a cross-product package',async()=>{
  const root=temp(),invalid=path.join(root,'bad.avif'),valid=path.join(root,'good.avif'),out=path.join(root,'input','run-invalid');fs.writeFileSync(invalid,'not-an-avif');await avif(valid,{r:1,g:2,b:3,alpha:1});
  await assert.rejects(()=>createInputPackage({runId:'run-invalid',gitCommit:'abc123',inputDir:out,goods:[{temu_goods_id:'bad',temu_title:'Bad',temu_image_path:invalid},{temu_goods_id:'good',temu_title:'Good',temu_image_path:valid}]}),/原始图片无效/);assert.equal(fs.existsSync(out),false);
});
