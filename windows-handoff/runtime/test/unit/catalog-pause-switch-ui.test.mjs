import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCatalogPanel} from '../../ui/modules/catalog/panel.js';
import {catalogDomFixture} from '../fixtures/catalog-panel-dom-fixture.mjs';
test('pause is confirmed, exact-current scoped and never starts selected target',async t=>{
 const f=catalogDomFixture(),profiles=['a','b'].map(k=>({category_key:k,category_profile_version:k+'-v1',entry:{action:'START_INITIAL',available:true}}));
 let current={campaign_id:'a-task',campaign_type:'initial',category_key:'a',category_profile_version:'a-v1',status:'running',queue_id:'a-queue',claim_generation:3},confirmed=false,calls=[];
 const api={listProfiles:async()=>({profiles}),currentCampaign:async()=>({current}),pauseInitial:async(id,body)=>{calls.push({id,body});current=null;return{result:{status:'paused'}};}};
 const panel=mountCatalogPanel({root:f.catalogRoot,api,scheduler:f.scheduler,randomUUID:()=> 'pause-request',confirmAction:()=>confirmed});t.after(()=>panel.destroy());await panel.refresh();
 f.byId('catalog-category-select').value='b';await f.byId('catalog-category-select').emit('change');assert.equal(calls.length,0);
 const button=f.byId('catalog-pause-switch');assert.ok(button);
 await button.emit('click');assert.equal(calls.length,0);confirmed=true;
 await Promise.all([button.emit('click'),button.emit('click')]);
 assert.deepEqual(calls,[{id:'a-task',body:{campaign_id:'a-task',category_key:'a',category_profile_version:'a-v1',queue_id:'a-queue',expected_claim_generation:3,request_id:'pause-request'}}]);
 assert.equal(panel.getState().selectedProfile.category_key,'b');assert.equal(f.yingdao.marker,'untouched');
});
