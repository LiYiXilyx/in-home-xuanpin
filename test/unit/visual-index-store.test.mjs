import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
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
});
