import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../../ui/app.js',import.meta.url),'utf8');

test('app.js is the legacy shell plus one Catalog mount',()=>{
  assert.match(app,/import\s*\{\s*mountCatalogPanel\s*\}\s*from\s*['"]\.\/modules\/catalog\/panel\.js['"]/);
  assert.match(app,/mountCatalogPanel\(\{\s*root\s*:\s*catalogRoot\s*\}\)/);
  assert.equal((app.match(/mountCatalogPanel\(/g)??[]).length,1);
  for(const forbidden of ['operatorProfiles','selectedOperatorProfile','currentOperatorCampaign','operatorRequestId',
    'loadOperatorProfiles','refreshOperatorCurrent','renderOperatorCurrent','createOperatorCampaign','runInitialQa','activateInitial']){
    assert.doesNotMatch(app,new RegExp(`\\b${forbidden}\\b`),forbidden);
  }
});

test('legacy Dashboard ownership remains in app.js',()=>{
  for(const retained of ['renderBrowserHealth','renderHistory','renderEvents','renderControls','renderNotice',
    '/api/status','/api/export','/api/clear/excel','/api/reviews/'])assert.match(app,new RegExp(escapeRegex(retained)),retained);
});

test('legacy polling refreshes only the legacy Dashboard',()=>{
  assert.match(app,/setInterval\(\(\)=>\s*\{?\s*(?:void\s+)?refresh\(\)/);
  assert.doesNotMatch(app,/setInterval[\s\S]{0,160}refreshOperatorCurrent/);
});

function escapeRegex(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
