import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialActivationCoordinator } from '../../src/modules/catalog-scale/initial-activation-coordinator.mjs';

test('coordinator blocks reentry and releases Campaign lock after success and failure',()=>{
  const gate=createInitialActivationCoordinator();assert.equal(gate.isActivating('c1'),false);
  gate.run('c1',()=>{assert.equal(gate.isActivating('c1'),true);
    assert.throws(()=>gate.run('c1',()=>{}),error=>error.code==='INITIAL_POOL_ACTIVATION_IN_PROGRESS');});
  assert.equal(gate.isActivating('c1'),false);
  assert.throws(()=>gate.run('c1',()=>{throw new Error('boom');}),/boom/);
  assert.equal(gate.isActivating('c1'),false);
});
