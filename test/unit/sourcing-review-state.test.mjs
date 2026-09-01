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

function fixture(){const calls=[];return {calls,async request(path){calls.push(path);if(path.includes('bootstrap'))return {goods:[{temu_goods_id:'g1'},{temu_goods_id:'g2'}]};if(path.includes('/visual-matches'))return {index:{status:'READY',index_fingerprint:'f'},search:{match_count:1},matches:[{goods_id:'g9',navigation_action:'NONE'}]};const id=path.includes('/g2?')?'g2':'g1';return {temu_goods_id:id,review_revision:0,group_context:{items:[{temu_goods_id:'g1'},{temu_goods_id:'g2'}]},candidates:[{'1688_product_id':'p1',random_sample_rank:1}]};}};}
