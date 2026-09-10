import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const breadcrumbSource=fs.readFileSync(path.resolve(import.meta.dirname,'../../browser-extension/catalog-breadcrumbs.js'),'utf8');
const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../browser-extension/catalog-manual-binding.js'),'utf8');
function module(){const sandbox=vm.createContext({URL});vm.runInContext(breadcrumbSource,sandbox);vm.runInContext(source,sandbox);return sandbox.TemuCatalogManualBinding;}
const profile={category_key:'category-b',category_profile_version:'category-b-v1',display_name:'Category B',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales'};
const campaign={id:'campaign-b',categoryKey:'category-b',categoryProfileVersion:'category-b-v1'};
function evidence(overrides={}){return {profile,domEvidence:{url:'https://www.temu.com/de-en/category-b.html?sort=top',siteCountry:'DE',language:'en',currency:'EUR',category:'Category B',sortOrder:'Top Sales',cardCount:10,ready:true,...overrides},networkEvidence:{ready:true}};}

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

const captureOnly={...profile,category_key:'girls-sets',category_profile_version:'girls-v1',profile_kind:'CAPTURE_ONLY',category_aliases:['girls'],page_health:{category_names:['girls']},breadcrumbs:["Kids' Fashion","Girls' Sets"],listing_url:'https://www.temu.com/de-en/girls-sets-o3-1088.html'};
function girls(overrides={},networkOverrides={}){return{profile:captureOnly,domEvidence:{url:'https://www.temu.com/de-en/girls-sets-o3-1088.html?tracking=1',siteCountry:'DE',language:'en',currency:'EUR',category:'',categoryCandidates:[{value:"Girls' Sets",source:'BREADCRUMB_TERMINAL'}],categorySource:'BREADCRUMB_TERMINAL',breadcrumbs:['Home',"Kids' Fashion","Girls' Sets"],sortOrder:'Top sales',cardCount:20,domReady:true,searchNoResults:false,captchaBlocking:false,...overrides},networkEvidence:{ready:true,...networkOverrides}};}

test('Capture-only Girls Sets can be READY without h1 using exact listing path and breadcrumb suffix',()=>{
  const detected=module().detectCurrentPage(girls());assert.equal(detected.health.status,'READY');assert.equal(detected.observed.category,"Girls' Sets");assert.equal(detected.observed.categorySource,'BREADCRUMB_TERMINAL');assert.deepEqual(Array.from(detected.health.warnings),['PROFILE_CATEGORY_ALIAS_WEAK']);
});

test('DOM-only listing is blocked because manual capture requires a strict DOM and Network intersection',()=>{
  const detected=module().detectCurrentPage(girls({}, {ready:false}));
  assert.equal(detected.health.status,'BLOCKED');
  assert.equal(detected.health.code,'STRICT_CAPTURE_EVIDENCE_REQUIRED');
  assert.equal(detected.health.checks.evidenceReady,false);
});

test('Capture-only category and breadcrumb signals fail closed on conflicts and mismatches',()=>{
  const api=module();
  let result=api.detectCurrentPage(girls({breadcrumbs:['Home',"Girls' Sets"]}));assert.equal(result.health.status,'BLOCKED');assert.ok(result.health.failed.includes('breadcrumbs'));
  result=api.detectCurrentPage(girls({url:'https://www.temu.com/de-en/boys-sets-o3-1090.html'}));assert.equal(result.health.status,'BLOCKED');assert.equal(result.health.code,'LISTING_PATH_MISMATCH');assert.ok(result.health.failed.includes('listingPath'));
  result=api.detectCurrentPage(girls({category:"Boys' Sets",categoryCandidates:[{value:"Boys' Sets",source:'H1'},{value:"Girls' Sets",source:'BREADCRUMB_TERMINAL'}]}));assert.equal(result.health.code,'CATEGORY_SIGNALS_CONFLICT');
});

test('Capture-only does not use weak substring or a wrong breadcrumb terminal',()=>{
  const result=module().detectCurrentPage(girls({category:'',categoryCandidates:[{value:"Boys' Sets",source:'BREADCRUMB_TERMINAL'}],breadcrumbs:['Home',"Kids' Fashion","Boys' Sets"]}));
  assert.equal(result.health.status,'BLOCKED');assert.equal(result.health.code,'PROFILE_CORRECTION_REQUIRED');
});

test('all mandatory page-health gates remain required',()=>{
  const api=module();for(const [field,value,check] of [['sortOrder','Recommended','sort'],['captchaBlocking',true,'notCaptchaBlocking'],['cardCount',0,'products'],['searchNoResults',true,'notSearchNoResults'],['domReady',false,'evidenceReady']]){const input=girls({[field]:value});if(field==='domReady')input.networkEvidence.ready=false;const result=api.detectCurrentPage(input);assert.equal(result.health.checks[check],false);assert.equal(result.health.status,'BLOCKED');}
});
