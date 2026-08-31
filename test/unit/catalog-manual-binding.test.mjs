import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../browser-extension/catalog-manual-binding.js'),'utf8');
function module(){const sandbox=vm.createContext({URL});vm.runInContext(source,sandbox);return sandbox.TemuCatalogManualBinding;}
const profile={category_key:'category-b',category_profile_version:'category-b-v1',display_name:'Category B',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales'};
const campaign={id:'campaign-b',categoryKey:'category-b',categoryProfileVersion:'category-b-v1'};
function evidence(overrides={}){return {profile,domEvidence:{url:'https://www.temu.com/de-en/category-b.html?sort=top',siteCountry:'DE',language:'en',currency:'EUR',category:'Category B',sortOrder:'Top Sales',cardCount:10,ready:true,...overrides},networkEvidence:{ready:false}};}

test('detection is separate from binding and all Page Health checks must pass',()=>{
  const api=module(),detection=api.detectCurrentPage(evidence());assert.equal(detection.health.status,'READY');
  const blocked=api.detectCurrentPage(evidence({currency:'USD'}));assert.equal(blocked.health.status,'BLOCKED');assert.equal(blocked.health.checks.currency,false);
});

test('binding requires an explicit Campaign and context changes invalidate it',()=>{
  const api=module(),detection=api.detectCurrentPage(evidence());
  const binding=api.bindDetectedPage({detection,campaign,profile,sourceId:'source-b',now:()=> '2026-08-31T00:00:00.000Z'});
  assert.equal(api.validateBindingForCapture({binding,detection,campaign,profile,sourceId:'source-b'}),binding);
  const changed=api.detectCurrentPage(evidence({url:'https://www.temu.com/de-en/other.html?sort=top'}));
  assert.throws(()=>api.validateBindingForCapture({binding,detection:changed,campaign,profile,sourceId:'source-b'}),error=>error.code==='PAGE_CONTEXT_LOST');
});

test('manual batch id is deterministic for repeated capture content',()=>{
  const api=module(),input={campaignId:'campaign-b',sourceId:'source-b',bindingGeneration:1,contextFingerprint:'context',contentFingerprint:api.contentFingerprint(['2','1'])};
  assert.equal(api.manualBatchId(input),api.manualBatchId({...input,contentFingerprint:api.contentFingerprint(['1','2','2'])}));
});
