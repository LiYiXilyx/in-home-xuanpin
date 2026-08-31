import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadCategoryProfile,validateCategoryProfile,resolveTaxonomyBinding,REQUIRED_ELECTRONIC_EXCLUSION_CODES } from '../../src/modules/catalog-scale/category-profile.mjs';
import { screenCatalogElectronicRisk } from '../../src/modules/catalog-scale/electronic-screening.mjs';

const profilePath=fileURLToPath(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url));

test('motorcycle Category Profile validates the non-electronic default gate',async () => {
  const profile=await loadCategoryProfile(profilePath);
  assert.equal(profile.category_key,'motorcycle-accessories');
  assert.equal(profile.category_profile_version,'motorcycle-accessories-v1');
  assert.equal(profile.target_count,3000);
  assert.equal(profile.business_rules.default_gate,'non_electronic_unique_count');
  assert.equal(profile.business_rules.count_manual_review_as_non_electronic,false);
  for (const code of REQUIRED_ELECTRONIC_EXCLUSION_CODES) assert.ok(profile.business_rules.hard_exclusion_codes.includes(code));
});

test('Category Profile rejects incomplete electronic exclusions and unsafe manual counting',async () => {
  const profile=structuredClone(await loadCategoryProfile(profilePath));
  profile.business_rules.hard_exclusion_codes=['ELECTRONIC_PRODUCT'];
  assert.throws(() => validateCategoryProfile(profile),error => error.code==='CONFIG_INVALID' && error.details.fieldPath==='category_profile.business_rules.hard_exclusion_codes');
  const unsafe=structuredClone(await loadCategoryProfile(profilePath));
  unsafe.business_rules.count_manual_review_as_non_electronic=true;
  assert.throws(() => validateCategoryProfile(unsafe),error => error.code==='CONFIG_INVALID');
  const electronicsAllowed=structuredClone(await loadCategoryProfile(profilePath));
  electronicsAllowed.exclude_electronics=false;
  assert.throws(() => validateCategoryProfile(electronicsAllowed),error => error.code==='CONFIG_INVALID' && error.details.fieldPath==='category_profile.exclude_electronics');
});

test('rule-only electronic screening excludes hard risks and holds unknown cards for manual review',() => {
  const excluded=screenCatalogElectronicRisk({ title:'Rechargeable Bluetooth USB LED Headlight with Speaker' });
  assert.equal(excluded.decision,'exclude');
  for (const code of ['USB_PRODUCT','RECHARGEABLE_PRODUCT','BLUETOOTH_PRODUCT','AUDIO_ELECTRONIC','LIGHTING_ELECTRONIC']) assert.ok(excluded.codes.includes(code));
  assert.equal(screenCatalogElectronicRisk({ title:'Motorcycle Waterproof Tail Bag' }).decision,'passed');
  assert.equal(screenCatalogElectronicRisk({ title:'' }).decision,'manual_review_required');
});

test('new Category Profile requires explicit uniform taxonomy bindings',async () => {
  const input=structuredClone(await loadCategoryProfile(profilePath));
  input.category_key='category-b';input.category_profile_version='category-b-v1';delete input.taxonomy_bindings;
  assert.throws(() => validateCategoryProfile(input),error => error.code==='CATEGORY_PROFILE_BINDING_REQUIRED');
});

test('taxonomy binding resolver keeps real values and does not invent a taxonomy version',async () => {
  const profile=await loadCategoryProfile(profilePath);
  assert.deepEqual(resolveTaxonomyBinding(profile,'classify'),{
    taxonomyName:'week1-motorcycle-accessories',taxonomyVersion:null,ruleVersion:'week1-rule-v1',categoryScope:'motorcycle-accessories'
  });
  assert.equal(resolveTaxonomyBinding(profile,'opportunity').taxonomyVersion,'motorcycle-opportunity-v2');
  assert.throws(() => resolveTaxonomyBinding(profile,'missing'),error => error.code==='CATEGORY_PROFILE_BINDING_REQUIRED');
});
