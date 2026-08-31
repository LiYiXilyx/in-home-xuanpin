import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_TARGET_STORAGE_SENTINEL,
  getCampaignQuantityPolicy,
  initialQuantityConfig
} from '../../src/modules/catalog-scale/campaign-quantity-policy.mjs';

function initialCampaign(overrides = {}) {
  return {
    campaignType: 'initial',
    storageTargetCount: INITIAL_TARGET_STORAGE_SENTINEL,
    nonElectronicUniqueCount: 10,
    config: initialQuantityConfig(),
    ...overrides
  };
}

test('Initial sentinel is storage-only and public quantities are null', () => {
  assert.deepEqual(getCampaignQuantityPolicy(initialCampaign()), {
    quantityMode: 'OPEN_ENDED', captureLimit: null, businessTarget: null,
    remaining: null, targetReached: null
  });
});

test('sentinel alone never identifies a non-Initial Campaign', () => {
  const policy = getCampaignQuantityPolicy({
    campaignType: 'refresh', targetCount: INITIAL_TARGET_STORAGE_SENTINEL,
    nonElectronicUniqueCount: 10, config: {}
  });
  assert.equal(policy.quantityMode, 'TARGETED');
  assert.equal(policy.businessTarget, INITIAL_TARGET_STORAGE_SENTINEL);
  assert.equal(policy.targetReached, false);
});

test('malformed Initial quantity config hard fails', () => {
  assert.throws(
    () => getCampaignQuantityPolicy(initialCampaign({ config: { quantityMode: 'TARGETED' } })),
    error => error.code === 'INITIAL_QUANTITY_POLICY_INVALID'
  );
});

test('targeted Campaign behavior remains numeric', () => {
  assert.deepEqual(getCampaignQuantityPolicy({
    campaignType: 'expansion', targetCount: 2145, nonElectronicUniqueCount: 2140, config: {}
  }), {
    quantityMode: 'TARGETED', captureLimit: 2145, businessTarget: 2145,
    remaining: 5, targetReached: false
  });
});
