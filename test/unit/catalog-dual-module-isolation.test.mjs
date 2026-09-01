import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mountCatalogPanel } from '../../ui/modules/catalog/panel.js';
import { catalogDomFixture } from '../fixtures/catalog-panel-dom-fixture.mjs';

test('Catalog refresh, error rerender, and destroy leave YingDao root/state/controls untouched',async()=>{
  const fixture=catalogDomFixture(),yingdaoRoot={innerHTML:'<button id="yingdao-run">运行</button>'},
    yingdaoState={run_id:'yingdao-run-1',loading:false},yingdaoControls={disabled:false};let round=0;
  const api={async listProfiles(){round+=1;if(round===2){const error=new Error('catalog offline');error.code='CATALOG_OFFLINE';throw error;}
      return{profiles:[]};},async currentCampaign(){return{current:null};}};
  const before={html:yingdaoRoot.innerHTML,state:structuredClone(yingdaoState),disabled:yingdaoControls.disabled};
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler});
  await panel.refresh();await panel.refresh();assert.equal(panel.getState().error.code,'CATALOG_OFFLINE');panel.destroy();
  assert.equal(yingdaoRoot.innerHTML,before.html);assert.deepEqual(yingdaoState,before.state);assert.equal(yingdaoControls.disabled,before.disabled);
});

test('Catalog works without a YingDao root and without CustomEvent support',async()=>{
  const fixture=catalogDomFixture({customEventAvailable:false}),api={async listProfiles(){return{profiles:[]};},async currentCampaign(){return{current:null};}};
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler});await panel.refresh();panel.destroy();
});

test('Catalog module has no source dependency on YingDao state/root or whole-body rendering',()=>{
  const source=fs.readFileSync(new URL('../../ui/modules/catalog/panel.js',import.meta.url),'utf8');
  for(const forbidden of ['yingdao-module-root','yingdaoState','random5State','currentRun','document.body.innerHTML'])assert.doesNotMatch(source,new RegExp(forbidden));
});
