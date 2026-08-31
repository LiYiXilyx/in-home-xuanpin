import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreatePayload,calculateTarget,createRequestIdentity,operatorErrorMessage } from '../../ui/operator-campaign.js';

test('UI computes display target but omits target and Profile body from create payload',()=>{
  const profile={category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',active_pool_count:2135};
  assert.equal(calculateTarget(profile,10),2145);
  assert.deepEqual(buildCreatePayload({profile,requestedNewCount:10,campaignName:'Manual 10',requestId:'request-1'}),{
    category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',
    requested_new_count:10,campaign_name:'Manual 10',request_id:'request-1'
  });
  assert.equal(calculateTarget(profile,0),null);
  assert.equal(calculateTarget(null,10),null);
});

test('claim conflict message tells operator to stop without repair actions',()=>{
  const message=operatorErrorMessage({code:'CATALOG_RPA_CLAIM_CONFLICT',message:'conflict'});
  assert.match(message,/停止/);
  assert.doesNotMatch(message,/自动取消|自动恢复|删除/);
});

test('request identity is explicit and validation rejects malformed create input',()=>{
  assert.equal(createRequestIdentity({randomUUID:()=> 'fixed-request-id'}),'fixed-request-id');
  const profile={category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',active_pool_count:1};
  assert.throws(()=>buildCreatePayload({profile,requestedNewCount:1.5,campaignName:'Task',requestId:'id'}),/正整数/);
  assert.throws(()=>buildCreatePayload({profile,requestedNewCount:1,campaignName:'',requestId:'id'}),/任务名称/);
});
