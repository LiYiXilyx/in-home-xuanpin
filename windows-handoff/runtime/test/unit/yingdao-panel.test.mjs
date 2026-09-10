import assert from 'node:assert/strict';
import test from 'node:test';
import {mountYingdaoPanel} from '../../ui/modules/yingdao/panel.js';
import {yingdaoDomFixture} from '../fixtures/yingdao-panel-dom-fixture.mjs';

test('settings, path dirty, scan and import remain the validated sourcing flow',async()=>{
  const {yingdaoRoot,scheduler,byId}=yingdaoDomFixture(),calls=[];
  const api={
    settings:async()=>({state:'READY_TO_SCAN',settings:{sourceDir:'/raw',imageCacheDir:'/images',selectedWorkbookPath:'/book.xlsx'}}),currentImport:async()=>({state:'READY_TO_SCAN'}),
    saveSettings:async body=>{calls.push(['save',body]);return{state:'READY_TO_SCAN',settings:body};},
    choosePath:async()=>({state:'READY_TO_SCAN'}),scan:async()=>{calls.push(['scan']);return{state:'SCAN_VALID',scan_token:'scan-1',source_files:50,valid_goods_id:50,random5_candidates:250,preview:{files:[{filename:'1.xlsx',goods_id:'1',row_count:30,parse_status:'OK'}]}};},
    startImport:async token=>{calls.push(['import',token]);return{state:'COMPLETED',current_run_id:'yingdao-run-1',candidate_count:250,image_download_success:250,image_download_failed:0};},
    retryFailedImages:async()=>({state:'COMPLETED'}),reviewBootstrap:async()=>({})
  };
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});await panel.refresh();
  assert.equal(byId('yingdao-raw-directory').value,'/raw');assert.equal(byId('yingdao-scan').disabled,false);
  byId('yingdao-raw-directory').value='/new raw';await byId('yingdao-raw-directory').emit('input');assert.equal(panel.getState().scanStatus,'SCAN_STALE');
  await byId('yingdao-scan').emit('click');assert.equal(panel.getState().scanStatus,'SCAN_VALID');assert.equal(byId('yingdao-import').disabled,false);
  await byId('yingdao-import').emit('click');assert.equal(panel.getState().currentRun,'yingdao-run-1');assert.deepEqual(calls.at(-1),['import','scan-1']);panel.destroy();
});

test('failed-image retry is enabled only for the current warning run',async()=>{
  const {yingdaoRoot,scheduler,byId}=yingdaoDomFixture();let retried=null;const api={settings:async()=>({state:'COMPLETED_WITH_WARNINGS'}),currentImport:async()=>({state:'COMPLETED_WITH_WARNINGS',current_run_id:'run-warning',image_failed:2}),
    retryFailedImages:async runId=>{retried=runId;return{state:'COMPLETED',current_run_id:runId,image_failed:0};},reviewBootstrap:async()=>({})};
  const panel=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});await panel.refresh();assert.equal(byId('yingdao-retry-images').disabled,false);
  await byId('yingdao-retry-images').emit('click');assert.equal(retried,'run-warning');assert.equal(panel.getState().imageCache.failed,0);panel.destroy();
});
