import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cacheProductImage } from '../../src/modules/products/image-cache.mjs';

const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(1200)]);
const product = goodsId => ({ goods_id:goodsId,image_url:`https://img.test/${goodsId}.png` });
const browserResponse = (bytes=png,contentType='image/png') => ({ ok:true,status:200,contentType,bodyBase64:bytes.toString('base64') });

test('browser fetch success validates and preserves the detected image type',async t => {
  const dir=await temporaryDirectory(t);
  const result=await cacheProductImage(product('browser'),{
    cacheDir:dir,baseDir:dir,minimumBytes:100,attemptsPerStrategy:1,
    browserFetch:async () => browserResponse(),fetchImpl:async () => { throw new Error('node should not run'); }
  });
  assert.equal(result.download_status,'completed');
  assert.equal(result.fetch_strategy,'browser');
  assert.equal(result.content_type,'image/png');
  assert.match(result.local_path,/browser\.png$/);
});

test('Node fetch failure can fall back to browser fetch',async t => {
  const dir=await temporaryDirectory(t);
  const result=await cacheProductImage(product('fallback'),{
    cacheDir:dir,baseDir:dir,minimumBytes:100,attemptsPerStrategy:1,strategyOrder:['node','browser'],
    fetchImpl:async () => { throw Object.assign(new Error('blocked'),{ code:'EACCES' }); },
    browserFetch:async () => browserResponse()
  });
  assert.equal(result.download_status,'completed');
  assert.equal(result.fetch_strategy,'browser');
  assert.deepEqual(result.attempts.map(item => item.strategy),['node','browser']);
});

test('invalid content-type is rejected',async t => {
  const dir=await temporaryDirectory(t);
  const result=await cacheProductImage(product('html'),{
    cacheDir:dir,baseDir:dir,minimumBytes:100,attemptsPerStrategy:1,strategyOrder:['browser'],
    browserFetch:async () => browserResponse(Buffer.from(`<html>${'x'.repeat(200)}</html>`),'text/html')
  });
  assert.equal(result.download_status,'failed');
  assert.equal(result.error_code,'IMAGE_MIME_INVALID');
});

test('missing content-type is rejected for a network response',async t => {
  const dir=await temporaryDirectory(t);
  const result=await cacheProductImage(product('missing-mime'),{
    cacheDir:dir,baseDir:dir,minimumBytes:100,attemptsPerStrategy:1,strategyOrder:['browser'],
    browserFetch:async () => browserResponse(png,null)
  });
  assert.equal(result.download_status,'failed');
  assert.equal(result.error_code,'IMAGE_MIME_INVALID');
});

test('too-small image is rejected',async t => {
  const dir=await temporaryDirectory(t);
  const result=await cacheProductImage(product('small'),{
    cacheDir:dir,baseDir:dir,minimumBytes:100,attemptsPerStrategy:1,strategyOrder:['browser'],
    browserFetch:async () => browserResponse(png.subarray(0,20))
  });
  assert.equal(result.download_status,'failed');
  assert.equal(result.error_code,'IMAGE_TOO_SMALL');
});

test('existing valid cache is reused without a network request',async t => {
  const dir=await temporaryDirectory(t);
  await fs.writeFile(path.join(dir,'cached.png'),png);
  const result=await cacheProductImage(product('cached'),{
    cacheDir:dir,baseDir:dir,minimumBytes:100,
    browserFetch:async () => { throw new Error('browser should not run'); },
    fetchImpl:async () => { throw new Error('node should not run'); }
  });
  assert.equal(result.download_status,'completed');
  assert.equal(result.fetch_strategy,'cache');
});

async function temporaryDirectory(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'temu-image-cache-'));
  t.after(() => fs.rm(dir,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  return dir;
}
