import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('shared shell performs exactly one YingDao import and mount',()=>{
  const app=fs.readFileSync('ui/app.js','utf8'),html=fs.readFileSync('ui/index.html','utf8');
  assert.match(app,/import\s*\{\s*mountYingdaoPanel\s*\}\s*from\s*['"]\.\/modules\/yingdao\/panel\.js['"]/);
  assert.equal((app.match(/mountYingdaoPanel\(/g)??[]).length,1);
  assert.match(app,/mountYingdaoPanel\(\{\s*root\s*:\s*yingdaoRoot\s*\}\)/);
  assert.equal((html.match(/id="yingdao-module-root"/g)??[]).length,1);
  assert.equal((html.match(/modules\/yingdao\/yingdao\.css/g)??[]).length,1);
});

test('legacy YingDao implementation is absent from shared app and markup',()=>{
  const app=fs.readFileSync('ui/app.js','utf8'),html=fs.readFileSync('ui/index.html','utf8'),styles=fs.readFileSync('ui/styles.css','utf8');
  for(const legacy of ['sourcingModel','refreshSourcing','renderSourcing','saveSourcingPaths','sourcingControls'])assert.doesNotMatch(app,new RegExp(legacy));
  assert.doesNotMatch(html,/sourcingState|sourcingRawDir|scanSourcing|startSourcingImport/);
  assert.doesNotMatch(styles,/\.sourcing-console|\.sourcing-paths|\.sourcing-actions|\.sourcing-metrics|\.sourcing-preview/);
  assert.equal((app.match(/setInterval/g)??[]).length,1);
});
