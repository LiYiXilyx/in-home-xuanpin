import test from 'node:test';import assert from 'node:assert/strict';
import {verifyReviewOpportunity} from '../../scripts/1688/verify-review-opportunity-v1.mjs';

test('read-only verifier reports deterministic groups, prices, bands and images',async()=>{
  const result=await verifyReviewOpportunity({baseUrl:'http://local',runId:'run',expectedGoods:2,expectedCandidates:2,fetchImpl:fakeFetch()});
  assert.equal(result.pass,true);assert.equal(result.TEMU_REVIEW_GOODS,2);assert.equal(result.SUPPLIER_REVIEW_CANDIDATES,2);
  assert.equal(result.TEMU_IMAGES_LOCAL_OK,'2/2');assert.equal(result.SUPPLIER_IMAGES_LOCAL_OK,'2/2');
  assert.equal(result.TEMU_PRICE_COVERAGE,'2/2');assert.equal(result.TEMU_RELIABLE_UNIT_PRICE_COVERAGE,'2/2');
  assert.equal(result.GROUP_COUNT,1);assert.equal(result.MULTI_ITEM_GROUP_COUNT,1);assert.equal(result.MAX_GROUP_SIZE,2);
  assert.equal(result.HIGH_COUNT,1);assert.equal(result.UNIT_REVIEW_REQUIRED_COUNT,1);
});

test('verifier blocks count and image drift instead of claiming PASS',async()=>{
  const result=await verifyReviewOpportunity({baseUrl:'http://local',runId:'run',expectedGoods:50,expectedCandidates:250,fetchImpl:fakeFetch({supplierImageStatus:404})});
  assert.equal(result.pass,false);assert.ok(result.failures.includes('GOODS_COUNT_MISMATCH'));assert.ok(result.failures.includes('CANDIDATE_COUNT_MISMATCH'));assert.ok(result.failures.includes('SUPPLIER_IMAGE_FAILURE'));
});

function fakeFetch({supplierImageStatus=200}={}) {return async url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/bootstrap'))return response({total_goods:2,goods:[{temu_goods_id:'g1'},{temu_goods_id:'g2'}]});
  if(path.includes('/images/temu/'))return response(null,200,'image/avif');
  if(path.includes('/images/supplier/'))return response(null,supplierImageStatus,'image/jpeg');
  const id=path.includes('/g2')?'g2':'g1';return response({temu_goods_id:id,temu_context:{temu_listed_price_eur:12,temu_unit_price_eur:1.2,quantity_confidence:'HIGH'},group_context:{group_key:'CLUSTER:x',item_count:2,metrics:{group_min_unit_price_eur:1.2},items:[{temu_goods_id:'g1'},{temu_goods_id:'g2'}]},candidates:[{'1688_product_id':`p-${id}`,opportunity_ratio:12,opportunity_band:id==='g1'?'HIGH':'UNIT_REVIEW_REQUIRED'}]});
  };}
function response(json,status=200,type='application/json'){return {ok:status>=200&&status<300,status,headers:{get:()=>type},json:async()=>json,arrayBuffer:async()=>new ArrayBuffer(4)};}
