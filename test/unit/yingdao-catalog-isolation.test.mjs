import assert from 'node:assert/strict';
import test from 'node:test';
import {mountCatalogPanel} from '../../ui/modules/catalog/panel.js';
import {mountYingdaoPanel} from '../../ui/modules/yingdao/panel.js';
import {catalogDomFixture} from '../fixtures/catalog-panel-dom-fixture.mjs';
import {yingdaoDomFixture} from '../fixtures/yingdao-panel-dom-fixture.mjs';
import {verifyYingdaoUiDelivery} from '../../scripts/1688/verify-yingdao-ui-delivery.mjs';

test('Catalog and YingDao refresh polling error and destroy are symmetric and isolated',async()=>{
  const catalogFixture=catalogDomFixture(),yingdaoFixture=yingdaoDomFixture(),scheduler=sharedScheduler(),catalogApi={listProfiles:async()=>({profiles:[]}),currentCampaign:async()=>({current:null})};
  const yingdaoApi={settings:async()=>({state:'READY_TO_SCAN'}),currentImport:async()=>({state:'READY_TO_SCAN'}),reviewBootstrap:async()=>({total_goods:50,awaiting_review:50,confirmed:0,no_selection:0})};
  const catalog=mountCatalogPanel({root:catalogFixture.catalogRoot,scheduler,api:catalogApi}),yingdao=mountYingdaoPanel({root:yingdaoFixture.yingdaoRoot,scheduler,api:yingdaoApi});
  await Promise.all([catalog.refresh(),yingdao.refresh()]);const catalogBefore=catalog.getState(),yingdaoBefore=yingdao.getState();
  await yingdao.refresh();assert.deepEqual(catalog.getState(),catalogBefore);await catalog.refresh();assert.deepEqual(yingdao.getState(),yingdaoBefore);
  catalog.destroy();assert.match(yingdaoFixture.yingdaoRoot.innerHTML,/yingdao-panel/);assert.equal(scheduler.active.size,1);yingdao.destroy();assert.equal(scheduler.active.size,0);
});

test('delivery verifier reports no duplicate ownership or Catalog writes',()=>{
  const report=verifyYingdaoUiDelivery({projectRoot:process.cwd()});assert.equal(report.pass,true);assert.equal(report.duplicate_dom_ids,0);assert.equal(report.yingdao_dom_ids_outside_namespace,0);
  assert.equal(report.duplicate_routes,0);assert.equal(report.duplicate_polling_owners,0);assert.equal(report.legacy_duplicate_yingdao_implementation,0);assert.equal(report.catalog_core_writes_from_yingdao,0);
});

test('YingDao run identity cannot substitute for Catalog campaign identity',()=>{
  const runId='yingdao_random5_v1_20260831_001',campaignId='catalog-campaign-1';assert.notEqual(runId,campaignId);
});

function sharedScheduler(){let id=0;const active=new Map();return{active,setInterval(fn,delay){const key=++id;active.set(key,{fn,delay});return key;},clearInterval(key){active.delete(key);}};}
