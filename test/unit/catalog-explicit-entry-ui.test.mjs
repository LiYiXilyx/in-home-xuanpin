import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCatalogPanel} from '../../ui/modules/catalog/panel.js';
import {createCatalogApi} from '../../ui/modules/catalog/api.js';
import {catalogDomFixture} from '../fixtures/catalog-panel-dom-fixture.mjs';

const profile=(key,action)=>({category_key:key,category_profile_version:`${key}-v1`,active_pool_count:action==='EXPANSION'?10:0,
 available:action==='EXPANSION',initial_pool_available:action==='START_INITIAL',expansion_available:action==='EXPANSION',
 entry:{action,available:action!=='BLOCKED',campaign_id:action==='CONTINUE_INITIAL'?`${key}-campaign`:null,code:action==='BLOCKED'?'INITIAL_CAMPAIGN_WITH_ACTIVE_POOL':null}});
function setup(t,profiles,write=async()=>({result:null}),current=null){const f=catalogDomFixture(),calls=[];let seq=0;
 const api={listProfiles:async()=>({profiles}),currentCampaign:async()=>({current}),...Object.fromEntries(['createInitial','continueInitial','createExpansion'].map(action=>[action,async(...args)=>{calls.push({action,args});return write(action,...args);}]))};
 const panel=mountCatalogPanel({root:f.catalogRoot,api,scheduler:f.scheduler,randomUUID:()=>`request-${++seq}`});t.after(()=>panel.destroy());return {f,panel,calls};}
test('explicit descriptor drives all entry actions and Initial never requires a count',async t=>{
 for(const action of ['START_INITIAL','CONTINUE_INITIAL','EXPANSION','BLOCKED']){
  const {f,panel,calls}=setup(t,[profile('b',action)]);await panel.refresh();assert.equal(calls.length,0);
  assert.equal(f.byId('catalog-create-campaign').disabled,action==='BLOCKED');
  if(action==='BLOCKED'){await f.byId('catalog-create-form').emit('submit');assert.equal(calls.length,0);continue;}
  f.byId('catalog-campaign-name').value='name';f.byId('catalog-requested-new').value='5';
  assert.equal(f.byId('catalog-requested-new-field').hidden,action!=='EXPANSION');
  if(action==='CONTINUE_INITIAL')assert.equal(f.byId('catalog-campaign-name').required,false);
  await f.byId('catalog-create-form').emit('submit');assert.equal(calls.length,1);
  assert.equal(calls[0].action,{START_INITIAL:'createInitial',CONTINUE_INITIAL:'continueInitial',EXPANSION:'createExpansion'}[action]);
  const body=calls[0].args.at(-1);assert.equal(body.category_key,'b');assert.equal(body.category_profile_version,'b-v1');assert.ok(body.request_id);
  if(action==='CONTINUE_INITIAL')assert.equal(body.campaign_id,'b-campaign');
  assert.equal(body.requested_new_count,action==='EXPANSION'?5:undefined);
 }
});
test('double submit sends once and late response cannot replace another selected category',async t=>{
 let done;const pending=new Promise(r=>{done=r;});const {f,panel,calls}=setup(t,[profile('a','START_INITIAL'),profile('b','START_INITIAL')],()=>pending);
 await panel.refresh();f.byId('catalog-campaign-name').value='one';
 const first=f.byId('catalog-create-form').emit('submit'),second=f.byId('catalog-create-form').emit('submit');const count=calls.length;
 f.byId('catalog-category-select').value='b';await f.byId('catalog-category-select').emit('change');
 done({result:{campaign_id:'a-c',category_key:'a',category_profile_version:'a-v1'}});await Promise.all([first,second]);assert.equal(count,1);
 assert.equal(panel.getState().selectedProfile.category_key,'b');assert.notEqual(panel.getState().currentCampaign?.campaign_id,'a-c');
 assert.equal(f.yingdao.marker,'untouched');
});
test('polling preserves selected category and uncertainty retains request identity',async t=>{
 const {f,panel,calls}=setup(t,[profile('a','START_INITIAL'),profile('b','START_INITIAL')],async()=>{throw new Error('network uncertain');},{category_key:'a',category_profile_version:'a-v1',campaign_id:'old'});
 await panel.refresh();f.byId('catalog-category-select').value='b';await f.byId('catalog-category-select').emit('change');await panel.refresh();
 assert.equal(panel.getState().selectedProfile.category_key,'b');assert.equal(calls.length,0);
 f.byId('catalog-campaign-name').value='same';await f.byId('catalog-create-form').emit('submit');await f.byId('catalog-create-form').emit('submit');
 assert.equal(calls[0].args[0].request_id,calls[1].args[0].request_id);
 f.byId('catalog-campaign-name').value='changed';await f.byId('catalog-create-form').emit('submit');assert.notEqual(calls[1].args[0].request_id,calls[2].args[0].request_id);
});
test('continue API uses explicit path id and same scoped body',async()=>{
 const sent=[];const api=createCatalogApi({fetchImpl:async(path,options)=>{sent.push({path,options});return{ok:true,json:async()=>({ok:true})};}});
 const body={campaign_id:'exact',category_key:'b',category_profile_version:'b-v1',request_id:'r'};
 await api.continueInitial('exact',body);assert.equal(sent[0].path,'/api/catalog/operator/initial-campaigns/exact/continue');assert.deepEqual(JSON.parse(sent[0].options.body),body);
});
