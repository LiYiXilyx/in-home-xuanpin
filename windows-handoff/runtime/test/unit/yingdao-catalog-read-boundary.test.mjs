import assert from 'node:assert/strict';
import test from 'node:test';
import {createYingdaoApi} from '../../ui/modules/yingdao/api.js';

test('YingDao reads Catalog products only with the strict Pool Category Profile tuple',async()=>{
  const calls=[],api=createYingdaoApi({fetchImpl:async(url,options={})=>{calls.push([String(url),options.method??'GET']);return{ok:true,async json(){return{ok:true,products:[]};}};}});
  await api.readCatalogPoolProducts({poolVersionId:'pool 1',categoryKey:'motorcycle-accessories',categoryProfileVersion:'v1'});
  assert.equal(calls[0][0],'/api/catalog/pools/pool%201/products?category_key=motorcycle-accessories&category_profile_version=v1');assert.equal(calls[0][1],'GET');
  for(const input of [{},{poolVersionId:'p',categoryKey:'c'},{poolVersionId:'p',categoryProfileVersion:'v'}])await assert.rejects(()=>api.readCatalogPoolProducts(input),error=>error.code==='CATALOG_POOL_SCOPE_REQUIRED');
});

test('YingDao API exposes no Catalog mutation or fallback capability',()=>{
  const api=createYingdaoApi({fetchImpl:async()=>({ok:true,json:async()=>({})})}),keys=Object.keys(api);
  for(const forbidden of ['createCampaign','activatePool','runQa','captureBatch','latestPool','activePool','membership','claim'])assert.ok(!keys.includes(forbidden));
  const source=String(createYingdaoApi);assert.doesNotMatch(source,/\/api\/catalog\/(?:operator-campaign|batches)|method:\s*['"]POST['"][\s\S]{0,120}\/api\/catalog/);
});
