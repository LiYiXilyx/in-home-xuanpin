import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertSafeSupplierImageUrl,
  cacheRandom5Images,
  cacheSupplierImage,
} from '../../src/modules/sourcing/supplier-image-cache.mjs';

const sharp=loadSharpForTest();
const JPEG=await sharp({ create:{ width:2,height:2,channels:3,background:'#336699' } }).jpeg().toBuffer();
const PNG=await sharp({ create:{ width:2,height:2,channels:4,background:'#cc6633' } }).png().toBuffer();
const WEBP=await sharp({ create:{ width:2,height:2,channels:3,background:'#33aa66' } }).webp().toBuffer();
const PUBLIC_RESOLVER=async()=>['93.184.216.34'];

function loadSharpForTest() {
  const dependencyRoot=process.env.TEMU_ARTIFACT_NODE_MODULES;
  const require=dependencyRoot?createRequire(path.join(path.resolve(dependencyRoot),'package.json')):createRequire(import.meta.url);
  return require('sharp');
}

async function setup(t) {
  const cacheRoot=await fs.mkdtemp(path.join(os.tmpdir(),'supplier-image-cache-'));
  t.after(()=>fs.rm(cacheRoot,{ recursive:true,force:true }));
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://test.local');
    if(url.pathname==='/jpeg') return send(response,200,'image/jpeg',JPEG);
    if(url.pathname==='/png') return send(response,200,'image/png',PNG);
    if(url.pathname==='/webp') return send(response,200,'image/webp',WEBP);
    if(url.pathname==='/wrong-type') return send(response,200,'text/plain',JPEG);
    if(url.pathname==='/html') return send(response,200,'image/jpeg',Buffer.from('<html>not an image</html>'));
    if(url.pathname==='/invalid-signature') return send(response,200,'image/jpeg',Buffer.from('not-image'));
    if(url.pathname==='/undecodable') return send(response,200,'image/jpeg',Buffer.from([0xff,0xd8,0xff,0x00,0x00,0x00]));
    if(url.pathname==='/oversized') return send(response,200,'image/jpeg',Buffer.alloc(2048,0xff));
    if(url.pathname==='/slow') return setTimeout(()=>send(response,200,'image/jpeg',JPEG),150);
    if(url.pathname==='/redirect-good') { response.writeHead(302,{ location:'/png' });return response.end(); }
    if(url.pathname==='/redirect-private') { response.writeHead(302,{ location:'http://127.0.0.1/private' });return response.end(); }
    if(url.pathname==='/redirect-chain') {
      const hop=Number(url.searchParams.get('hop')??0);
      response.writeHead(302,{ location:`/redirect-chain?hop=${hop+1}` });return response.end();
    }
    return send(response,404,'text/plain',Buffer.from('missing'));
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=server.address();
  const localBase=`http://127.0.0.1:${address.port}`;
  let calls=0;
  const fetchImpl=async(input,options)=>{
    calls+=1;
    const requested=new URL(input);
    return fetch(`${localBase}${requested.pathname}${requested.search}`,options);
  };
  return { cacheRoot,fetchImpl,calls:()=>calls };
}

function send(response,status,contentType,bytes) {
  response.writeHead(status,{ 'content-type':contentType,'content-length':bytes.length });
  response.end(bytes);
}

function candidate(goodsId,productId,urlPath) {
  return {
    temu_goods_id:String(goodsId),
    '1688_product_id':String(productId),
    '1688_image_url':`http://cdn.example.test${urlPath}`,
  };
}

function options(context,overrides={}) {
  return {
    cacheRoot:context.cacheRoot,
    resolveHost:PUBLIC_RESOLVER,
    fetchImpl:context.fetchImpl,
    now:()=>new Date('2026-08-31T01:00:00.000Z'),
    ...overrides,
  };
}

test('valid JPEG is decoded, re-encoded and atomically cached under its exact mapping', async t => {
  const context=await setup(t);
  const source=candidate('601','168801','/jpeg');
  const result=await cacheSupplierImage(source,options(context));

  assert.equal(result.image_download_status,'SUCCESS');
  assert.equal(result['1688_image_url'],source['1688_image_url']);
  assert.equal(result['1688_image_local_path'],'601/168801.jpg');
  assert.equal(result.image_downloaded_at,'2026-08-31T01:00:00.000Z');
  assert.match(result.image_sha256,/^[a-f0-9]{64}$/);
  assert.match(result.image_response_sha256,/^[a-f0-9]{64}$/);
  const finalPath=path.join(context.cacheRoot,'601','168801.jpg');
  const bytes=await fs.readFile(finalPath);
  assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
  assert.equal((await sharp(bytes).metadata()).format,'jpeg');
  assert.deepEqual((await fs.readdir(path.dirname(finalPath))).sort(),['168801.jpg']);
});

test('valid PNG is genuinely transcoded to JPEG', async t => {
  const context=await setup(t);
  const result=await cacheSupplierImage(candidate('601','png-product','/png'),options(context));
  const bytes=await fs.readFile(path.join(context.cacheRoot,result['1688_image_local_path']));
  assert.equal(result.image_download_status,'SUCCESS');
  assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
  assert.equal((await sharp(bytes).metadata()).format,'jpeg');
  assert.notEqual(result.image_sha256,result.image_response_sha256);
});

test('valid WebP is genuinely transcoded to JPEG when supported by sharp', async t => {
  const context=await setup(t);
  const result=await cacheSupplierImage(candidate('601','webp-product','/webp'),options(context));
  const bytes=await fs.readFile(path.join(context.cacheRoot,result['1688_image_local_path']));
  assert.equal(result.image_download_status,'SUCCESS');
  assert.equal((await sharp(bytes).metadata()).format,'jpeg');
});

test('content type, signature, decode, size, timeout and HTTP gates leave no final file', async t => {
  const context=await setup(t);
  const cases=[
    ['/wrong-type','wrong-type','IMAGE_CONTENT_TYPE',{}],
    ['/html','html','IMAGE_SIGNATURE',{}],
    ['/invalid-signature','invalid-signature','IMAGE_SIGNATURE',{}],
    ['/undecodable','undecodable','IMAGE_DECODE_FAILED',{}],
    ['/oversized','oversized','IMAGE_TOO_LARGE',{ maxResponseBytes:1024 }],
    ['/slow','slow','IMAGE_TIMEOUT',{ timeoutMs:30 }],
    ['/missing','missing','IMAGE_HTTP_STATUS',{}],
  ];
  for(const [urlPath,productId,errorCode,overrides] of cases) {
    const result=await cacheSupplierImage(candidate('601',productId,urlPath),options(context,overrides));
    assert.equal(result.image_download_status,'FAILED',productId);
    assert.equal(result.error_code,errorCode,productId);
    assert.equal(result['1688_image_local_path'],null,productId);
    assert.equal(result.image_downloaded_at,null,productId);
    assert.equal(result.image_sha256,null,productId);
    assert.equal(result.image_response_sha256,null,productId);
    await assert.rejects(()=>fs.access(path.join(context.cacheRoot,'601',`${productId}.jpg`)));
  }
});

test('manual redirects are followed only within the configured safe limit', async t => {
  const context=await setup(t);
  const redirected=await cacheSupplierImage(candidate('601','redirected','/redirect-good'),options(context,{ maxRedirects:2 }));
  assert.equal(redirected.image_download_status,'SUCCESS');
  assert.equal(context.calls(),2);

  const limited=await cacheSupplierImage(candidate('601','redirect-limit','/redirect-chain?hop=0'),options(context,{ maxRedirects:2 }));
  assert.equal(limited.image_download_status,'FAILED');
  assert.equal(limited.error_code,'IMAGE_REDIRECT_LIMIT');
});

test('SSRF gate rejects forbidden schemes, hosts and address ranges', async () => {
  const blocked=[
    'file:///etc/passwd','data:image/png;base64,AA==','ftp://example.com/a.jpg',
    'http://localhost/a.jpg','http://sub.localhost/a.jpg','http://127.0.0.1/a.jpg',
    'http://10.0.0.1/a.jpg','http://172.16.0.1/a.jpg','http://192.168.1.1/a.jpg',
    'http://169.254.169.254/latest/meta-data','http://100.100.100.200/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1','http://[::1]/a.jpg',
    'http://[::ffff:127.0.0.1]/a.jpg','http://[fc00::1]/a.jpg','http://[fe80::1]/a.jpg',
  ];
  for(const url of blocked) {
    await assert.rejects(
      ()=>assertSafeSupplierImageUrl(url,{ resolveHost:PUBLIC_RESOLVER }),
      error=>error?.code==='IMAGE_URL_BLOCKED',url,
    );
  }
  await assert.rejects(
    ()=>assertSafeSupplierImageUrl('https://cdn.example.test/a.jpg',{ resolveHost:async()=>['93.184.216.34','10.0.0.8'] }),
    error=>error?.code==='IMAGE_URL_BLOCKED',
  );
});

test('direct private URL and redirect to private URL fail before forbidden fetch', async t => {
  const context=await setup(t);
  let forbiddenCalls=0;
  const direct=await cacheSupplierImage(candidate('601','direct-private','/jpeg'),options(context,{
    fetchImpl:async()=>{ forbiddenCalls+=1;throw new Error('must not fetch'); },
    resolveHost:async()=>['10.0.0.8'],
  }));
  assert.equal(direct.image_download_status,'FAILED');
  assert.equal(direct.error_code,'IMAGE_URL_BLOCKED');
  assert.equal(forbiddenCalls,0);

  const redirected=await cacheSupplierImage(candidate('601','redirect-private','/redirect-private'),options(context));
  assert.equal(redirected.image_download_status,'FAILED');
  assert.equal(redirected.error_code,'IMAGE_URL_BLOCKED');
  assert.equal(context.calls(),1);
});

test('cache reuse requires exact mapping, URL, JPEG decode and recorded SHA', async t => {
  const context=await setup(t);
  const source=candidate('601','p1','/jpeg');
  const first=await cacheSupplierImage(source,options(context));
  const callsAfterFirst=context.calls();
  const reused=await cacheSupplierImage(source,options(context,{ existingRecord:first }));
  assert.equal(reused.cache_reused,true);
  assert.equal(context.calls(),callsAfterFirst);

  await fs.writeFile(path.join(context.cacheRoot,'601','p1.jpg'),'corrupt');
  const repaired=await cacheSupplierImage(source,options(context,{ existingRecord:first }));
  assert.equal(repaired.image_download_status,'SUCCESS');
  assert.equal(repaired.cache_reused,false);
  assert.equal(context.calls(),callsAfterFirst+1);

  const changed=await cacheSupplierImage(candidate('601','p1','/png'),options(context,{ existingRecord:repaired }));
  assert.equal(changed.image_download_status,'SUCCESS');
  assert.equal(changed['1688_image_url'],'http://cdn.example.test/png');
  assert.equal(context.calls(),callsAfterFirst+2);
});

test('same product ID under another goods ID never reuses the first goods cache', async t => {
  const context=await setup(t);
  const first=await cacheSupplierImage(candidate('601','shared','/jpeg'),options(context));
  const callsAfterFirst=context.calls();
  const second=await cacheSupplierImage(candidate('602','shared','/jpeg'),options(context,{ existingRecord:first }));

  assert.equal(second.image_download_status,'SUCCESS');
  assert.equal(second.cache_reused,false);
  assert.equal(second['1688_image_local_path'],'602/shared.jpg');
  assert.equal(context.calls(),callsAfterFirst+1);
  await fs.access(path.join(context.cacheRoot,'601','shared.jpg'));
  await fs.access(path.join(context.cacheRoot,'602','shared.jpg'));
});

test('missing image URL fails only that candidate and the Random5 batch continues', async t => {
  const context=await setup(t);
  const missing={ temu_goods_id:'601','1688_product_id':'missing-url','1688_image_url':null };
  const valid=candidate('601','after-missing','/jpeg');

  const result=await cacheRandom5Images([missing,valid],options(context));

  assert.equal(result.success,1);
  assert.equal(result.failed,1);
  assert.equal(result.results[0].image_download_status,'FAILED');
  assert.equal(result.results[0].error_code,'IMAGE_MAPPING_INVALID');
  assert.equal(result.results[1].image_download_status,'SUCCESS');
});
