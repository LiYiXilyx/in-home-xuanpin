import assert from 'node:assert/strict';
import test from 'node:test';
import {yingdaoDomFixture} from '../fixtures/yingdao-panel-dom-fixture.mjs';
import {mountYingdaoPanel,refreshYingdaoPanel,yingdaoPanelMarkup} from '../../ui/modules/yingdao/panel.js';

test('YingDao markup uses only yingdao namespaced IDs and classes',()=>{
  const ids=[...yingdaoPanelMarkup.matchAll(/\bid="([^"]+)"/g)].map(row=>row[1]);
  const classes=[...yingdaoPanelMarkup.matchAll(/\bclass="([^"]+)"/g)].flatMap(row=>row[1].split(/\s+/));
  assert.ok(ids.length>10);assert.ok(ids.every(id=>id.startsWith('yingdao-')));
  assert.ok(classes.filter(Boolean).every(name=>name.startsWith('yingdao-')));
  assert.equal(new Set(ids).size,ids.length);
});

test('same-root mount is idempotent and destroy owns only supplied root',()=>{
  const {yingdaoRoot,scheduler,timers}=yingdaoDomFixture(),foreign={marker:'catalog'};
  const api={settings:async()=>({state:'UNCONFIGURED'}),currentImport:async()=>({state:'UNCONFIGURED'})};
  const first=mountYingdaoPanel({root:yingdaoRoot,scheduler,api}),second=mountYingdaoPanel({root:yingdaoRoot,scheduler,api});
  assert.equal(first,second);assert.equal(timers.size,1);first.destroy();assert.equal(yingdaoRoot.innerHTML,'');assert.deepEqual(foreign,{marker:'catalog'});
});

test('refresh before mount hard fails',async()=>{
  await assert.rejects(()=>refreshYingdaoPanel(),error=>error.code==='YINGDAO_PANEL_NOT_MOUNTED');
});
