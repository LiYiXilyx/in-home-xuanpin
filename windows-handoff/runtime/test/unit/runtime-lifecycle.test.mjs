import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeLifecycle} from '../../src/server/runtime-lifecycle.mjs';

test('drain waits for handler completion even after response disconnect',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const lifecycle=createRuntimeLifecycle(async()=>pending);
  const request=lifecycle.handle({method:'POST',url:'/api/catalog/capture'},{});
  assert.equal(lifecycle.snapshot().activeRequests,1);
  let drained=false;const drain=lifecycle.drain().then(()=>{drained=true;});
  await Promise.resolve();assert.equal(drained,false);
  const response={writeHead(code){this.code=code;},end(){}};
  await lifecycle.handle({method:'POST',url:'/api/catalog/capture'},response);
  assert.equal(response.code,503);
  release();await request;await drain;assert.equal(drained,true);
  assert.equal(lifecycle.snapshot().activeRequests,0);
});

test('activity endpoint does not invoke business router or expose identities',async()=>{
  let called=0;const lifecycle=createRuntimeLifecycle(()=>{called++;});
  const response={writeHead(code){this.code=code;},end(body){this.body=body;}};
  await lifecycle.handle({method:'GET',url:'/api/runtime/activity?secret=hidden'},response);
  assert.equal(called,0);assert.equal(response.code,200);
  const state=JSON.parse(response.body);
  assert.equal(state.activeRequests,0);assert.equal(state.scope,'PROCESS_ONLY');
  assert.equal(response.body.includes('hidden'),false);
});

test('failed handler releases activity without swallowing its error',async()=>{
  const lifecycle=createRuntimeLifecycle(()=>{throw new Error('failed');});
  await assert.rejects(lifecycle.handle({method:'POST',url:'/'},{}),/failed/);
  assert.equal(lifecycle.snapshot().activeRequests,0);await lifecycle.drain();
});
