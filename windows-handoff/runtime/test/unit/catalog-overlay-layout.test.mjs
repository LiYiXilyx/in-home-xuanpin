import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadOverlay(){
  const context={globalThis:{}};context.globalThis.globalThis=context.globalThis;
  vm.runInNewContext(fs.readFileSync('browser-extension/catalog-operator-overlay.js','utf8'),context);
  return context.globalThis.TemuCatalogOperatorOverlay;
}

test('expanded and collapsed layouts have one Catalog owner and one toast host',()=>{
  const api=loadOverlay();
  const model={categoryLabel:'Girls Sets',quantity:{mode:'OPEN_ENDED',currentUnique:2,lastAdded:1},task:{status:'采集中',modeLabel:'手工采集 · 不限数量'},binding:{status:'UNBOUND'},steps:{detect:{enabled:true,status:'待处理'},bind:{enabled:false,status:'待处理',disabledReason:'先检测'},capture:{enabled:false,status:'待处理',disabledReason:'先绑定'}},health:{status:'NOT_DETECTED',rows:[]},error:null,counts:{added:1,duplicates:0,failed:0},technical:{}};
  const expanded=api.renderMarkup(model,{collapsed:false,toasts:[]});
  const collapsed=api.renderMarkup(model,{collapsed:true,toasts:[]});
  assert.equal((expanded.match(/id="temu-catalog-toast-container"/g)??[]).length,1);
  assert.equal((expanded.match(/id="temu-catalog-overlay-launcher"/g)??[]).length,0);
  assert.equal((collapsed.match(/id="temu-catalog-overlay-launcher"/g)??[]).length,1);
  assert.equal((collapsed.match(/data-role="primary-panel"/g)??[]).length,0);
  assert.match(expanded,/max-height:min\(70vh,640px\)/);
  assert.match(expanded,/overflow:auto/);
});

test('toast reducer deduplicates by kind and preserves one persistent error',()=>{
  const api=loadOverlay();
  let state=api.reduceToasts([], {kind:'info',message:'第一次'});
  state=api.reduceToasts(state,{kind:'info',message:'第二次'});
  state=api.reduceToasts(state,{kind:'error',message:'失败'});
  state=api.reduceToasts(state,{kind:'error',message:'最新失败'});
  assert.equal(JSON.stringify(state.map(item=>[item.kind,item.message,item.persistent])),JSON.stringify([['info','第二次',false],['error','最新失败',true]]));
});

test('capture and review scripts do not install competing fixed controls while Catalog overlay owns the page',()=>{
  const capture=fs.readFileSync('browser-extension/catalog-capture.js','utf8');
  const review=fs.readFileSync('browser-extension/content-script.js','utf8');
  assert.doesNotMatch(capture,/if \(visibleCards\.length\) installButton\(\)/);
  assert.match(review,/isTemuProductPage\s*&&\s*!document\.getElementById\('temu-catalog-operator-overlay'\)/);
});
