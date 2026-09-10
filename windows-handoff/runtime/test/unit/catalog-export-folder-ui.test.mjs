import test from 'node:test';import assert from 'node:assert/strict';
import {mountCatalogPanel} from '../../ui/modules/catalog/panel.js';import {catalogDomFixture} from '../fixtures/catalog-panel-dom-fixture.mjs';
test('folder button appears after export success and opens directory without re-exporting',async t=>{
 const f=catalogDomFixture();let exports=0,opens=0;
 const current={campaign_id:'c',campaign_type:'initial',category_key:'a',category_profile_version:'a-v1',current_unique:40,status:'running'};
 const api={listProfiles:async()=>({profiles:[]}),currentCampaign:async()=>({current}),exportInitialPreview:async()=>{exports++;return{result:{file_name:'preview.xlsx'}};},openExportFolder:async()=>{opens++;return{message:'目录已打开'};}};
 const panel=mountCatalogPanel({root:f.catalogRoot,api,scheduler:f.scheduler});t.after(()=>panel.destroy());await panel.refresh();
 const button=f.byId('catalog-open-export-folder');assert.ok(button);assert.equal(button.hidden,true);
 await f.byId('catalog-export-preview').emit('click');assert.equal(button.hidden,false);assert.equal(opens,0);
 await button.emit('click');assert.equal(opens,1);assert.equal(exports,1);assert.equal(f.yingdao.marker,'untouched');
});
