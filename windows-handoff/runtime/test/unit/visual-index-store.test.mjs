import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,stat} from 'node:fs/promises';import {readFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createVisualIndexStore} from '../../src/modules/sourcing/visual-index-store.mjs';
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABCf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=','base64');
test('builds atomically, is idempotent, and reports stale identity',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'visual-index-'));let calls=0;
 const backend={info:async()=>({model_id:'m',model_revision:1,model_hash:'h',embedding_dimension:2}),embedBatch:async jobs=>{calls++;return jobs.map(j=>({goods_id:j.goods_id,vector:[1,0],dimension:2}))}};
 const store=createVisualIndexStore({cacheRoot:root,embeddingBackend:backend,preprocess:async()=>({jpeg,perceptual_hash:'00'})});
 const universe={fingerprint:'book',pool_version_id:'pool',items:[{goods_id:'g1',image_bytes:jpeg,title:'a'}],universe_goods_count:1,universe_image_count:1};
 const first=await store.build({universe});const second=await store.build({universe});
 assert.equal(first.status,'READY');assert.equal(second.reused,true);assert.equal(calls,1);assert.equal((await store.status({universe})).status,'READY');
 assert.equal((await store.status({universe:{...universe,fingerprint:'changed'}})).status,'NOT_BUILT');
 assert.equal(JSON.parse(await readFile(path.join(first.index_path,'manifest.json'),'utf8')).indexed_image_count,1);
 const loadedOnce=await store.loadReady({universe});
 const loadedTwice=await store.loadReady({universe});
 assert.strictEqual(loadedTwice,loadedOnce,'same index fingerprint must reuse the parsed in-memory index');
});

test('builds retrieval and display assets independently without changing index identity',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'visual-display-index-'));
 const backend={info:async()=>({model_id:'m',model_revision:1,model_hash:'h',embedding_dimension:2}),embedBatch:async jobs=>jobs.map(j=>({goods_id:j.goods_id,vector:[1,0]}))};
 const source=await import('sharp').then(({default:sharp})=>sharp({create:{width:500,height:300,channels:3,background:'#f00'}}).png().toBuffer());
 const store=createVisualIndexStore({cacheRoot:root,embeddingBackend:backend});
 const universe={fingerprint:'same-book',pool_version_id:'pool',items:[{goods_id:'g1',image_bytes:source,title:'a'}],universe_goods_count:1,universe_image_count:1};
 const before=await store.build({universe});
 assert.equal((await store.upgradeDisplayAssets({universe})).display_assets_version,'v1');
 const after=await store.status({universe});
 assert.equal(after.index_fingerprint,before.index_fingerprint);
 const loaded=await store.loadReady({universe});
 assert.match(loaded.products[0].thumbnail_path,/^retrieval\//);
 const display=await store.displayAsset({universe,goodsId:'g1'});
 assert.equal(display.kind,'INDEX_DISPLAY_THUMBNAIL');
 assert.equal(display.width,500);assert.equal(display.height,300);
 await stat(path.join(before.index_path,'display','g1.jpg'));
});

test('display assets never enlarge a low resolution workbook image',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'visual-display-small-'));
 const backend={info:async()=>({model_id:'m',model_revision:1,model_hash:'h',embedding_dimension:1}),embedBatch:async jobs=>jobs.map(j=>({goods_id:j.goods_id,vector:[1]}))};
 const source=await import('sharp').then(({default:sharp})=>sharp({create:{width:80,height:60,channels:3,background:'#0f0'}}).png().toBuffer());
 const store=createVisualIndexStore({cacheRoot:root,embeddingBackend:backend});
 const universe={fingerprint:'small-book',pool_version_id:'pool',items:[{goods_id:'g1',image_bytes:source}],universe_goods_count:1,universe_image_count:1};
 await store.build({universe});const display=await store.displayAsset({universe,goodsId:'g1'});
 assert.deepEqual([display.width,display.height],[80,60]);assert.equal(display.low_resolution,true);
});

test('CLI exposes display-assets-only upgrade without rebuilding embeddings',()=>{
 const source=readFileSync(new URL('../../scripts/1688/build-visual-index.mjs',import.meta.url),'utf8');
 assert.match(source,/display-assets-only/);assert.match(source,/upgradeDisplayAssets/);
});
