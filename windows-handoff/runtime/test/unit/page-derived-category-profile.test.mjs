import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOperatorCategoryProfile} from '../../src/modules/catalog-scale/operator-category-profile.mjs';
const load=()=>import('../../src/modules/catalog-scale/page-derived-category-profile.mjs');
const descriptor=()=>({descriptor_schema_version:1,page_url:'https://www.temu.com/de-en/girls-sets-o3-1088.html',page_type:'CATEGORY_LISTING',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',breadcrumbs:['Home',"Kids' Fashion","Girls' Sets"],dom_goods_count:40,captcha_blocking:false,security_verification:false,search_no_results:false,detected_at:'2026-09-04T00:00:00Z'});
const girls=()=>normalizeOperatorCategoryProfile({display_name:'小女孩童装',page_category_name:"Girls' Sets",category_aliases:["Girls' Sets"],parent_category:"Kids' Fashion",breadcrumbs:['Home',"Kids' Fashion","Girls' Sets"],listing_url:descriptor().page_url});
test('manual Girls identity reused unchanged for tracking URLs; incompatible profile blocks',async()=>{
 const {resolvePageDerivedCategory:resolve}=await load(),p=girls();
 assert.deepEqual(resolve({...descriptor(),page_url:descriptor().page_url+'?refer_page=x'},[p]).profile,p);
 assert.equal(resolve(descriptor(),[p,{...p,category_profile_version:'other'}]).code,'CATEGORY_PROFILE_AMBIGUOUS');
 assert.equal(resolve(descriptor(),[{...p,currency:'USD'}]).code,'CATEGORY_PROFILE_CONFLICT');
});
test('new profile deterministic with no taxonomy fallback; different canonical name collision disambiguates',async()=>{
 const {resolvePageDerivedCategory:resolve}=await load();
 const a=resolve(descriptor(),[]);assert.equal(a.resolution,'NEW');assert.equal(a.profile.category_key,'girls-sets');
 const b=resolve({...descriptor(),detected_at:'2026-09-05T00:00:00Z'},[]);assert.equal(a.profile.category_profile_version,b.profile.category_profile_version);
 const old={...girls(),listing_url:'https://www.temu.com/de-en/girls-sets-o3-9999.html'};
 const c=resolve(descriptor(),[old]);assert.equal(c.resolution,'NEW');assert.equal(c.profile.category_key,'girls-sets-1088');
 assert.equal(c.profile.taxonomy.status,'UNCONFIGURED');assert.equal(c.profile.capabilities.classification_available,false);
});
