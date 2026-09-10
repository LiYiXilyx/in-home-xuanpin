import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createOperatorCategoryProfileStore} from '../../src/modules/catalog-scale/operator-category-profile-store.mjs';

test('store exclusive identity boundary rejects concurrent independent instance without partial writes',async t=>{
 const root=tempRoot(t),a=createStore(root,{validateInput:()=>fixtureProfile()}),b=createStore(root,{validateInput:()=>fixtureProfile()});
 let entered,release;const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const first=a.withRegistrationLock(async register=>{entered();await hold;return register({requestId:'first'});});
 await ready;
 await assert.rejects(()=>b.register({requestId:'second'}),e=>e.code==='CATEGORY_PROFILE_REGISTRATION_IN_PROGRESS');
 release();await first;assert.equal(profileFiles(root).length,1);
});

test('advanced registration cannot write a parallel version of the same listing identity',async t=>{
 const root=tempRoot(t);let current={...fixtureProfile(),listing_url:'https://www.temu.com/de-en/pets-o3-100.html'};
 const store=createStore(root,{validateInput:()=>current});await store.register({requestId:'one'});
 current={...current,category_profile_version:'operator-pet-supplies-v1-abcdefabcdef'};
 await assert.rejects(()=>store.register({requestId:'two'}),e=>e.code==='CATEGORY_PROFILE_CONFLICT');
 assert.equal(profileFiles(root).length,1);
});

test('register writes canonical profile atomically and same request replays',async t=>{
  const root=tempRoot(t),profile=fixtureProfile();
  const store=createStore(root,{validateInput:()=>profile});
  const first=await store.register({requestId:'request-1',display_name:'Pet Supplies'});
  assert.equal(first.idempotentReplay,false);
  assert.equal(first.profile.category_key,'pet-supplies');
  assert.match(first.filename,/^pet-supplies--operator-pet-supplies-v1-[a-f0-9]{12}\.json$/);
  const filePath=path.join(root,first.filename),bytes=fs.readFileSync(filePath,'utf8');
  assert.equal(bytes,`${JSON.stringify(profile,null,2)}\n`);
  assert.deepEqual(fs.readdirSync(root).filter(name=>name.includes('.tmp-')),[]);

  const replay=await store.register({requestId:'request-1',display_name:'Pet Supplies'});
  assert.equal(replay.idempotentReplay,true);
  assert.equal(replay.filename,first.filename);
  assert.equal(fs.readdirSync(root).filter(name=>name.endsWith('.json')&&!name.startsWith('.request-')).length,1);
});

test('validate performs zero filesystem writes',async t=>{
  const parent=tempRoot(t),root=path.join(parent,'profiles'),profile=fixtureProfile();
  const store=createStore(root,{validateInput:()=>profile});
  const result=await store.validate({display_name:'Pet Supplies'});
  assert.equal(result.category_key,'pet-supplies');
  assert.equal(fs.existsSync(root),false);
});

test('same request with changed normalized input hard fails without a second profile',async t=>{
  const root=tempRoot(t);let current=fixtureProfile();
  const store=createStore(root,{validateInput:()=>current});
  await store.register({requestId:'request-1',display_name:'Pet Supplies'});
  current={...fixtureProfile(),display_name:'Different Pet Supplies'};
  await assert.rejects(()=>store.register({requestId:'request-1',display_name:'Different'}),error=>error.code==='CATEGORY_PROFILE_IDEMPOTENCY_CONFLICT');
  assert.equal(profileFiles(root).length,1);
});

test('built-in and existing operator identities cannot be overwritten',async t=>{
  const root=tempRoot(t),profile=fixtureProfile();
  const builtInRegistry={async list(){return{profiles:[profile]};}};
  const builtIn=createStore(root,{validateInput:()=>profile,builtInRegistry});
  await assert.rejects(()=>builtIn.register({requestId:'request-1'}),error=>error.code==='CATEGORY_PROFILE_BUILT_IN_CONFLICT');
  assert.equal(fs.readdirSync(root).length,0);

  const store=createStore(root,{validateInput:()=>profile});
  await store.register({requestId:'request-1'});
  await assert.rejects(()=>store.register({requestId:'request-2'}),error=>error.code==='CATEGORY_PROFILE_ALREADY_EXISTS');
  assert.equal(profileFiles(root).length,1);
});

test('unsafe generated identity and symlink roots hard fail without writes',async t=>{
  const root=tempRoot(t),outside=tempRoot(t);
  const unsafe=createStore(root,{validateInput:()=>({...fixtureProfile(),category_key:'../escape'})});
  await assert.rejects(()=>unsafe.register({requestId:'request-1'}),error=>error.code==='CATEGORY_PROFILE_STORE_UNSAFE');
  assert.equal(fs.readdirSync(outside).length,0);

  const link=path.join(path.dirname(root),'operator-link');
  fs.symlinkSync(outside,link,'dir');t.after(()=>fs.rmSync(link,{force:true}));
  const linked=createStore(link,{validateInput:()=>fixtureProfile()});
  await assert.rejects(()=>linked.register({requestId:'request-2'}),error=>error.code==='CATEGORY_PROFILE_STORE_UNSAFE');
  assert.equal(fs.readdirSync(outside).length,0);
});

function createStore(root,{validateInput,builtInRegistry={async list(){return{profiles:[]};}}}){
  return createOperatorCategoryProfileStore({root,builtInRegistry,validateInput});
}
function fixtureProfile(){return{
  profile_schema_version:2,profile_origin:'OPERATOR_MANAGED',profile_kind:'CAPTURE_ONLY',
  category_key:'pet-supplies',category_profile_version:'operator-pet-supplies-v1-123456789abc',display_name:'Pet Supplies',
  site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',quantity_mode:'OPEN_ENDED',capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',
  taxonomy:{status:'UNCONFIGURED'},capabilities:{raw_capture_available:true,initial_pool_available:true,classification_available:false,opportunity_available:false}
};}
function tempRoot(t){const value=fs.mkdtempSync(path.join(os.tmpdir(),'operator-profile-store-'));t.after(()=>fs.rmSync(value,{recursive:true,force:true}));return value;}
function profileFiles(root){return fs.readdirSync(root).filter(name=>name.endsWith('.json')&&!name.startsWith('.request-'));}
