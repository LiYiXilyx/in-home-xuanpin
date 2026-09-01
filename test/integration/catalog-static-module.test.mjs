import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStaticServer } from '../../src/server/static-server.mjs';

test('existing static server delivers nested Catalog ES modules as JavaScript',async t=>{
  const serve=createStaticServer(new URL('../../ui/',import.meta.url).pathname);
  const server=http.createServer((request,response)=>serve(new URL(request.url,'http://127.0.0.1').pathname,response));
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address(),response=await fetch(`http://127.0.0.1:${port}/modules/catalog/panel.js`),body=await response.text();
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/javascript/);assert.match(body,/mountCatalogPanel/);
});
