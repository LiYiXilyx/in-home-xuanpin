import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {Worker} from 'node:worker_threads';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';
import {createCatalogController} from '../../src/server/controllers/catalog-controller.mjs';
import {createRouter} from '../../src/server/router.mjs';
test('entry GET is read-only and continue POST requires exact identity',async t=>{
 const f=await createInitialPoolFixture(t);
 const controller=createCatalogController({catalogService:f.service,categoryProfileRegistry:{resolve:async x=>{assert.equal(x.categoryKey,f.profile.category_key);assert.equal(x.categoryProfileVersion,f.profile.category_profile_version);return f.profile;}}});
 const server=http.createServer(createRouter({catalogController:controller,serveStatic:()=>{},logError:()=>{}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 let res=await fetch(`${base}/api/catalog/operator/entry?category_key=${f.profile.category_key}&category_profile_version=${f.profile.category_profile_version}`);
 assert.equal(res.status,200);assert.equal((await res.json()).entry.action,'START_INITIAL');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM catalog_campaigns').get().n,0);
 const c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'api',requestId:'api'});
 const post=body=>fetch(`${base}/api/catalog/operator/initial-campaigns/${c.campaignId}/continue`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body)});
 const body={campaign_id:c.campaignId,category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,request_id:'resume'};
 res=await post({...body,campaign_id:'wrong'});assert.equal(res.status,400);
 res=await post(body);assert.equal(res.status,200);assert.equal((await res.json()).result.campaign_id,c.campaignId);
});
test('two independent SQLite connections racing Initial creation have one complete winner',async t=>{
 const f=await createInitialPoolFixture(t),barrier=new SharedArrayBuffer(8),state=new Int32Array(barrier);
 const start=index=>new Promise((resolve,reject)=>{const w=new Worker(new URL('../fixtures/catalog-entry-race-worker.mjs',import.meta.url),{workerData:{databasePath:f.databasePath,profile:f.profile,index,barrier}});w.on('message',resolve);w.on('error',reject);});
 const resultsPromise=Promise.all([start(1),start(2)]);
 while(Atomics.load(state,0)!==2)await new Promise(r=>setTimeout(r,5));Atomics.store(state,1,1);Atomics.notify(state,1,2);
 const results=await resultsPromise;assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok).length,1);
 for(const table of ['catalog_campaigns','catalog_sources','catalog_rpa_queue','catalog_source_runs'])assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1);
});
