import test from 'node:test';import assert from 'node:assert/strict';
import {createReviewConsoleState} from '../../ui/sourcing-review-state.js';

test('group image preview never switches goods while explicit action does and keeps accordion open',async()=>{
  const api=fixture(),state=createReviewConsoleState({api,runId:'run'});await state.load();
  state.toggleGroup();state.previewGroupImage('g2');
  assert.equal(state.snapshot().currentGoodsId,'g1');assert.equal(state.snapshot().imagePreview,'g2');
  assert.equal(api.calls.filter(x=>x.includes('/goods/g2?')).length,0);
  await state.switchToGroupGoods('g2');
  assert.equal(state.snapshot().currentGoodsId,'g2');assert.equal(state.snapshot().groupExpanded,true);
  assert.equal(api.calls.filter(x=>x.includes('/goods/g2?')).length,1);
});

test('dirty operator note blocks goods switching until explicit confirmation',async()=>{
  const api=fixture(),state=createReviewConsoleState({api,runId:'run'});await state.load();state.setNoteDirty(true);
  assert.equal(await state.switchToGroupGoods('g2',{confirmDiscard:()=>false}),false);
  assert.equal(state.snapshot().currentGoodsId,'g1');assert.equal(state.snapshot().noteDirty,true);
  assert.equal(await state.switchToGroupGoods('g2',{confirmDiscard:()=>true}),true);
  assert.equal(state.snapshot().currentGoodsId,'g2');assert.equal(state.snapshot().noteDirty,false);
});

test('group sort and preview are module-private state transitions',async()=>{
  const state=createReviewConsoleState({api:fixture(),runId:'run'});await state.load();
  state.setGroupSort('LISTED_PRICE');assert.equal(state.snapshot().groupSort,'LISTED_PRICE');
  assert.throws(()=>state.setGroupSort('UNKNOWN'));
  state.previewGroupImage('g2');state.closeImagePreview();assert.equal(state.snapshot().imagePreview,null);
});

test('visual matches load lazily and preview never switches current review goods',async()=>{
  const api=fixture(),state=createReviewConsoleState({api,runId:'run'});await state.load();
  assert.equal(api.calls.some(x=>x.includes('/visual-matches')),false);
  await state.toggleVisual();assert.equal(api.calls.some(x=>x.includes('/visual-matches')),true);
  state.previewVisualImage('g9');assert.equal(state.snapshot().currentGoodsId,'g1');assert.equal(state.snapshot().visualPreviewGoodsId,'g9');
});

test('expanded visual panel automatically refreshes for the newly selected goods',async()=>{
  const api=visualFixture(),renders=[],state=createReviewConsoleState({api,runId:'run',onChange:s=>renders.push(s.visualState)});await state.load();
  await state.toggleVisual();assert.equal(state.snapshot().visualState.anchorGoodsId,'g1');
  await state.selectGoods('g2');const current=state.snapshot();
  assert.equal(api.visualCalls('g2'),1);assert.equal(current.currentGoodsId,'g2');assert.equal(current.visualState.anchorGoodsId,'g2');assert.equal(current.visualState.status,'READY');assert.equal(current.visualResult.matches[0].goods_id,'match-g2');
  assert.ok(renders.some(row=>row.anchorGoodsId==='g2'&&row.status==='LOADING'));
});

test('collapsed visual panel invalidates old anchor and lazily loads the new goods on expand',async()=>{
  const api=visualFixture(),state=createReviewConsoleState({api,runId:'run'});await state.load();await state.toggleVisual();await state.toggleVisual();
  await state.selectGoods('g2');let current=state.snapshot();
  assert.equal(api.visualCalls('g2'),0);assert.equal(current.visualResult,null);assert.deepEqual(current.visualState,{anchorGoodsId:'g2',status:'IDLE',matches:[],marketMetrics:null,error:null,indexFingerprint:null});
  await state.toggleVisual();current=state.snapshot();assert.equal(api.visualCalls('g2'),1);assert.equal(current.visualState.anchorGoodsId,'g2');
});

test('late visual responses never overwrite a newer goods selection',async()=>{
  const a=deferred(),b=deferred(),api=visualFixture({visual:{g1:a.promise,g2:b.promise}}),state=createReviewConsoleState({api,runId:'run'});await state.load();
  const pendingA=state.toggleVisual();const pendingB=state.selectGoods('g2');b.resolve(visualResult('g2','f2',2));await pendingB;a.resolve(visualResult('g1','f1',1));await pendingA;
  const current=state.snapshot();assert.equal(current.currentGoodsId,'g2');assert.equal(current.visualState.anchorGoodsId,'g2');assert.equal(current.visualResult.search.match_count,2);
});

test('rapid A B C switching leaves only C visual state and opportunity metrics',async()=>{
  const a=deferred(),b=deferred(),c=deferred(),api=visualFixture({goods:['g1','g2','g3'],visual:{g1:a.promise,g2:b.promise,g3:c.promise}}),state=createReviewConsoleState({api,runId:'run'});await state.load();
  const pa=state.toggleVisual(),pb=state.selectGoods('g2'),pc=state.selectGoods('g3');c.resolve(visualResult('g3','f3',3));await pc;b.resolve(visualResult('g2','f2',2));a.resolve(visualResult('g1','f1',1));await Promise.all([pa,pb]);
  const current=state.snapshot();assert.equal(current.currentGoodsId,'g3');assert.equal(current.visualState.anchorGoodsId,'g3');assert.deepEqual(current.visualResult.matches.map(row=>row.goods_id),['match-g3']);assert.equal(current.detail.candidates[0].opportunity_ratio,3);
});

test('visual cache identity includes run goods and index fingerprint',async()=>{
  const api=visualFixture(),state=createReviewConsoleState({api,runId:'run-a'});await state.load();await state.toggleVisual();await state.toggleVisual();await state.selectGoods('g2');await state.selectGoods('g1');await state.toggleVisual();
  assert.equal(api.visualCalls('g1'),1,'same run/goods/fingerprint may reuse cache');
  api.fingerprint='f2';await state.toggleVisual();await state.selectGoods('g2');await state.toggleVisual();await state.selectGoods('g1');await state.toggleVisual();
  assert.equal(api.visualCalls('g1'),2,'changed fingerprint must not reuse old cache');
  const other=createReviewConsoleState({api,runId:'run-b'});await other.load();await other.toggleVisual();assert.equal(api.visualCalls('g1'),3,'another run must not reuse cache');
});

test('visual EMPTY and ERROR are anchor-local and keep Random5 usable',async()=>{
  const api=visualFixture({visual:{g1:visualResult('g1','f',0),g2:Object.assign(new Error('offline'),{code:'VISUAL_OFFLINE'})}}),state=createReviewConsoleState({api,runId:'run'});await state.load();await state.toggleVisual();
  assert.equal(state.snapshot().visualState.status,'EMPTY');await state.selectGoods('g2');const current=state.snapshot();assert.equal(current.currentGoodsId,'g2');assert.equal(current.visualState.status,'ERROR');assert.equal(current.visualState.error,'VISUAL_OFFLINE');assert.equal(current.detail.candidates.length,1);
});

function fixture(){const calls=[];return {calls,async request(path){calls.push(path);if(path.includes('bootstrap'))return {goods:[{temu_goods_id:'g1'},{temu_goods_id:'g2'}]};if(path.includes('/visual-matches'))return {index:{status:'READY',index_fingerprint:'f'},search:{match_count:1},matches:[{goods_id:'g9',navigation_action:'NONE'}]};const id=path.includes('/g2?')?'g2':'g1';return {temu_goods_id:id,review_revision:0,group_context:{items:[{temu_goods_id:'g1'},{temu_goods_id:'g2'}]},candidates:[{'1688_product_id':'p1',random_sample_rank:1}]};}};}

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function visualResult(goodsId,fingerprint,count=1){return{anchor_goods_id:goodsId,index:{status:'READY',index_fingerprint:fingerprint},search:{match_count:count},market_metrics:{min_other_listed_price_eur:count,median_reliable_unit_price_eur:count+1},matches:count?[{goods_id:`match-${goodsId}`,navigation_action:'NONE'}]:[],candidate_opportunities:[{product_id:'p1',opportunity_ratio:count||null,opportunity_band:count?'HIGH':'VISUAL_MATCH_REQUIRED',opportunity_reasons:[]}]};}
function visualFixture({goods=['g1','g2'],visual={}}={}){const calls=[];let fingerprint='f1';return{calls,get fingerprint(){return fingerprint;},set fingerprint(value){fingerprint=value;},visualCalls:id=>calls.filter(path=>path.includes(`/goods/${id}/visual-matches`)).length,async request(path){calls.push(path);if(path.includes('bootstrap'))return{goods:goods.map(temu_goods_id=>({temu_goods_id}))};if(path.includes('/visual-matches')){const id=goods.find(value=>path.includes(`/goods/${value}/`));const configured=visual[id];if(configured instanceof Error)throw configured;if(configured)return await configured;return visualResult(id,fingerprint,id==='g1'?1:2);}const id=goods.find(value=>path.includes(`/goods/${value}?`))??goods[0];return{temu_goods_id:id,review_revision:0,group_context:{items:goods.map(temu_goods_id=>({temu_goods_id}))},candidates:[{'1688_product_id':'p1',random_sample_rank:1,opportunity_ratio:99,opportunity_band:'OLD'}]};}};}
