import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import test from 'node:test';
import {createOperationsServer} from '../../src/server/index.mjs';

test('registered capture-only profile creates exact OPEN_ENDED Initial context',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-category-initial-')),categories=path.join(directory,'categories');fs.mkdirSync(categories);
  const config={configPath:path.join(directory,'config.json'),app:{environment:'development',databasePath:path.join(directory,'temu.db')},
    browser:{mode:'external_cdp',profileDir:path.join(directory,'browser'),debugPort:9237,heartbeatTimeoutMs:30_000},catalog:{siteCountry:'德国',language:'en',currency:'EUR',jobs:[]},reviews:{},export:{outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images')}};
  const app=await createOperationsServer({config,categoryProfileDirectory:categories,operatorProfileDirectory:path.join(directory,'data/profiles'),sourcingDatabasePath:path.join(directory,'sourcing.db'),runProcess:()=>{},openTarget:async()=>{},logError:()=>{},browserDependencies:{ready:async()=>true,openSession:async()=>({context:{}}),connectSession:async()=>({context:{}}),currentPage:async()=>({}),inspectPage:async()=>({status:'READY',code:'READY',checks:{}})}});
  const address=await app.listen({port:0});t.after(async()=>{await app.close();fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:20});});
  const post=(route,body)=>fetch(`${address.url}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const draft={display_name:'Pet Supplies',page_category_name:'Pet Supplies',category_aliases:['Pet Supplies'],parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],listing_url:'https://www.temu.com/de-en/pet-supplies.html'};
  let response=await post('/api/catalog/operator/category-profiles',{request_id:'profile-r1',...draft}),body=await response.json();assert.equal(response.status,201);const profile=body.profile;
  response=await post('/api/catalog/operator/initial-campaigns',{category_key:profile.category_key,category_profile_version:profile.category_profile_version,campaign_name:'Pet Initial',request_id:'campaign-r1'});body=await response.json();
  assert.equal(response.status,201);assert.deepEqual({target:body.result.target_count,remaining:body.result.remaining,reached:body.result.target_reached},
    {target:null,remaining:null,reached:null});assert.equal(body.result.current_unique,0);assert.equal(body.result.binding_status,'UNBOUND');
  const stored=app.db.prepare('SELECT campaign_type,target_count,config_json FROM catalog_campaigns WHERE id=?').get(body.result.campaign_id);
  assert.equal(stored.campaign_type,'initial');assert.equal(stored.target_count,2147483647);assert.equal(JSON.parse(stored.config_json).quantityMode,'OPEN_ENDED');
});
