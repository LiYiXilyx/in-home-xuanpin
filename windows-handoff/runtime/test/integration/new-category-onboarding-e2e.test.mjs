import assert from 'node:assert/strict';import path from 'node:path';import test from 'node:test';
import {runNewCategoryOnboardingVerification} from '../../scripts/verify-new-category-onboarding-v1.mjs';

test('temporary-only new category onboarding completes capture, scoped exports, QA and activation',async()=>{
  const result=await runNewCategoryOnboardingVerification();
  for(const [gate,value] of Object.entries(result.gates))assert.equal(value,'PASS',gate);
  assert.equal(result.profile.category_key,'pet-supplies');assert.equal(result.preview.product_count,2);assert.equal(result.formal.product_count,2);
  assert.equal(result.production_database_writes,0);assert.equal(result.real_temu_capture_started,false);
});

test('verifier rejects caller-supplied non-temporary roots',async()=>{
  await assert.rejects(()=>runNewCategoryOnboardingVerification({root:path.resolve('data')}),error=>error.code==='VERIFIER_TEMP_ROOT_REQUIRED');
});
