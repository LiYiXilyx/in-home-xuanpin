import test from 'node:test';
import assert from 'node:assert/strict';
import { runInitialPoolSafetyVerification } from '../../scripts/verify-initial-category-pool-safety.mjs';

test('safety verifier uses temporary SQLite and reports every required Gate',async()=>{
  const result=await runInitialPoolSafetyVerification();
  assert.equal(result.productionDatabaseWrites,0);assert.equal(result.realTemuCaptureStarted,false);
  assert.equal(result.gates.INITIAL_SENTINEL_STORAGE_ONLY,'YES');
  assert.equal(result.gates.INITIAL_SENTINEL_EXPOSED_TO_UI,'NO');
  assert.equal(result.gates.INITIAL_AUTO_STOP_BY_SENTINEL,'NO');
  assert.equal(result.gates.INITIAL_QA_DEPENDS_ON_TARGET,'NO');
  assert.equal(result.gates.EXISTING_TARGET_CAMPAIGNS_UNCHANGED,'YES');
  assert.equal(result.gates.MOTORCYCLE_POOL_UNCHANGED,'YES');
  assert.equal(result.gates.SAFE_FOR_NEW_CATEGORY_INITIAL_10_ROW_DRY_RUN,'YES');
});

test('safety verifier rejects a production config environment before creating fixtures',async()=>{
  const previous=process.env.TEMU_CONFIG_PATH;
  process.env.TEMU_CONFIG_PATH='/forbidden/production-config.json';
  try {
    await assert.rejects(()=>runInitialPoolSafetyVerification(),/禁止读取正式配置/);
  } finally {
    if(previous===undefined)delete process.env.TEMU_CONFIG_PATH;
    else process.env.TEMU_CONFIG_PATH=previous;
  }
});
