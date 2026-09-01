import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCatalogPanel } from '../../ui/modules/catalog/panel.js';

test('Catalog mount starts exactly one timer and same-root remount starts none',async()=>{
  const scheduler=fakeScheduler(),api=successApi(),root=fakeRoot();
  const first=mountCatalogPanel({root,scheduler,api,pollIntervalMs:1500});
  const second=mountCatalogPanel({root,scheduler,api,pollIntervalMs:1500});
  assert.equal(second,first);
  assert.equal(scheduler.activeCount(),1);
  assert.equal(scheduler.intervals()[0].delay,1500);
  await first.refresh();first.destroy();
});

test('Catalog refresh coalesces concurrent polls',async()=>{
  const scheduler=fakeScheduler(),gate=deferred(),calls={profiles:0,current:0};
  const api={
    async listProfiles(){calls.profiles++;await gate.promise;return{profiles:[]};},
    async currentCampaign(){calls.current++;await gate.promise;return{current:null};}
  };
  const panel=mountCatalogPanel({root:fakeRoot(),scheduler,api});
  const first=panel.refresh(),second=panel.refresh();
  await Promise.resolve();
  assert.deepEqual(calls,{profiles:1,current:1});
  gate.resolve();await Promise.all([first,second]);panel.destroy();
});

test('Catalog API error changes only Catalog error and leaves YingDao state untouched',async()=>{
  const yingdao={loading:false,error:null,run_id:'yingdao-run-7',controlsDisabled:false};
  const api={async listProfiles(){throw new Error('offline');},async currentCampaign(){return{current:null};}};
  const panel=mountCatalogPanel({root:fakeRoot(),scheduler:fakeScheduler(),api});
  await panel.refresh();
  assert.match(panel.getState().error.message,/offline/);
  assert.deepEqual(yingdao,{loading:false,error:null,run_id:'yingdao-run-7',controlsDisabled:false});
  panel.destroy();
});

test('Catalog destroy clears only catalogPollingTimer',()=>{
  const scheduler=fakeScheduler(),foreignTimer=scheduler.setInterval(()=>{},5000);
  const panel=mountCatalogPanel({root:fakeRoot(),scheduler,api:successApi()});
  assert.equal(scheduler.activeCount(),2);
  panel.destroy();
  assert.equal(scheduler.isActive(foreignTimer),true);
  assert.equal(scheduler.activeCount(),1);
});

function successApi(){return{
  async listProfiles(){return{profiles:[],invalid:[]};},
  async currentCampaign(){return{current:null};}
};}
function fakeRoot(){let html='';return{
  get innerHTML(){return html;},set innerHTML(value){html=String(value);},replaceChildren(){html='';}
};}
function fakeScheduler(){let sequence=0;const active=new Map();return{
  setInterval(fn,delay){const id=++sequence;active.set(id,{fn,delay});return id;},
  clearInterval(id){active.delete(id);},
  activeCount(){return active.size;},isActive(id){return active.has(id);},intervals(){return [...active.values()];}
};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
