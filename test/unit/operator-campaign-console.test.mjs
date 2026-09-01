import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const html=fs.readFileSync(fileURLToPath(new URL('../../ui/index.html',import.meta.url)),'utf8');
const appSource=fs.readFileSync(fileURLToPath(new URL('../../ui/app.js',import.meta.url)),'utf8');
const panelSource=fs.readFileSync(fileURLToPath(new URL('../../ui/modules/catalog/panel.js',import.meta.url)),'utf8');

test('localhost console exposes operator Campaign creation without Campaign ID input',()=>{
  assert.match(html,/id="operatorHeaderContext"/);
  for(const id of ['catalog-create-form','catalog-category-select','catalog-profile-select','catalog-requested-new',
    'catalog-calculated-target','catalog-campaign-name','catalog-create-campaign','catalog-current-campaign']){
    assert.match(panelSource,new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(panelSource,/<input[^>]+(?:campaign[_-]?id|catalog-current-campaign-id)/i);
});

test('operator create handler calls only the explicit create API and contains no automatic capture actions',()=>{
  assert.match(appSource,/from ['"]\.\/modules\/catalog\/panel\.js['"]/);
  const start=panelSource.indexOf('async function createCampaign');
  const end=panelSource.indexOf('\n}',start)+2;
  assert.ok(start>=0);
  const handler=panelSource.slice(start,end);
  assert.match(handler,/api\.createInitial|api\.createExpansion/);
  assert.doesNotMatch(handler,/\/resume|\/cancel|\/capture|scroll|see.?more|\/api\/jobs\/start/i);
});

test('current task card exposes scoped progress and binding state',()=>{
  for (const id of ['catalog-current-category','catalog-current-name','catalog-current-campaign-id','catalog-current-baseline',
    'catalog-current-target','catalog-live-unique-count','catalog-current-remaining','catalog-current-status','catalog-current-binding']) {
    assert.match(panelSource,new RegExp(`id="${id}"`));
  }
});
