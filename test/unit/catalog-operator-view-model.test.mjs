import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
function load(){const sandbox=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'browser-extension/catalog-operator-view-model.js'),'utf8'),sandbox);return sandbox.TemuCatalogOperatorViewModel;}
function girls(overrides={}){return{state:'UNBOUND',context:{campaign:{id:'girls-c1',campaignType:'initial',categoryKey:'girls-sets',categoryProfileVersion:'operator-girls-sets-v1-bf7cb4caf08d',browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE',quantityMode:'OPEN_ENDED',targetCount:null,nonElectronicUniqueCount:0},profile:{category_key:'girls-sets',category_profile_version:'operator-girls-sets-v1-bf7cb4caf08d',display_name:'小女孩童装',page_health:{category_names:["Girls' Sets"]},site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales'},queue:{checkpoint:{}}},detection:null,binding:null,lastResult:null,lastError:null,...overrides};}

test('girls Profile and OPEN_ENDED project to operator copy without Motorcycle, 0/0, or null target',()=>{
  const vm=load().build(girls()),serialized=JSON.stringify(vm);
  assert.equal(vm.categoryLabel,"小女孩童装 / Girls' Sets");
  assert.equal(vm.quantity.label,'不限数量');assert.equal(vm.quantity.currentUnique,0);assert.equal(vm.quantity.target,null);
  assert.doesNotMatch(serialized,/Motorcycle|0\s*\/\s*0|target:\s*null/i);
  assert.equal(vm.steps.detect.enabled,true);assert.equal(vm.steps.bind.enabled,false);assert.equal(vm.steps.capture.enabled,false);
  assert.match(vm.steps.bind.disabledReason,/页面检测/);assert.equal(vm.technical.expanded,false);
});

test('Motorcycle Profile remains dynamic and correctly labelled',()=>{
  const value=girls();value.context.profile={...value.context.profile,category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',display_name:'Motorcycle Accessories',page_health:{category_names:['Motorcycles & Powersports Accessories']}};value.context.campaign={...value.context.campaign,categoryKey:'motorcycle-accessories',categoryProfileVersion:'motorcycle-accessories-v1'};
  const model=load().build(value);assert.equal(model.categoryLabel,'Motorcycle Accessories / Motorcycles & Powersports Accessories');
});

test('Page Health exposes expected and actual values row by row with actionable failure copy',()=>{
  const value=girls({detection:{health:{status:'BLOCKED',code:'sort',checks:{country:true,language:true,currency:true,category:true,products:true,sort:false}},observed:{siteCountry:'DE',language:'en',currency:'EUR',category:"Girls' Sets",sortOrder:'Recommended',cardCount:40,domReady:true}},lastError:{code:'LISTING_CONTEXT_UNHEALTHY',message:'wrong sort'}});
  const model=load().build(value),sort=model.health.rows.find(row=>row.key==='sort');
  assert.deepEqual({expected:sort.expected,actual:sort.actual,passed:sort.passed},{expected:'Top Sales',actual:'Recommended',passed:false});
  assert.equal(model.health.statusLabel,'页面尚未就绪');assert.match(model.error.action,/Top Sales/);assert.equal(model.steps.detect.status,'失败');
});

test('READY enables bind and BOUND enables capture using the same state contract',()=>{
  const ready=girls({state:'PAGE_READY',detection:{health:{status:'READY',checks:{country:true,language:true,currency:true,category:true,products:true,sort:true}},observed:{siteCountry:'DE',language:'en',currency:'EUR',category:"Girls' Sets",sortOrder:'Top Sales',cardCount:40,domReady:true}}});
  assert.equal(load().build(ready).steps.bind.enabled,true);
  const bound={...ready,state:'PAGE_BOUND',binding:{status:'BOUND',context_fingerprint:'fp'}};assert.equal(load().build(bound).steps.capture.enabled,true);
});

test('context identity is exact and different Profiles cannot share stale state',()=>{
  const api=load(),first=girls(),second=girls();second.context.campaign={...second.context.campaign,id:'girls-c2'};
  assert.equal(api.contextIdentity(first),'girls-c1\u001fgirls-sets\u001foperator-girls-sets-v1-bf7cb4caf08d');
  assert.notEqual(api.contextIdentity(first),api.contextIdentity(second));
});
