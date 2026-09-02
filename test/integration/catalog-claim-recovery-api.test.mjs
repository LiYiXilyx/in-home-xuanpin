import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRouter} from '../../src/server/router.mjs';

test('claim recovery API exposes blockers and requires local origin for mutations',async t=>{
  const calls=[],controller={claimBlockers:()=>({primaryBlocker:{campaignId:'c1'},allBlockers:[{campaignId:'c1'}]}),inspectClaim:(id,body)=>{calls.push(['inspect',id,body]);return{inspectionId:'i1'};},endStaleClaim:(id,body)=>{calls.push(['end',id,body]);return{id:'audit1'};}};
  const router=createRouter({catalogController:controller,serveStatic:()=>{},statusService:{},browserController:{},jobController:{},reviewController:{},reviewQueueController:{},exportController:{},testController:{},environment:{name:'test',testMode:true},logError:()=>{}}),server=http.createServer(router);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  let response=await fetch(`${base}/api/catalog/operator/rpa-claim-blockers`);assert.equal(response.status,200);assert.equal((await response.json()).all_blockers.length,1);
  response=await fetch(`${base}/api/catalog/operator/rpa-claims/c1/inspections`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,403);
  const headers={'content-type':'application/json',origin:base};response=await fetch(`${base}/api/catalog/operator/rpa-claims/c1/inspections`,{method:'POST',headers,body:JSON.stringify({previous_inspection_id:null})});assert.equal(response.status,201);
  response=await fetch(`${base}/api/catalog/operator/rpa-claims/c1/end-stale`,{method:'POST',headers,body:JSON.stringify({request_id:'r1'})});assert.equal(response.status,200);assert.equal(calls.length,2);
});
