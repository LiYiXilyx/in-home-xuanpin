import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
const bindingSource=fs.readFileSync(path.join(root,'browser-extension/catalog-manual-binding.js'),'utf8');
const runnerSource=fs.readFileSync(path.join(root,'browser-extension/catalog-manual-passive-runner.js'),'utf8');

function loadModule(){const sandbox=vm.createContext({console,URL,Date,document:{body:{innerText:''},documentElement:{},getElementById:()=>null},location:{href:'https://www.temu.com/de-en/category-b.html',pathname:'/de-en/category-b.html'}});vm.runInContext(bindingSource,sandbox);vm.runInContext(runnerSource,sandbox);return sandbox.TemuCatalogManualPassiveRunnerModule;}
function context({accepted=0,checkpoint={}}={}){return{campaign:{id:'campaign-b',status:'running',categoryKey:'category-b',categoryProfileVersion:'category-b-v1',targetCount:50,baselinePoolCount:0,nonElectronicUniqueCount:accepted,rawObservedCount:accepted,electronicExcludedCount:0,browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE',cdpRequired:false,extensionPassiveRequired:true},profile:{category_key:'category-b',category_profile_version:'category-b-v1',display_name:'Category B',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales'},source:{id:'source-b'},queue:{id:'queue-b',checkpoint}};}
function healthy(overrides={}){return{url:'https://www.temu.com/de-en/category-b.html?sort=top',siteCountry:'DE',language:'en',currency:'EUR',category:'Category B',sortOrder:'Top Sales',cardCount:2,goodsIds:new Set(['1','2']),domReady:true,searchNoResults:false,captchaBlocking:false,...overrides};}
function harness(initial){let current=structuredClone(initial),page=healthy(),submits=0;const writes=[];return{dependencies:{getContext:async()=>structuredClone(current),scan:()=>page,networkDiagnostics:()=>({network_cache_size:2}),passiveCandidates:()=>[{goods_id:'1'},{goods_id:'2'}],submitPassive:async options=>{submits+=1;return{batch:{batchId:options.batchId},audit:{acceptedGoods:2,campaignStagingDeduped:0}};},checkpoint:async payload=>{writes.push(payload);current.queue.checkpoint={...current.queue.checkpoint,...payload.checkpoint};return current.queue;},now:()=> '2026-08-31T00:00:00.000Z'},setPage:value=>{page=value;},get submits(){return submits;},get writes(){return writes;}};}

test('detect and bind are separate; unbound capture performs zero submits and zero writes',async()=>{
  const {ManualPassiveRunner,STATES}=loadModule(),initial=context(),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);await runner.restore(initial);h.writes.length=0;
  await assert.rejects(()=>runner.captureCurrentPage(),error=>error.code==='PAGE_BINDING_REQUIRED');assert.equal(h.submits,0);assert.equal(h.writes.length,0);
  let result=await runner.detectCurrentPage();assert.equal(result.state,STATES.PAGE_READY);assert.equal(result.binding,null);assert.equal(h.writes.length,0);
  result=await runner.bindCurrentPage();assert.equal(result.state,STATES.PAGE_BOUND);assert.equal(h.writes.length,1);
});

test('page context change invalidates binding before submit',async()=>{
  const {ManualPassiveRunner,STATES}=loadModule(),initial=context(),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);await runner.restore(initial);await runner.detectCurrentPage();await runner.bindCurrentPage();
  h.setPage(healthy({currency:'USD'}));await assert.rejects(()=>runner.captureCurrentPage(),error=>error.code==='PAGE_CONTEXT_LOST');assert.equal(runner.state,STATES.PAGE_CONTEXT_LOST);assert.equal(runner.binding,null);assert.equal(h.submits,0);
});

test('manual repeated capture is deterministic and idempotent without automatic scheduling',async()=>{
  const {ManualPassiveRunner}=loadModule(),initial=context(),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);await runner.restore(initial);await runner.detectCurrentPage();await runner.bindCurrentPage();await runner.start({stageTarget:50});
  const first=await runner.captureCurrentPage(),second=await runner.captureCurrentPage();assert.equal(first.lastResult.batch.batchId,second.batch.batchId);assert.equal(second.idempotentReplay,true);assert.equal(h.submits,1);
  assert.doesNotMatch(runnerSource,/setInterval|scrollTo|\.click\(|location\.(?:assign|replace)|See more click/i);
});

test('Page Health blocks SEARCH_NO_RESULTS and CAPTCHA before binding',async()=>{
  const {ManualPassiveRunner}=loadModule(),initial=context(),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);await runner.restore(initial);
  for(const page of [healthy({searchNoResults:true}),healthy({captchaBlocking:true})]){h.setPage(page);const detected=await runner.detectCurrentPage();assert.equal(detected.detection.health.status,'BLOCKED');await assert.rejects(()=>runner.bindCurrentPage(),error=>error.code==='PAGE_HEALTH_BLOCKED');}
  assert.equal(h.submits,0);
});
