import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const load=async()=>{await import('../../browser-extension/category-page-descriptor.js');return globalThis.TemuCategoryPageDescriptor;};
const base='https://www.temu.com/de-en/girls-sets-o3-1088.html';
const valid=()=>({descriptor_schema_version:1,page_url:base,page_type:'CATEGORY_LISTING',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',breadcrumbs:['Home',"Kids’ Fashion","Girls’ Sets"],dom_goods_count:40,captcha_blocking:false,security_verification:false,search_no_results:false,detected_at:'2026-09-04T00:00:00Z'});
for(const fixture of JSON.parse(fs.readFileSync(new URL('../fixtures/category-pages/cases.json',import.meta.url))))test(`category fixture ${fixture.name}`,async()=>{
 const api=await load(),input={...valid(),page_url:'https://www.temu.com'+fixture.path,page_type:fixture.type,breadcrumbs:['Home',fixture.parent,fixture.name],security_verification:fixture.security??false,dom_goods_count:fixture.empty?0:40};
 if(fixture.accepted)assert.equal(api.validateDescriptor(input).breadcrumb_terminal,fixture.name);else assert.throws(()=>api.validateDescriptor(input));
});

test('tracking URL variants retain one category identity without leaking session data',async()=>{
 const api=await load();
 for(const query of ['', '?refer_page=abc&_x_sessn_id=secret#fragment','?refer_page_name=x&refer_page_id=2',"?opt_level=2&title=Girls%27%20Sets&leaf_type=bro&show_search_type=0&opt1_id=-13&filter_items=1%3A1"])assert.equal(api.canonicalizeTemuCategoryListingUrl(base+query),base);
 for(const url of ['https://evil.test/de-en/girls-sets-o3-1088.html',base+'?unknown_category=3','https://user:secret@www.temu.com/de-en/girls-sets-o3-1088.html'])assert.throws(()=>api.canonicalizeTemuCategoryListingUrl(url));
});
test('descriptor derives authoritative scope fields and strips arbitrary account fields',async()=>{
 const api=await load(),d=api.validateDescriptor({...valid(),account:'secret',category_numeric_id:'wrong'});
 assert.equal(d.category_numeric_id,'1088');assert.equal(d.breadcrumb_parent,"Kids' Fashion");assert.equal(d.breadcrumb_terminal,"Girls' Sets");assert.equal(d.account,undefined);assert.equal(d.canonical_listing_url,base);
});
test('unsupported or unhealthy and missing market proof fail closed',async()=>{
 const api=await load();
 for(const patch of [{page_type:'SEARCH_RESULTS'},{page_url:'https://www.temu.com/search_result.html?search_key=girls'},{page_url:'https://www.temu.com/g-123.html'},{page_url:'https://www.temu.com/'},{captcha_blocking:true},{security_verification:true},{search_no_results:true},{dom_goods_count:0},{site_country:'US'},{language:'de'},{currency:'USD'},{currency:null},{sort_order:'Recommended'},{breadcrumbs:[]},{breadcrumbs:['Home','']},{captcha_blocking:undefined}])assert.throws(()=>api.validateDescriptor({...valid(),...patch}));
});

test('passive DOM parser requires listing cards, breadcrumbs, selected sort and visible currency',async()=>{
 const api=await load();
 const node=text=>({textContent:text,innerText:text,hidden:false,getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null});
 const doc={documentElement:{lang:'en'},querySelectorAll(selector){
  if(selector==='[aria-label*="breadcrumb" i] li')return ['Home','Pets','Pet Beds'].map(node);
  if(selector==='button,[role="button"],[aria-selected="true"]')return [node('Sort by: Top sales')];
  if(selector==='a[href*="-g-"],a[href*="goods_id="]')return [Object.assign(node('Bed €12.00'),{href:'https://www.temu.com/bed-g-6011.html'})];
  if(selector==='[role="alert"],h1,h2')return[];
  return[];
 }};
 const d=api.parseCategoryPage(doc,'https://www.temu.com/de-en/pet-beds-o3-100.html',()=>new Date('2026-09-04T00:00:00Z'));
 assert.equal(d.breadcrumb_terminal,'Pet Beds');assert.equal(d.dom_goods_count,1);
 doc.documentElement.lang='de';assert.throws(()=>api.parseCategoryPage(doc,'https://www.temu.com/de-en/pet-beds-o3-100.html'));
});
test('security text outside headings blocks a populated category',async()=>{
 const api=await load();const n=text=>({textContent:text,innerText:text,getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null,children:[]});
 const doc={documentElement:{lang:'en'},querySelectorAll(s){if(s==='body *')return[n('Slide to verify')];if(s==='[aria-label*="breadcrumb" i] li')return[n('Pets'),n('Beds')];if(s==='button,[role="button"],[aria-selected="true"]')return[n('Sort by: Top sales')];if(s==='a[href*="-g-"],a[href*="goods_id="]')return[Object.assign(n('€10'),{href:'https://www.temu.com/x-g-123.html'})];return[];}};
 assert.throws(()=>api.parseCategoryPage(doc,'https://www.temu.com/de-en/beds-o3-100.html'),e=>e.code==='CATEGORY_PAGE_HEALTH_INVALID');
});
