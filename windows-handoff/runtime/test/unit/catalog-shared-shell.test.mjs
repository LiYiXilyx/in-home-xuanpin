import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../../ui/index.html',import.meta.url),'utf8');

test('shared shell exposes distinct Catalog and empty YingDao roots in stable order',()=>{
  assert.match(html,/id="catalog-module-root"/);
  assert.match(html,/<section\s+id="yingdao-module-root"[^>]*><\/section>/);
  assert.ok(html.indexOf('catalog-module-root')<html.indexOf('yingdao-module-root'));
});

test('shared shell leaves both business module roots empty',()=>{
  const start=html.indexOf('id="catalog-module-root"'),end=html.indexOf('id="yingdao-module-root"');
  assert.match(html.slice(start,end),/id="catalog-module-root"[^>]*><\/section>/);
  assert.doesNotMatch(html,/id="operatorCampaignForm"/);
});
