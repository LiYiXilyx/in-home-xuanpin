import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'browser-extension/catalog-manual-passive-runner.js'),'utf8');

function loadModule(overrides={}) { const sandbox=vm.createContext({ console,URL,Date,setInterval:()=>1,clearInterval:()=>{},document:{ body:{ innerText:'' },documentElement:{},getElementById:()=>null },location:{ href:'https://www.temu.com/de-en/motorcycles.html' },...overrides });vm.runInContext(source,sandbox);return sandbox.TemuCatalogManualPassiveRunnerModule; }
function context({ accepted=2135,checkpoint={} }={}) { return { campaign:{ id:'campaign-1',status:'running',targetCount:3000,baselinePoolCount:2135,nonElectronicUniqueCount:accepted,rawObservedCount:accepted,electronicExcludedCount:0,browserControlMode:'MANUAL_NAVIGATION_PASSIVE_CAPTURE',cdpRequired:false,extensionPassiveRequired:true,localServerEndpoint:'http://127.0.0.1:37821' },source:{ id:'source-1' },queue:{ id:'queue-1',checkpoint } }; }
function healthyPage(overrides={}) { const page={ url:'https://www.temu.com/de-en/motorcycles--accessories-o3-585.html?sort=top',category:'Motorcycles & Powersports Accessories',sort:'Top sales',germany:true,english:true,eur:true,categoryMatch:true,sortMatch:true,cardCount:20,goodsIds:new Set(['1']),verification:false,unhealthy:false,valid:true,...overrides };return page; }
function harness(initial,{ candidates=[] }={}) { let current=structuredClone(initial),page=healthyPage();const checkpoints=[];let submits=0;
  const dependencies={ getContext:async()=>structuredClone(current),scan:()=>page,passiveCandidates:()=>candidates,submitPassive:async options=>{submits+=1;assert.equal(options.pageBinding.bound_category,'Motorcycles & Powersports Accessories');return { passiveGoodsIds:['1'],batch:{batchId:'batch-1'} };},
    checkpoint:async payload=>{checkpoints.push(payload.checkpoint);current.queue.checkpoint={...current.queue.checkpoint,...payload.checkpoint};return current.queue;},networkDiagnostics:()=>({network_cache_size:1,network_parse_errors:0,bridge_payload_rejected:0,bridge_schema_rejected:0}),now:()=> '2026-08-29T00:00:00.000Z',setInterval:()=>1,clearInterval:()=>{},pollMs:2500 };
  return { dependencies,checkpoints,setPage:value=>{page=value;},get submits(){return submits;} };
}

test('restore is always UNBOUND and 50 QA requires an explicit healthy-page binding',async()=>{
  const { ManualPassiveRunner,STATES }=loadModule(),initial=context({checkpoint:{runner_state:'CAPTURING',capture_origin_unique:2135,stage_target_delta:50,session_target:2185}}),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);
  let result=await runner.restore(initial);assert.equal(result.state,STATES.UNBOUND);await assert.rejects(()=>runner.start({stageTarget:50}),error=>error.code==='PAGE_BINDING_REQUIRED');
  result=await runner.bindCurrentPage();assert.equal(result.state,STATES.PAGE_BOUND);assert.equal(result.binding.bound_category,'Motorcycles & Powersports Accessories');assert.equal(result.binding.bound_sort,'Top sales');
  result=await runner.start({stageTarget:50});assert.equal(result.state,STATES.CAPTURING);assert.equal(result.originUnique,2135);assert.equal(result.sessionTarget,2185);assert.equal(h.submits,0);
  assert.ok(h.checkpoints.some(item=>item.runner_state==='PAGE_BOUND'&&item.bound_url&&item.bound_at));
});

test('home, wrong category, wrong sort, zero cards and Oops cannot bind',async()=>{
  const { ManualPassiveRunner }=loadModule(),initial=context(),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);await runner.restore(initial);
  for(const page of [healthyPage({category:'',categoryMatch:false,valid:false}),healthyPage({sort:'Relevance',sortMatch:false,valid:false}),healthyPage({cardCount:0,goodsIds:new Set(),valid:false}),healthyPage({unhealthy:true,valid:false})]){
    h.setPage(page);await assert.rejects(()=>runner.bindCurrentPage(),error=>['CATEGORY_MISMATCH','SORT_ORDER_MISMATCH','NO_PRODUCT_CARDS','PAGE_UNHEALTHY'].includes(error.code));
  }
  assert.equal(h.submits,0);
});

test('scanDom recognizes the real Temu sort control when its visible label is duplicated',()=>{
  const sortControl={innerText:'Sort by: Top sales\nSort by: Top sales',textContent:'Sort by: Top salesSort by: Top sales'},document={body:{innerText:'Motorcycles & Powersports Accessories 10,47€'},documentElement:{lang:'en'},
    querySelector:selector=>selector==='h1'?{textContent:'Motorcycles & Powersports Accessories'}:selector.includes('sort-select-down-list')?sortControl:null,querySelectorAll:()=>[]};
  const {scanDom}=loadModule({document,location:{href:'https://www.temu.com/de-en/motorcycles--accessories-o3-585.html',pathname:'/de-en/motorcycles--accessories-o3-585.html'},TemuCatalogParser:{parseDocument:()=>[{goods_id:'1'}]}}),page=scanDom();
  assert.equal(page.sort,'Top sales');assert.equal(page.cardCount,1);assert.equal(page.valid,true);
});

test('capture pauses immediately when a bound page context is lost',async()=>{
  const { ManualPassiveRunner,STATES }=loadModule(),initial=context(),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);await runner.restore(initial);await runner.bindCurrentPage();await runner.start({stageTarget:50});
  h.setPage(healthyPage({category:'Home',categoryMatch:false,valid:false}));const result=await runner.tick();assert.equal(result.state,STATES.PAGE_CONTEXT_LOST);assert.equal(result.binding,null);assert.equal(h.submits,0);
  assert.ok(h.checkpoints.some(item=>item.capture_paused===true&&item.context_lost_reason==='CATEGORY_MISMATCH'));
});

test('300 and 3000 stages remain locked behind real preceding QA after binding',async()=>{
  const { ManualPassiveRunner }=loadModule(),initial=context(),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);await runner.restore(initial);await runner.bindCurrentPage();
  await assert.rejects(()=>runner.start({stageTarget:300}),error=>error.code==='STAGE_50_QA_REQUIRED');
  h.dependencies.getContext=async()=>context({checkpoint:{capture_origin_unique:2135,qa_50_status:'PASS'}});runner.context=await h.dependencies.getContext();await runner.bindCurrentPage();const stage300=await runner.start({stageTarget:300});assert.equal(stage300.sessionTarget,2435);
  h.dependencies.getContext=async()=>context({checkpoint:{capture_origin_unique:2135,qa_50_status:'PASS',qa_300_status:'PENDING'}});runner.context=await h.dependencies.getContext();runner.state='PAGE_BOUND';runner.binding=healthyBinding();
  await assert.rejects(()=>runner.start({stageTarget:3000}),error=>error.code==='STAGE_300_QA_REQUIRED');
});

test('checkpoint restart preserves progress target but never restores a stale page binding',async()=>{
  const { ManualPassiveRunner,STATES }=loadModule(),initial=context({accepted:2160,checkpoint:{runner_state:'PAGE_BOUND',capture_origin_unique:2135,stage_target_delta:50,session_target:2185,bound_url:'https://old.test/'}}),h=harness(initial),runner=new ManualPassiveRunner(h.dependencies,initial);
  const result=await runner.restore(initial);assert.equal(result.state,STATES.UNBOUND);assert.equal(result.binding,null);assert.equal(result.originUnique,2135);assert.equal(result.sessionTarget,2185);
});

function healthyBinding(){return {bound_url:'https://www.temu.com/de-en/motorcycles--accessories-o3-585.html?sort=top',bound_at:'2026-08-29T00:00:00.000Z',bound_category:'Motorcycles & Powersports Accessories',bound_sort:'Top sales',bound_goods_count:20};}
