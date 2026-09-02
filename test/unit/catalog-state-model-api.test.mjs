import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogState,patchCatalogState,snapshotCatalogState } from '../../ui/modules/catalog/state.js';
import { createCatalogApi } from '../../ui/modules/catalog/api.js';

test('Catalog state exposes only the approved namespace and rejects foreign keys',()=>{
  const state=createCatalogState();
  assert.deepEqual(Object.keys(state).sort(),[
    'activation','claimRecovery','currentCampaign','currentPool','error','initialQa','lastRefreshedAt',
    'loading','mounted','onboarding','profiles','quantityPolicy','selectedProfile'
  ]);
  assert.deepEqual(state.loading,{profiles:false,current:false,create:false,qa:false,activation:false,claim:false,onboardingValidate:false,onboardingSave:false,export:false});
  assert.equal('yingdaoState' in state,false);
  assert.equal('currentRun' in state,false);
  assert.throws(()=>patchCatalogState(state,{yingdaoState:{}}),error=>error.code==='CATALOG_STATE_KEY_INVALID');
});

test('Catalog state snapshots are detached and recursively frozen',()=>{
  const state=createCatalogState();
  patchCatalogState(state,{profiles:[{category_key:'category-b'}],loading:{...state.loading,current:true}});
  const snapshot=snapshotCatalogState(state);
  assert.notEqual(snapshot,state);
  assert.notEqual(snapshot.profiles,state.profiles);
  assert.equal(Object.isFrozen(snapshot),true);
  assert.equal(Object.isFrozen(snapshot.loading),true);
  assert.throws(()=>{snapshot.loading.current=false;},TypeError);
  assert.equal(state.loading.current,true);
});

test('Catalog API calls only exact /api/catalog endpoints',async()=>{
  const calls=[],api=createCatalogApi({fetchImpl:async(url,options)=>{
    calls.push({url,method:options.method,body:options.body});
    return jsonResponse(url.includes('/profiles')?{ok:true,profiles:[]}:{ok:true,current:null});
  }});
  await api.listProfiles();await api.currentCampaign();
  await api.createExpansion({request_id:'r1'});await api.createInitial({request_id:'r2'});
  await api.runInitialQa('campaign 1',{request_id:'r3'});await api.activateInitial('campaign 1',{request_id:'r4'});
  assert.deepEqual(calls.map(call=>[call.url,call.method]),[
    ['/api/catalog/operator/profiles','GET'],
    ['/api/catalog/operator-campaign/current','GET'],
    ['/api/catalog/operator-campaigns','POST'],
    ['/api/catalog/operator/initial-campaigns','POST'],
    ['/api/catalog/operator/initial-campaigns/campaign%201/qa-runs','POST'],
    ['/api/catalog/operator/initial-campaigns/campaign%201/activate','POST']
  ]);
  assert.equal(calls.every(call=>call.url.startsWith('/api/catalog/')),true);
});

test('Catalog API preserves server error code and message',async()=>{
  const api=createCatalogApi({fetchImpl:async()=>jsonResponse({
    ok:false,error:{code:'CATALOG_RPA_CLAIM_CONFLICT',message:'conflict'}
  },409)});
  await assert.rejects(()=>api.currentCampaign(),error=>
    error.code==='CATALOG_RPA_CLAIM_CONFLICT'&&error.message==='conflict');
});

test('legacy operator-campaign entry re-exports the same model functions',async()=>{
  const legacy=await import('../../ui/operator-campaign.js');
  const model=await import('../../ui/modules/catalog/model.js');
  for(const name of ['calculateTarget','buildCreatePayload','buildInitialCreatePayload','buildInitialQaPayload',
    'buildInitialActivationPayload','initialOperatorViewModel','operatorErrorMessage','createRequestIdentity']){
    assert.equal(legacy[name],model[name],name);
  }
});

function jsonResponse(payload,status=200){return{
  ok:status>=200&&status<300,status,
  async json(){return payload;}
};}
