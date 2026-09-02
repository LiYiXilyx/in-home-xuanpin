import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(){const context={globalThis:{}};context.globalThis.globalThis=context.globalThis;for(const file of ['catalog-operator-view-model.js','catalog-popup-view.js'])vm.runInNewContext(fs.readFileSync(`browser-extension/${file}`,'utf8'),context);return context.globalThis;}
function snapshot(){return{context:{campaign:{id:'girls-c1',campaignType:'initial',browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE',categoryKey:'girls-sets',categoryProfileVersion:'girls-v1',nonElectronicUniqueCount:13,targetCount:null,quantityMode:'OPEN_ENDED'},profile:{category_key:'girls-sets',category_profile_version:'girls-v1',display_name:'小女孩童装 / Girls Sets',sort_order:'Top Sales'}},detection:{health:{status:'READY',checks:{country:{passed:true,expected:'DE',actual:'DE'},language:{passed:true,expected:'English',actual:'English'},currency:{passed:true,expected:'EUR',actual:'EUR'},category:{passed:true,expected:'Girls Sets',actual:'Girls Sets'},sort:{passed:true,expected:'Top Sales',actual:'Top Sales'},products:{passed:true,expected:'present',actual:'present'}}}},binding:{status:'UNBOUND'},lastResult:{audit:{acceptedGoods:3,campaignStagingDeduped:1}},lastError:null};}

test('Popup and Overlay consume the same immutable operator model without target leakage',()=>{
  const api=load(),model=api.TemuCatalogOperatorViewModel.build(snapshot()),popup=api.TemuCatalogPopupView.renderMarkup(model);
  assert.match(popup,/小女孩童装 \/ Girls Sets/);assert.match(popup,/不限数量/);assert.match(popup,/当前已采集<\/span><strong>13/);
  assert.match(popup,/页面检查/);assert.match(popup,/READY/);assert.match(popup,/UNBOUND/);
  assert.doesNotMatch(popup,/0\s*\/\s*0|2147483647|target:\s*null/i);
  assert.match(popup,/<details[^>]*id="catalog-popup-technical"(?![^>]*open)/);
});

test('Popup exposes only the three explicit Manual Bind actions',()=>{
  const api=load(),popup=api.TemuCatalogPopupView.renderMarkup(api.TemuCatalogOperatorViewModel.build(snapshot()));
  for(const id of ['detect-page','bind-page','capture-page'])assert.match(popup,new RegExp(`id="${id}"`));
  assert.doesNotMatch(popup,/自动滚动|自动翻页|自动采集|See more click/);
});

test('popup document loads the shared view model before popup wiring',()=>{
  const html=fs.readFileSync('browser-extension/popup.html','utf8');
  assert.match(html,/catalog-operator-view-model\.js[\s\S]*catalog-popup-view\.js[\s\S]*popup\.js/);
});
