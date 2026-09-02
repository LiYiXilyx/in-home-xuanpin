import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeEnvironment,verifyStaticContracts } from '../../scripts/verify-manual-bind-overlay-ux-v1.mjs';

test('verifier rejects production config and database inputs',()=>{
  assert.throws(()=>assertSafeEnvironment({TEMU_CONFIG_PATH:'/Users/operator/temu选品/config.json'}),/PRODUCTION_INPUT_FORBIDDEN/);
  assert.throws(()=>assertSafeEnvironment({TEMU_DB_PATH:'/data/temu_research_v2.db'}),/PRODUCTION_INPUT_FORBIDDEN/);
  assert.doesNotThrow(()=>assertSafeEnvironment({NODE_ENV:'test'}));
});

test('static overlay delivery contracts are present',()=>{
  const result=verifyStaticContracts(process.cwd());
  assert.equal(result.SINGLE_PRIMARY_PANEL,true);
  assert.equal(result.MANUAL_NO_AUTO_RUNNER,true);
  assert.equal(result.OPEN_ENDED_TARGET_HIDDEN,true);
  assert.equal(result.YINGDAO_UNCHANGED,true);
});
