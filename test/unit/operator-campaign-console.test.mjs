import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const html=fs.readFileSync(fileURLToPath(new URL('../../ui/index.html',import.meta.url)),'utf8');
const appSource=fs.readFileSync(fileURLToPath(new URL('../../ui/app.js',import.meta.url)),'utf8');

test('localhost console exposes operator Campaign creation without Campaign ID input',()=>{
  assert.match(html,/id="operatorHeaderContext"/);
  assert.match(html,/id="operatorCampaignForm"/);
  assert.match(html,/id="operatorCategory"/);
  assert.match(html,/id="operatorProfile"/);
  assert.match(html,/id="operatorRequestedNew"/);
  assert.match(html,/id="operatorCalculatedTarget"/);
  assert.match(html,/id="operatorCampaignName"/);
  assert.match(html,/id="createOperatorCampaign"/);
  assert.match(html,/id="operatorCurrentCampaign"/);
  assert.doesNotMatch(html,/<input[^>]+(?:campaign[_-]?id|operatorCurrentId)/i);
});

test('operator create handler calls only the explicit create API and contains no automatic capture actions',()=>{
  assert.match(appSource,/from ['"]\.\/operator-campaign\.js['"]/);
  assert.match(appSource,/\/api\/catalog\/operator\/profiles/);
  assert.match(appSource,/\/api\/catalog\/operator-campaign\/current/);
  const start=appSource.indexOf('async function createOperatorCampaign');
  const end=appSource.indexOf('\n}',start)+2;
  assert.ok(start>=0);
  const handler=appSource.slice(start,end);
  assert.match(handler,/\/api\/catalog\/operator-campaigns/);
  assert.doesNotMatch(handler,/\/resume|\/cancel|\/capture|scroll|see.?more|\/api\/jobs\/start/i);
});

test('current task card exposes scoped progress and binding state',()=>{
  for (const id of ['operatorCurrentCategory','operatorCurrentName','operatorCurrentId','operatorCurrentBaseline',
    'operatorCurrentTarget','operatorCurrentUnique','operatorCurrentRemaining','operatorCurrentStatus','operatorCurrentBinding']) {
    assert.match(html,new RegExp(`id="${id}"`));
  }
});
