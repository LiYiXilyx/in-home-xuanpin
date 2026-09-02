import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');

test('overlay mode is selected only from the explicit Campaign context',()=>{
  const sandbox=vm.createContext({console});
  vm.runInContext(fs.readFileSync(path.join(root,'browser-extension/catalog-overlay-mode.js'),'utf8'),sandbox);
  const resolve=sandbox.TemuCatalogOverlayMode.resolveCatalogOverlayMode;
  assert.equal(resolve(null),'NO_CONTEXT');
  assert.equal(resolve({campaign:{browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE'}}),'MANUAL_BIND');
  assert.equal(resolve({campaign:{browserControlMode:'MANUAL_NAVIGATION_PASSIVE_CAPTURE'}}),'MANUAL_BIND');
  assert.equal(resolve({campaign:{browserControlMode:'FULL_REFRESH_EXTENSION_AUTO'}}),'LEGACY_AUTO_RUNNER');
  assert.equal(resolve({campaign:{browserControlMode:'UNKNOWN'}}),'BLOCKED');
  assert.equal(resolve({campaign:{targetCount:2147483647}}),'BLOCKED','sentinel cannot identify Initial or mode');
});

test('Manual Bind context mounts no legacy Auto Runner DOM and starts no legacy polling',async()=>{
  const created=[],timers=[],document=fakeDocument(created),context={campaign:{browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE'}};
  const sandbox=vm.createContext({console,Date,URL,document,location:{pathname:'/de-en/girls-sets.html',href:'https://www.temu.com/de-en/girls-sets.html'},
    setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},
    chrome:{runtime:{lastError:null,sendMessage(_message,callback){callback({ok:true,context});}}}});
  vm.runInContext(fs.readFileSync(path.join(root,'browser-extension/catalog-overlay-mode.js'),'utf8'),sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'browser-extension/catalog-auto-runner.js'),'utf8'),sandbox);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.filter(row=>row.id==='temu-catalog-auto-runner').length,0);
  assert.equal(created.filter(row=>row.id==='temu-catalog-auto-runner-launcher').length,0);
  assert.equal(timers.length,0);
});

function fakeDocument(created){
  const byId=new Map();
  const make=tag=>{const node={tagName:tag.toUpperCase(),style:{},dataset:{},children:[],append(...rows){this.children.push(...rows);},appendChild(row){this.children.push(row);},addEventListener(){},setAttribute(){},querySelectorAll(){return[];},scrollIntoView(){},click(){}};
    Object.defineProperty(node,'id',{get(){return this._id??'';},set(value){this._id=value;byId.set(value,this);created.push(this);}});return node;};
  return{body:{innerText:''},documentElement:{append(...rows){for(const row of rows)created.push(row);}},scrollingElement:null,createElement:make,getElementById:id=>byId.get(id)??null,querySelector:()=>null,querySelectorAll:()=>[]};
}
