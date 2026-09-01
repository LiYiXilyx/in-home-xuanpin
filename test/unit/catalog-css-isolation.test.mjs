import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=url=>fs.readFileSync(new URL(url,import.meta.url),'utf8');

test('Catalog stylesheet exists and every concrete selector is catalog namespaced',()=>{
  const css=read('../../ui/modules/catalog/catalog.css');
  const withoutMedia=css.replace(/@media[^\{]+\{/g,'');
  const selectors=[...withoutMedia.matchAll(/(?:^|\})([^{}]+)\{/g)].map(match=>match[1].trim()).filter(Boolean);
  assert.ok(selectors.length>10);
  for(const selector of selectors){for(const part of selector.split(','))assert.match(part.trim(),/^\.catalog-/);}
  assert.doesNotMatch(css,/(^|[\s,{])\.(operator|initial-pool)-/m);
});

test('shared stylesheet releases old Catalog selectors but retains legacy Dashboard ownership',()=>{
  const shared=read('../../ui/styles.css'),html=read('../../ui/index.html');
  assert.doesNotMatch(shared,/\.(operator-campaign-panel|operator-form|operator-error|operator-current|operator-current-grid|initial-pool-actions|initial-pool-result)\b/);
  for(const selector of ['.browser-health','.controls','.metrics','.workspace','.history','.events','.toast'])assert.match(shared,new RegExp(escapeRegex(selector)));
  assert.match(html,/href="\/modules\/catalog\/catalog\.css"/);
});

function escapeRegex(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
