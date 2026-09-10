import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {createLocalVisualEmbeddingBackend} from '../../src/modules/sourcing/local-visual-embedding.mjs';

test('uses fixed local Vision revision and normalizes returned vectors',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vision-backend-'));
  const source=path.join(root,'embed.swift'); await writeFile(source,'source');
  const raw=Buffer.alloc(8);raw.writeFloatLE(3,0);raw.writeFloatLE(4,4);
  const backend=createLocalVisualEmbeddingBackend({cacheRoot:root,sourcePath:source,
    compile:async()=>{},execute:async()=>[{goods_id:'g1',dimension:2,embedding_base64:raw.toString('base64')}]});
  const info=await backend.info();
  assert.equal(info.model_id,'APPLE_VISION_FEATURE_PRINT');
  assert.equal(info.model_revision,2);
  assert.equal(info.remote_calls,0);
  assert.deepEqual((await backend.embedBatch([{goods_id:'g1',path:'/image.jpg'}]))[0].vector,[0.6,0.8]);
});

test('fails closed when the local backend is unavailable',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vision-backend-'));
  const source=path.join(root,'embed.swift'); await writeFile(source,'source');
  const backend=createLocalVisualEmbeddingBackend({cacheRoot:root,sourcePath:source,compile:async()=>{throw new Error('no compiler')}});
  await assert.rejects(()=>backend.info(),error=>error.code==='LOCAL_VISUAL_EMBEDDING_BACKEND_UNAVAILABLE');
});
