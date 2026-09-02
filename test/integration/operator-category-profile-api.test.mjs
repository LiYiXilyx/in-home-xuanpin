import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createOperationsServer} from '../../src/server/index.mjs';

const draft=()=>({display_name:'Pet Supplies',page_category_name:'Pet Supplies',category_aliases:['Pet Supplies'],
  parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],listing_url:'https://www.temu.com/de-en/pet-supplies.html'});

test('validate is zero-write and register is immediately visible and idempotent',async t=>{
  const fixture=await serverFixture(t),{get,post,operatorDirectory,app}=fixture;
  const beforeDb=dbFingerprint(app.db);assert.equal(fs.existsSync(operatorDirectory),false);
  let response=await post('/api/catalog/operator/category-profiles/validate',draft());let body=await response.json();
  assert.equal(response.status,200);assert.equal(body.profile.category_key,'pet-supplies');
  assert.equal(fs.existsSync(operatorDirectory),false);assert.deepEqual(dbFingerprint(app.db),beforeDb);

  response=await post('/api/catalog/operator/category-profiles',{request_id:'profile-request-1',...draft()});body=await response.json();
  assert.equal(response.status,201);assert.equal(body.idempotent_replay,false);const version=body.profile.category_profile_version;
  response=await get('/api/catalog/operator/profiles');body=await response.json();
  assert.equal(body.profiles.some(row=>row.category_key==='pet-supplies'&&row.category_profile_version===version),true);

  response=await post('/api/catalog/operator/category-profiles',{request_id:'profile-request-1',...draft()});body=await response.json();
  assert.equal(response.status,200);assert.equal(body.idempotent_replay,true);
  response=await post('/api/catalog/operator/category-profiles',{request_id:'profile-request-1',...draft(),display_name:'Changed'});body=await response.json();
  assert.equal(response.status,409);assert.equal(body.error.code,'CATEGORY_PROFILE_IDEMPOTENCY_CONFLICT');
});

test('profile API rejects generated overrides, malformed body and unsupported method',async t=>{
  const {post,request,operatorDirectory}=await serverFixture(t);
  let response=await post('/api/catalog/operator/category-profiles/validate',{...draft(),category_key:'unsafe'});let body=await response.json();
  assert.equal(response.status,400);assert.equal(body.error.code,'CATEGORY_PROFILE_GENERATED_FIELD_FORBIDDEN');
  response=await request('/api/catalog/operator/category-profiles/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});body=await response.json();
  assert.equal(response.status,400);assert.equal(body.error.code,'INVALID_JSON');
  response=await request('/api/catalog/operator/category-profiles',{method:'GET'});assert.equal(response.status,404);
  assert.equal(fs.existsSync(operatorDirectory),false);
});

async function serverFixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'operator-profile-api-'));
  const builtInDirectory=path.join(directory,'categories'),operatorDirectory=path.join(directory,'data/operator-category-profiles');fs.mkdirSync(builtInDirectory);
  const config={configPath:path.join(directory,'config.json'),app:{environment:'development',databasePath:path.join(directory,'temu.db')},
    browser:{mode:'external_cdp',profileDir:path.join(directory,'browser'),debugPort:9237,heartbeatTimeoutMs:30_000},
    catalog:{siteCountry:'德国',language:'en',currency:'EUR',jobs:[]},reviews:{},
    export:{outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images')}};
  const app=await createOperationsServer({config,categoryProfileDirectory:builtInDirectory,operatorProfileDirectory:operatorDirectory,
    sourcingDatabasePath:path.join(directory,'sourcing.db'),runProcess:()=>{},openTarget:async()=>{},logError:()=>{},
    browserDependencies:{ready:async()=>true,openSession:async()=>({context:{}}),connectSession:async()=>({context:{}}),currentPage:async()=>({}),inspectPage:async()=>({status:'READY',code:'READY',checks:{}})}});
  const address=await app.listen({port:0});t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:20});});
  const request=(route,options={})=>fetch(`${address.url}${route}`,options);
  const get=route=>request(route);const post=(route,payload)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return{directory,operatorDirectory,app,get,post,request};
}
function dbFingerprint(db){return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count]));}
