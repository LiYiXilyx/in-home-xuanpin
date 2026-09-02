import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCategoryProfileRegistry } from '../../src/modules/catalog-scale/category-profile-registry.mjs';
import { normalizeOperatorCategoryProfile } from '../../src/modules/catalog-scale/operator-category-profile.mjs';

const committedProfile=JSON.parse(fs.readFileSync(new URL('../../config/categories/motorcycle-accessories.json',import.meta.url),'utf8'));

test('registry discovers valid profiles and resolves only exact key plus version',async t => {
  const directory=temporaryProfiles(t);
  writeProfile(directory,'motorcycle.json',committedProfile);
  const registry=createCategoryProfileRegistry({ directory });

  const listed=await registry.list();
  assert.deepEqual(listed.profiles.map(profile=>[profile.category_key,profile.category_profile_version]),[
    ['motorcycle-accessories','motorcycle-accessories-v1']
  ]);
  assert.deepEqual(listed.invalid,[]);
  const resolved=await registry.resolve({ categoryKey:'motorcycle-accessories',categoryProfileVersion:'motorcycle-accessories-v1' });
  assert.equal(resolved.display_name,'Motorcycle Accessories');
  await assert.rejects(
    ()=>registry.resolve({ categoryKey:'motorcycle-accessories',categoryProfileVersion:'wrong-v2' }),
    error=>error.code==='CATEGORY_PROFILE_VERSION_MISMATCH'
  );
  await assert.rejects(
    ()=>registry.resolve({ categoryKey:'pet-supplies',categoryProfileVersion:'pet-v1' }),
    error=>error.code==='CATEGORY_PROFILE_NOT_FOUND'
  );
});

test('registry reports invalid files without making them selectable',async t => {
  const directory=temporaryProfiles(t);
  writeProfile(directory,'motorcycle.json',committedProfile);
  writeProfile(directory,'invalid.json',{ category_key:'invalid' });

  const registry=createCategoryProfileRegistry({ directory });
  const listed=await registry.list();
  assert.equal(listed.profiles.length,1);
  assert.deepEqual(listed.invalid.map(item=>item.source_name),['invalid.json']);
  await assert.rejects(
    ()=>registry.resolve({ categoryKey:'invalid',categoryProfileVersion:'invalid-v1' }),
    error=>error.code==='CATEGORY_PROFILE_NOT_FOUND'
  );
});

test('duplicate category key and profile version hard fails the registry',async t => {
  const directory=temporaryProfiles(t);
  writeProfile(directory,'a.json',committedProfile);
  writeProfile(directory,'b.json',committedProfile);

  await assert.rejects(
    ()=>createCategoryProfileRegistry({ directory }).list(),
    error=>error.code==='CATEGORY_PROFILE_DUPLICATE'
  );
});

test('registry reloads built-in and operator sources with origin metadata',async t=>{
  const builtInDirectory=temporaryProfiles(t),operatorDirectory=temporaryProfiles(t);
  writeProfile(builtInDirectory,'motorcycle.json',committedProfile);
  const registry=createCategoryProfileRegistry({builtInDirectory,operatorDirectory});
  let listed=await registry.list();
  assert.equal(listed.profiles[0].profile_origin,'BUILT_IN');
  const operator={profile_schema_version:2,profile_origin:'OPERATOR_MANAGED',profile_kind:'CAPTURE_ONLY',category_key:'pet-supplies',
    category_profile_version:'operator-pet-supplies-v1-123456789abc',display_name:'Pet Supplies',page_category_name:'Pet Supplies',
    category_aliases:['Pet Supplies'],parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],
    listing_url:'https://www.temu.com/de-en/pet-supplies.html',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',
    capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',quantity_mode:'OPEN_ENDED',taxonomy:{status:'UNCONFIGURED'},
    capabilities:{raw_capture_available:true,initial_pool_available:true,classification_available:false,opportunity_available:false}};
  writeProfile(operatorDirectory,'pet.json',operator);
  listed=await registry.list();
  assert.deepEqual(listed.profiles.map(row=>[row.category_key,row.profile_origin]),[['motorcycle-accessories','BUILT_IN'],['pet-supplies','OPERATOR_MANAGED']]);
  assert.equal((await registry.resolve({categoryKey:'pet-supplies',categoryProfileVersion:operator.category_profile_version})).profile_kind,'CAPTURE_ONLY');
});

test('cross-source duplicate identity hard fails without fallback',async t=>{
  const builtInDirectory=temporaryProfiles(t),operatorDirectory=temporaryProfiles(t);
  const operator=normalizeOperatorCategoryProfile({display_name:'Pet Supplies',page_category_name:'Pet Supplies',category_aliases:['Pet Supplies'],
    parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],listing_url:'https://www.temu.com/de-en/pet-supplies.html'});
  writeProfile(builtInDirectory,'a.json',committedProfile);writeProfile(operatorDirectory,'b.json',{
    ...operator,category_key:committedProfile.category_key,category_profile_version:committedProfile.category_profile_version
  });
  await assert.rejects(()=>createCategoryProfileRegistry({builtInDirectory,operatorDirectory}).list(),error=>error.code==='CATEGORY_PROFILE_DUPLICATE');
});

function temporaryProfiles(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-category-profiles-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return directory;
}

function writeProfile(directory,name,value) {
  fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2));
}
