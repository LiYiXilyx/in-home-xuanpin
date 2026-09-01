import assert from 'node:assert/strict';
import test from 'node:test';
import {createYingdaoState,patchYingdaoState,snapshotYingdaoState} from '../../ui/modules/yingdao/state.js';
import {createYingdaoApi} from '../../ui/modules/yingdao/api.js';
import {deriveYingdaoControls} from '../../ui/modules/yingdao/model.js';

test('YingDao state owns the approved private fields and rejects Catalog keys',()=>{
  const state=createYingdaoState();
  for(const key of ['currentRun','selectedTask','loading','error','progress','random5','imageCache','exportStatus','importStatus','scanStatus','reviewSummary'])assert.ok(Object.hasOwn(state,key),key);
  assert.throws(()=>patchYingdaoState(state,{catalogState:{}}),error=>error.code==='YINGDAO_STATE_KEY_INVALID');
  const snapshot=snapshotYingdaoState(state);assert.ok(Object.isFrozen(snapshot));assert.notEqual(snapshot,state);
});

test('YingDao API calls only existing sourcing endpoints and preserves errors',async()=>{
  const calls=[],fetchImpl=async(url,options={})=>{calls.push([String(url),options.method??'GET']);return{ok:url!=='/api/sourcing/scan',status:url==='/api/sourcing/imports'?202:200,
    async json(){return url==='/api/sourcing/scan'?{error:{code:'SCAN_BLOCKED',message:'bad raw'}}:{ok:true};}};};
  const api=createYingdaoApi({fetchImpl});await api.settings();await api.currentImport();await api.saveSettings({});await api.choosePath('RAW_DIRECTORY');await api.startImport('token');
  await assert.rejects(()=>api.scan(),error=>error.code==='SCAN_BLOCKED'&&error.message==='bad raw');
  assert.deepEqual(calls.map(row=>row[0]),['/api/sourcing/settings','/api/sourcing/imports/current','/api/sourcing/settings','/api/sourcing/path-dialog','/api/sourcing/imports','/api/sourcing/scan']);
  assert.ok(calls.every(row=>row[0].startsWith('/api/sourcing/')));
});

test('control model keeps import and retry gates local to YingDao',()=>{
  assert.equal(deriveYingdaoControls({scanStatus:'SCAN_VALID'}).canImport,true);
  assert.equal(deriveYingdaoControls({scanStatus:'IMPORTING'}).pathsLocked,true);
  assert.equal(deriveYingdaoControls({scanStatus:'COMPLETED_WITH_WARNINGS',imageCache:{failed:2}}).canRetry,true);
});
