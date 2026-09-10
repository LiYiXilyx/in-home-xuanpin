import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCatalogPanel } from '../../ui/modules/catalog/panel.js';
import { catalogDomFixture } from '../fixtures/catalog-panel-dom-fixture.mjs';

const initialProfile=Object.freeze({category_key:'category-b',category_profile_version:'category-b-v1',display_name:'Category B',
  site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',active_pool_count:0,
  available:false,initial_pool_available:true,expansion_available:false});
const expansionProfile=Object.freeze({...initialProfile,active_pool_count:10,available:true,initial_pool_available:false,expansion_available:true});

function initialCurrent(qaStatus='NOT_RUN',currentUnique=10){return{campaign_id:'campaign-1',campaign_name:'Initial B',campaign_type:'initial',
  category_key:'category-b',category_profile_version:'category-b-v1',baseline_count:0,current_unique:currentUnique,
  target_count:null,remaining:null,target_reached:null,quantity_mode:'OPEN_ENDED',status:'running',binding_status:'UNBOUND',
  qa:{status:qaStatus,qa_candidate_count:qaStatus==='NOT_RUN'?0:currentUnique,unreviewed_delta:0}};}

function fakeApi({profiles=[initialProfile],current=initialCurrent(),afterActivationProfiles=profiles}={}){
  const calls={createInitial:[],createExpansion:[],runInitialQa:[],activateInitial:[]};let activated=false;
  return{calls,
    async listProfiles(){return{profiles:activated?afterActivationProfiles:profiles};},async currentCampaign(){return{current};},
    async createInitial(body){calls.createInitial.push(body);return{result:current};},
    async createExpansion(body){calls.createExpansion.push(body);return{result:{...current,campaign_type:'expansion'}};},
    async runInitialQa(id,body){calls.runInitialQa.push({id,body});current={...current,qa:{status:'PASSED_CURRENT',qa_candidate_count:current.current_unique,unreviewed_delta:0}};return{result:current};},
    async activateInitial(id,body){calls.activateInitial.push({id,body});activated=true;current={...current,status:'completed',pool_version_id:'pool-b-v1',
      qa:{...current.qa,status:'PASSED_CURRENT'}};return{result:{pool_version_id:'pool-b-v1',category_key:'category-b',pool_count:current.current_unique,
        activated_at:'2026-09-01T00:00:00.000Z',source_campaign_id:id}};}
  };
}

test('Initial state renders OPEN_ENDED and exact QA button matrix without sentinel leakage',async()=>{
  for(const [qaStatus,qaEnabled,activationEnabled] of [['NOT_RUN',true,false],['RUNNING',false,false],['FAILED',true,false],['PASSED_CURRENT',true,true],['STALE',true,false]]){
    const fixture=catalogDomFixture(),api=fakeApi({current:initialCurrent(qaStatus,10)});
    const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,randomUUID:()=>`uuid-${qaStatus}`});
    await panel.refresh();
    assert.equal(fixture.byId('catalog-run-initial-qa').disabled,!qaEnabled,qaStatus);
    assert.equal(fixture.byId('catalog-activate-initial-pool').disabled,!activationEnabled,qaStatus);
    assert.equal(fixture.byId('catalog-current-target').textContent,'不限数量');
    assert.equal(fixture.byId('catalog-current-remaining').textContent,'—');
    assert.doesNotMatch(fixture.catalogRoot.textContent,/2147483647/);
    panel.destroy();
  }
});

test('create chooses Initial or Expansion from the exact selected Profile capability',async()=>{
  for(const [profile,method] of [[initialProfile,'createInitial'],[expansionProfile,'createExpansion']]){
    const fixture=catalogDomFixture(),api=fakeApi({profiles:[profile],current:null});
    const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,randomUUID:()=>`request-${method}`});
    await panel.refresh();fixture.byId('catalog-campaign-name').value=`Task ${method}`;
    fixture.byId('catalog-requested-new').value='3';await fixture.byId('catalog-create-form').emit('submit');
    assert.equal(api.calls[method].length,1);assert.equal(api.calls[method==='createInitial'?'createExpansion':'createInitial'].length,0);
    panel.destroy();
  }
});

test('QA and activation use explicit identity when CustomEvent is unavailable',async()=>{
  const fixture=catalogDomFixture({customEventAvailable:false}),api=fakeApi();let sequence=0;
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,randomUUID:()=>`uuid-${++sequence}`});
  await panel.refresh();await fixture.byId('catalog-run-initial-qa').emit('click');await fixture.byId('catalog-activate-initial-pool').emit('click');
  assert.deepEqual(api.calls.runInitialQa[0],{id:'campaign-1',body:{campaign_id:'campaign-1',category_key:'category-b',
    category_profile_version:'category-b-v1',request_id:'uuid-1'}});
  assert.deepEqual(api.calls.activateInitial[0],{id:'campaign-1',body:{campaign_id:'campaign-1',category_key:'category-b',
    category_profile_version:'category-b-v1',request_id:'uuid-2'}});
  assert.equal(fixture.yingdao.marker,'untouched');panel.destroy();
});

test('activation refreshes Profile capability, renders Pool identity, and emits optional frozen hints',async()=>{
  const fixture=catalogDomFixture(),api=fakeApi({afterActivationProfiles:[expansionProfile]});
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,randomUUID:()=>crypto.randomUUID()});
  await panel.refresh();await fixture.byId('catalog-run-initial-qa').emit('click');await fixture.byId('catalog-activate-initial-pool').emit('click');
  assert.match(fixture.byId('catalog-activation-result').textContent,/pool-b-v1/);
  assert.equal(panel.getState().profiles[0].expansion_available,true);
  const event=fixture.events.find(row=>row.type==='catalog:pool-activated');assert.ok(event);assert.equal(Object.isFrozen(event.detail),true);
  assert.equal(event.detail.pool_version_id,'pool-b-v1');assert.equal(fixture.yingdao.controls.disabled,false);panel.destroy();
});

test('Catalog API and validation errors render only inside Catalog root',async()=>{
  const fixture=catalogDomFixture(),api=fakeApi({current:null});api.createInitial=async()=>{const error=new Error('conflict');error.code='CATALOG_RPA_CLAIM_CONFLICT';throw error;};
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,randomUUID:()=> 'request-1'});
  await panel.refresh();fixture.byId('catalog-campaign-name').value='Initial B';await fixture.byId('catalog-create-form').emit('submit');
  assert.match(fixture.byId('catalog-error').textContent,/CATALOG_RPA_CLAIM_CONFLICT/);assert.equal(fixture.yingdao.marker,'untouched');panel.destroy();
});

test('blocker UI renders every owner and requires explicit confirmation before recovery',async()=>{const fixture=catalogDomFixture(),api=fakeApi({current:null}),ended=[];api.listClaimBlockers=async()=>({primary_blocker:{campaignId:'c2',queueId:'q2',sourceId:'s2',claimToken:'t2',claimGeneration:1,staleDetermination:'STALE_CONFIRMED'},all_blockers:[{campaignId:'c2',categoryKey:'motorcycle-accessories',campaignStatus:'paused',queueStatus:'capturing',staleDetermination:'STALE_CONFIRMED'},{campaignId:'c1',categoryKey:'motorcycle-accessories',campaignStatus:'paused',queueStatus:'capturing',staleDetermination:'STALE_NOT_PROVEN'}]});api.inspectClaim=async()=>({});api.endStaleClaim=async(id,body)=>{ended.push({id,body});return{};};const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,confirmAction:()=>true,randomUUID:()=> 'end-request'});await panel.refresh();assert.match(fixture.byId('catalog-claim-blocker-list').textContent,/c2/);assert.match(fixture.byId('catalog-claim-blocker-list').textContent,/c1/);await fixture.byId('catalog-end-stale-claim').emit('click');assert.equal(ended.length,1);assert.equal(fixture.yingdao.marker,'untouched');panel.destroy();});

test('current Catalog campaign is not rendered as its own historical claim conflict',async()=>{
  const fixture=catalogDomFixture(),current=initialCurrent(),api=fakeApi({current});
  api.listClaimBlockers=async()=>({primary_blocker:{campaignId:current.campaign_id,staleDetermination:'NOT_ELIGIBLE'},all_blockers:[
    {campaignId:current.campaign_id,categoryKey:current.category_key,campaignStatus:'running',queueStatus:'capturing',staleDetermination:'NOT_ELIGIBLE'}
  ]});
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler});
  await panel.refresh();
  assert.equal(fixture.byId('catalog-claim-blockers').hidden,true);
  assert.equal(panel.getState().claimRecovery.allBlockers.length,0);
  panel.destroy();
});

test('initial refresh shows loading while background polling refresh stays silent',async()=>{
  const fixture=catalogDomFixture();let gate=deferred(),round=0;
  const api={
    async listProfiles(){const pending=gate;await pending.promise;return{profiles:[{...expansionProfile,active_pool_count:10+round}]};},
    async currentCampaign(){const pending=gate;await pending.promise;return{current:null};},
  };
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler});
  assert.equal(fixture.byId('catalog-loading').hidden,false,'initial load should be visible');
  gate.resolve();await panel.refresh();
  assert.equal(fixture.byId('catalog-loading').hidden,true);
  assert.equal(panel.getState().profiles[0].active_pool_count,10);

  round=1;gate=deferred();
  const polling=[...fixture.timers.values()][0];polling.callback();await Promise.resolve();
  assert.equal(fixture.byId('catalog-loading').hidden,true,'background poll must not show loading');
  gate.resolve();await panel.refresh();
  assert.equal(panel.getState().profiles[0].active_pool_count,11,'silent poll must still refresh data');
  assert.equal(fixture.yingdao.marker,'untouched');panel.destroy();
});

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
