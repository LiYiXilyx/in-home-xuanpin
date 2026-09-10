import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRuntimeLifecycle} from '../../src/server/runtime-lifecycle.mjs';

test('disconnected HTTP client does not release unfinished operation',async t=>{
  let release,entered;const ready=new Promise(resolve=>{entered=resolve;});
  const pending=new Promise(resolve=>{release=resolve;});
  let completed=false;
  const lifecycle=createRuntimeLifecycle(async(req,res)=>{entered();await pending;completed=true;res.end('done');});
  const server=http.createServer(lifecycle.handle);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{release();server.closeAllConnections();server.close();});
  const port=server.address().port;
  const request=http.request({hostname:'127.0.0.1',port,path:'/capture',method:'POST'});
  request.on('error',()=>{});request.end();await ready;request.destroy();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lifecycle.snapshot().activeRequests,1);
  const draining=lifecycle.drain();
  const rejected=await fetch(`http://127.0.0.1:${port}/capture`,{method:'POST'});
  assert.equal(rejected.status,503);assert.equal(completed,false);
  release();await draining;assert.equal(completed,true);
});
