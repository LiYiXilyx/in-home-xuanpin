import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCatalogPanel} from '../../ui/modules/catalog/panel.js';
import {catalogDomFixture} from '../fixtures/catalog-panel-dom-fixture.mjs';
test('quick category registration requires click, pins probe, selects exact profile and never creates Campaign',async t=>{
 const f=catalogDomFixture(),profile={category_key:'pets',category_profile_version:'pets-v1',entry:{action:'START_INITIAL',available:true}},calls=[];
 const probe={probe_id:'p1',descriptor_fingerprint:'f1',expires_at:'2099-01-01T00:00:00Z',resolution:'NEW',profile,descriptor:{page_category_name:'Pets'}};
 let rows=[];const api={listProfiles:async()=>({profiles:rows}),currentCampaign:async()=>({current:null}),currentProbe:async()=>({probe}),registerProbe:async(id,body)=>{calls.push({id,body});rows=[profile];return{profile};}};
 const panel=mountCatalogPanel({root:f.catalogRoot,api,scheduler:f.scheduler,randomUUID:()=> 'request1'});t.after(()=>panel.destroy());await panel.refresh();assert.equal(calls.length,0);
 assert.ok(f.byId('catalog-probe-select'));await f.byId('catalog-probe-select').emit('click');
 assert.deepEqual(calls,[{id:'p1',body:{probe_id:'p1',descriptor_fingerprint:'f1',request_id:'request1'}}]);assert.equal(panel.getState().selectedProfile.category_key,'pets');assert.equal(f.yingdao.marker,'untouched');
});
