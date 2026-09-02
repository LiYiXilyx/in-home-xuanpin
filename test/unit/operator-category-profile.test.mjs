import assert from 'node:assert/strict';
import test from 'node:test';

import {normalizeOperatorCategoryProfile,validateOperatorCategoryDraft} from '../../src/modules/catalog-scale/operator-category-profile.mjs';
import {validateCategoryProfile} from '../../src/modules/catalog-scale/category-profile.mjs';
import {assertTaxonomyPipelineAvailable} from '../../src/modules/catalog-scale/taxonomy-pipeline-capability.mjs';

const input=()=>({
  display_name:'Pet Supplies',page_category_name:'Pet Supplies',category_aliases:['Pet Supplies',' Pets  '],
  parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],
  listing_url:'https://www.temu.com/de-en/pet-supplies.html'
});

test('operator profile fixes market/capture semantics and generates deterministic identity',()=>{
  const first=normalizeOperatorCategoryProfile(input()),second=normalizeOperatorCategoryProfile({...input(),category_aliases:['Pets','Pet Supplies']});
  assert.equal(first.category_key,'pet-supplies');
  assert.equal(first.category_profile_version,second.category_profile_version);
  assert.equal(first.site_country,'DE');assert.equal(first.language,'en');assert.equal(first.currency,'EUR');
  assert.equal(first.sort_order,'Top Sales');assert.equal(first.capture_mode,'MANUAL_BIND_PASSIVE_CAPTURE');
  assert.equal(first.quantity_mode,'OPEN_ENDED');
  assert.deepEqual(first.taxonomy,{status:'UNCONFIGURED'});
  assert.deepEqual(first.capabilities,{raw_capture_available:true,initial_pool_available:true,classification_available:false,opportunity_available:false});
  assert.equal('business_rules' in first,false);assert.equal('taxonomy_bindings' in first,false);
  assert.deepEqual(validateCategoryProfile(first),first);
});

test('unicode-only category identity requires a Latin alias',()=>{
  const value={...input(),display_name:'宠物用品',page_category_name:'宠物用品',category_aliases:['宠物用品'],breadcrumbs:['居家','宠物用品']};
  assert.throws(()=>normalizeOperatorCategoryProfile(value),error=>error.code==='CATEGORY_PROFILE_LATIN_ALIAS_REQUIRED');
  assert.equal(normalizeOperatorCategoryProfile({...value,category_aliases:['Pet Supplies']}).category_key,'pet-supplies');
});

test('operator cannot override generated or fixed contract fields',()=>{
  assert.throws(()=>validateOperatorCategoryDraft({...input(),site_country:'US'}),error=>error.code==='CATEGORY_PROFILE_GENERATED_FIELD_FORBIDDEN');
  assert.throws(()=>validateOperatorCategoryDraft({...input(),category_key:'chosen'}),error=>error.code==='CATEGORY_PROFILE_GENERATED_FIELD_FORBIDDEN');
});

test('capture-only pipelines hard fail as explicitly unconfigured',()=>{
  const profile=normalizeOperatorCategoryProfile(input());
  for(const pipeline of ['classify','fine_classify','opportunity']){
    assert.throws(()=>assertTaxonomyPipelineAvailable(profile,pipeline),error=>error.code==='CATEGORY_TAXONOMY_UNCONFIGURED');
  }
});
