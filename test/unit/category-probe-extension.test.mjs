import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('recognition action is lazy and sends only explicit passive descriptor to localhost bridge',()=>{
 const filename=new URL('../../browser-extension/category-probe-action.js',import.meta.url);
 assert.equal(fs.existsSync(filename),true);
 const requests=[];let scans=0;
 const box=vm.createContext({TemuCategoryPageDescriptor:{parseCategoryPage(){scans++;return{page_type:'CATEGORY_LISTING'};}},chrome:{runtime:{sendMessage(m,cb){requests.push(m);cb({ok:true,probe:{resolution:'NEW'}});}}}});
 vm.runInContext(fs.readFileSync(filename,'utf8'),box);assert.equal(scans,0);assert.equal(requests.length,0);
 return box.TemuCategoryProbeAction.recognize({},'https://www.temu.com/').then(p=>{assert.equal(scans,1);assert.equal(p.resolution,'NEW');assert.equal(requests[0].type,'CREATE_CATEGORY_PROBE');});
});
test('no Campaign context still mounts recognition overlay without restore or capture',async()=>{
 let mounted=0;const box=vm.createContext({document:{},chrome:{runtime:{sendMessage(m,cb){cb({ok:true,context:null});}}},TemuCatalogManualBinding:{},TemuCatalogOverlayMode:{resolveCatalogOverlayMode:()=> 'NO_CONTEXT'},TemuCatalogOperatorOverlay:{mount(){mounted++;}}});
 vm.runInContext(fs.readFileSync(new URL('../../browser-extension/catalog-manual-passive-runner.js',import.meta.url),'utf8'),box);
 await new Promise(r=>setImmediate(r));assert.equal(mounted,1);
});
