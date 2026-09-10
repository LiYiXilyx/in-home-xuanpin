import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {createRouter} from '../../src/server/router.mjs';
test('Catalog folder API requires explicit same-origin POST',async t=>{
 let calls=0;const server=http.createServer(createRouter({exportController:{openCatalogFolder:async()=>{calls++;return{message:'opened'};}},serveStatic:(_req,res)=>{res.statusCode=404;res.end();},logError:()=>{}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`,url=base+'/api/catalog/exports/open-folder';
 await fetch(url);assert.equal(calls,0);
 let response=await fetch(url,{method:'POST',headers:{origin:'https://foreign.test'}});assert.equal(response.status,403);assert.equal(calls,0);
 response=await fetch(url,{method:'POST',headers:{origin:base}});assert.equal(response.status,200);assert.equal(calls,1);
});
