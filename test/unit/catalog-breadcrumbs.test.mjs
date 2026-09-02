import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'browser-extension/catalog-breadcrumbs.js'),'utf8');
function api(){const sandbox=vm.createContext({console});vm.runInContext(source,sandbox);return sandbox.TemuCatalogBreadcrumbs;}
function node(text,{tagName='A',hidden=false}={}){return{textContent:text,innerText:text,tagName,hidden,getAttribute:name=>name==='aria-hidden'&&hidden?'true':null,getClientRects:()=>[{}]};}
function documentWith({items=[],jsonLd=[]}={}){const list={querySelectorAll:selector=>selector===':scope > li'?items.map(text=>({hidden:false,getAttribute:()=>null,getClientRects:()=>[{}],querySelector:()=>node(text)})):[]};return{querySelectorAll(selector){if(selector==='nav[aria-label*="breadcrumb" i],[aria-label*="breadcrumb" i],nav > ol')return items.length?[list]:[];if(selector==='script[type="application/ld+json"]')return jsonLd.map(value=>({textContent:JSON.stringify(value)}));return[];}};}

test('extracts visible nav ordered crumbs without separators or empty nodes',()=>{
  assert.deepEqual(Array.from(api().extractTemuBreadcrumbs(documentWith({items:[' Home ','›',"Kids'  Fashion","Girls’ Sets",'']})).breadcrumbs),['Home',"Kids' Fashion","Girls' Sets"]);
});

test('uses only validated BreadcrumbList JSON-LD as auxiliary evidence',()=>{
  const valid={'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home'},{'@type':'ListItem',position:2,name:"Kids' Fashion"},{'@type':'ListItem',position:3,name:"Girls' Sets"}]};
  assert.deepEqual(Array.from(api().extractTemuBreadcrumbs(documentWith({jsonLd:[valid]})).breadcrumbs),['Home',"Kids' Fashion","Girls' Sets"]);
  assert.equal(api().extractTemuBreadcrumbs(documentWith({jsonLd:[{...valid,itemListElement:valid.itemListElement.map(row=>({...row,position:1}))}]})).breadcrumbs.length,0);
});

test('matches a complete expected breadcrumb suffix with exact normalized text',()=>{
  const {matchesBreadcrumbSuffix}=api();
  assert.equal(matchesBreadcrumbSuffix(['Home',"Kids' Fashion","Girls’ Sets"],["Kids' Fashion","Girls' Sets"]),true);
  assert.equal(matchesBreadcrumbSuffix(['Home',"Kids' Fashion","Girls' Sets"],['Home',"Kids' Fashion","Girls' Sets"]),true);
  assert.equal(matchesBreadcrumbSuffix(['Home',"Girls' Sets"],["Kids' Fashion","Girls' Sets"]),false);
  assert.equal(matchesBreadcrumbSuffix(['Home',"Kids' Fashion","Boys' Sets"],["Kids' Fashion","Girls' Sets"]),false);
  assert.equal(matchesBreadcrumbSuffix(['Home',"Kids' Fashion",'Girls'],["Kids' Fashion","Girls' Sets"]),false);
  assert.equal(matchesBreadcrumbSuffix(['Home'],[]),false);
  assert.equal(matchesBreadcrumbSuffix(["Girls&#39; Sets"],["Girls' Sets"]),true);
});
