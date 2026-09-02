import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';import vm from 'node:vm';
import {normalizeOperatorCategoryProfile} from '../../src/modules/catalog-scale/operator-category-profile.mjs';
const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../browser-extension/catalog-manual-binding.js'),'utf8');
function module(){const sandbox=vm.createContext({URL});vm.runInContext(source,sandbox);return sandbox.TemuCatalogManualBinding;}
const profile=normalizeOperatorCategoryProfile({display_name:'Pet Supplies',page_category_name:'Pet Supplies',category_aliases:['Pet Supplies','Pets'],parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],listing_url:'https://www.temu.com/de-en/pet-supplies.html'});
function evidence(overrides={}){return{profile,domEvidence:{url:'https://www.temu.com/de-en/pet-supplies.html?sort=top',siteCountry:'DE',language:'en',currency:'EUR',category:'Pets',breadcrumbs:['Home & Pet','Pet Supplies'],sortOrder:'Top Sales',cardCount:10,ready:true,...overrides},networkEvidence:{ready:false}};}

test('capture-only detection requires alias, breadcrumb and normalized listing path',()=>{
  const api=module();assert.equal(api.detectCurrentPage(evidence()).health.status,'READY');
  for(const [field,value,check] of [['category','Foreign','category'],['breadcrumbs',['Other','Pet Supplies'],'breadcrumbs'],['url','https://www.temu.com/de-en/other.html','listingPath']]){
    const result=api.detectCurrentPage(evidence({[field]:value}));assert.equal(result.health.status,'BLOCKED',field);assert.equal(result.health.checks[check],false,field);
  }
});

test('all universal Page Health failures block operator profile binding',()=>{
  const api=module();for(const overrides of [{siteCountry:'US'},{language:'de'},{currency:'USD'},{sortOrder:'Recommended'},
    {captchaBlocking:true},{searchNoResults:true},{cardCount:0,ready:false}]){
    const detection=api.detectCurrentPage(evidence(overrides));assert.equal(detection.health.status,'BLOCKED');
    assert.throws(()=>api.bindDetectedPage({detection,campaign:{id:'c1',categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version},profile,sourceId:'s1'}),error=>error.code==='PAGE_HEALTH_BLOCKED');
  }
});
