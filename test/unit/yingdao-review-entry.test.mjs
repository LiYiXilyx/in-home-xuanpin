import assert from 'node:assert/strict';
import test from 'node:test';
import {mountYingdaoPanel,yingdaoPanelMarkup} from '../../ui/modules/yingdao/panel.js';
import {createYingdaoApi} from '../../ui/modules/yingdao/api.js';
import {yingdaoDomFixture} from '../fixtures/yingdao-panel-dom-fixture.mjs';

test('homepage binds the Review entry to the current review run',async()=>{
  const {yingdaoRoot,scheduler,byId}=yingdaoDomFixture(),calls=[];const api={settings:async()=>({state:'COMPLETED'}),currentImport:async()=>({state:'COMPLETED',random5_candidates:250}),
    reviewBootstrap:async runId=>{calls.push(['bootstrap',runId]);return{run_id:'run-1',total_goods:50,awaiting_review:41,confirmed:7,no_selection:2,goods:[]};}};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});await panel.refresh();const state=panel.getState();
  assert.equal(state.reviewRun,'run-1');assert.equal(byId('yingdao-review-link').href,'/sourcing-review.html?run_id=run-1');
  assert.deepEqual(state.reviewSummary,{awaiting:41,confirmed:7,noSelection:2,totalGoods:50,candidates:250});
  assert.equal(byId('yingdao-review-awaiting').textContent,'41');assert.equal(byId('yingdao-review-confirmed').textContent,'7');
  assert.doesNotMatch(yingdaoPanelMarkup,/href="\/sourcing-review\.html"/);assert.deepEqual(calls,[['bootstrap',undefined]]);panel.destroy();
});

test('Review link follows run changes and URL-encodes run and optional goods identities',async()=>{
  const {buildSourcingReviewUrl}=await import('../../ui/modules/yingdao/panel.js');
  assert.equal(buildSourcingReviewUrl({runId:'run /?&',goodsId:'goods /?&'}),'/sourcing-review.html?run_id=run+%2F%3F%26&goods_id=goods+%2F%3F%26');
  const {yingdaoRoot,scheduler,byId}=yingdaoDomFixture();let run='run-one';const api={settings:async()=>({state:'COMPLETED'}),currentImport:async()=>({state:'COMPLETED'}),reviewBootstrap:async()=>({run_id:run,total_goods:1,goods:[]})};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});await panel.refresh();assert.equal(byId('yingdao-review-link').href,'/sourcing-review.html?run_id=run-one');
  run='run-two';await panel.refresh();assert.equal(byId('yingdao-review-link').href,'/sourcing-review.html?run_id=run-two');panel.destroy();
});

test('Review entry is disabled when no valid review run exists',async()=>{
  const {yingdaoRoot,scheduler,byId}=yingdaoDomFixture();const api={settings:async()=>({state:'READY_TO_SCAN'}),currentImport:async()=>({state:'READY_TO_SCAN'}),reviewBootstrap:async()=>null};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});await panel.refresh();const link=byId('yingdao-review-link');
  assert.equal(link.href,'');assert.equal(link.getAttribute('aria-disabled'),'true');assert.match(link.title,/Review Run/);panel.destroy();
});

test('homepage Review integration exposes no mutation API or selected-candidate handler',()=>{
  const source=String(mountYingdaoPanel);assert.doesNotMatch(source,/selectCandidate|excludeCandidate|clearSelection|operator_note/);
});

test('Review bootstrap discovers the server-selected run without a client hardcoded fallback',async()=>{
  let requested;const api=createYingdaoApi({fetchImpl:async url=>{requested=String(url);return{ok:true,json:async()=>({})};}});await api.reviewBootstrap();
  assert.equal(requested,'/api/sourcing/review/bootstrap');
});
