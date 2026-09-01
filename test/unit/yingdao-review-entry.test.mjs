import assert from 'node:assert/strict';
import test from 'node:test';
import {mountYingdaoPanel,yingdaoPanelMarkup} from '../../ui/modules/yingdao/panel.js';
import {createYingdaoApi} from '../../ui/modules/yingdao/api.js';
import {yingdaoDomFixture} from '../fixtures/yingdao-panel-dom-fixture.mjs';

test('homepage shows read-only Review summary and independent console entry',async()=>{
  const {yingdaoRoot,scheduler,byId}=yingdaoDomFixture(),calls=[];const api={settings:async()=>({state:'COMPLETED'}),currentImport:async()=>({state:'COMPLETED',random5_candidates:250}),
    reviewBootstrap:async()=>{calls.push('bootstrap');return{run_id:'run-1',total_goods:50,awaiting_review:41,confirmed:7,no_selection:2,goods:[]};}};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});await panel.refresh();const state=panel.getState();
  assert.equal(state.currentRun,'run-1');assert.equal(byId('yingdao-run-id').textContent,'run-1');
  assert.deepEqual(state.reviewSummary,{awaiting:41,confirmed:7,noSelection:2,totalGoods:50,candidates:250});
  assert.equal(byId('yingdao-review-awaiting').textContent,'41');assert.equal(byId('yingdao-review-confirmed').textContent,'7');
  assert.match(yingdaoPanelMarkup,/id="yingdao-review-link"[^>]+href="\/sourcing-review\.html"/);assert.deepEqual(calls,['bootstrap']);panel.destroy();
});

test('homepage Review integration exposes no mutation API or selected-candidate handler',()=>{
  const source=String(mountYingdaoPanel);assert.doesNotMatch(source,/selectCandidate|excludeCandidate|clearSelection|operator_note/);
});

test('Review bootstrap always carries the validated fixed run identity',async()=>{
  let requested;const api=createYingdaoApi({fetchImpl:async url=>{requested=String(url);return{ok:true,json:async()=>({})};}});await api.reviewBootstrap();
  assert.equal(requested,'/api/sourcing/review/bootstrap?run_id=yingdao_random5_v1_20260831_001');
});
