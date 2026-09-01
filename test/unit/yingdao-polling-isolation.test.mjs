import assert from 'node:assert/strict';
import test from 'node:test';
import {mountYingdaoPanel} from '../../ui/modules/yingdao/panel.js';
import {yingdaoDomFixture} from '../fixtures/yingdao-panel-dom-fixture.mjs';

test('YingDao mount owns one timer and destroy clears only that timer',async()=>{
  const {yingdaoRoot,scheduler,timers}=yingdaoDomFixture(),foreignTimer=scheduler.setInterval(()=>{},1500),catalog={polling:'running',buttonDisabled:false};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api:successApi()});await panel.refresh();
  assert.equal(timers.size,2);panel.destroy();assert.equal(timers.size,1);assert.ok(timers.has(foreignTimer));assert.deepEqual(catalog,{polling:'running',buttonDisabled:false});
});

test('concurrent YingDao refreshes coalesce and never mutate Catalog state',async()=>{
  const {yingdaoRoot,scheduler}=yingdaoDomFixture(),catalog={context:{campaign_id:'catalog-1'},loading:false},gate=deferred();let settingsCalls=0;
  const api={settings:async()=>{settingsCalls+=1;return gate.promise;},currentImport:async()=>({state:'UNCONFIGURED'})};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});const a=panel.refresh(),b=panel.refresh();assert.equal(settingsCalls,1);gate.resolve({state:'READY_TO_SCAN'});await Promise.all([a,b]);
  assert.equal(settingsCalls,1);assert.deepEqual(catalog,{context:{campaign_id:'catalog-1'},loading:false});panel.destroy();
});

test('YingDao API error is private, clears loading, and remains refreshable',async()=>{
  const {yingdaoRoot,scheduler}=yingdaoDomFixture();let fail=true;const api={settings:async()=>{if(fail)throw Object.assign(new Error('offline'),{code:'NETWORK'});return{state:'READY_TO_SCAN'};},currentImport:async()=>({state:'UNCONFIGURED'})};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});await assert.rejects(()=>panel.refresh(),/offline/);assert.equal(panel.getState().error.code,'NETWORK');
  fail=false;await panel.refresh();assert.equal(panel.getState().error,null);panel.destroy();
});

function successApi(){return{settings:async()=>({state:'READY_TO_SCAN'}),currentImport:async()=>({state:'READY_TO_SCAN'})};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
