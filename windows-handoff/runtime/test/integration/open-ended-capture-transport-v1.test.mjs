import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {runOpenEndedCaptureTransportVerification} from '../../scripts/verify-open-ended-capture-transport-v1.mjs';

test('temporary Girls Initial verifies open-ended batches, replay, incremental capture and isolation',async()=>{
  const result=await runOpenEndedCaptureTransportVerification();
  for(const [gate,value] of Object.entries(result.gates))assert.equal(value,'PASS',gate);
  assert.equal(result.production_database_writes,0);
  assert.equal(result.real_temu_capture_started,false);
});

test('verifier refuses a non-temporary caller root',async()=>{
  await assert.rejects(()=>runOpenEndedCaptureTransportVerification({root:path.resolve('data')}),error=>error.code==='VERIFIER_TEMP_ROOT_REQUIRED');
});
