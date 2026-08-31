import { AppError } from '../../shared/errors.mjs';

export const INITIAL_TARGET_STORAGE_SENTINEL = 2147483647;

export function initialQuantityConfig() {
  return {
    quantityMode: 'OPEN_ENDED',
    captureLimit: null,
    targetCountStorage: {
      kind: 'LEGACY_NOT_NULL_SENTINEL',
      value: INITIAL_TARGET_STORAGE_SENTINEL
    }
  };
}

export function getCampaignQuantityPolicy(campaign) {
  if (campaign?.campaignType !== 'initial') {
    const target = Number(campaign?.storageTargetCount ?? campaign?.targetCount);
    const current = Number(campaign?.nonElectronicUniqueCount ?? 0);
    if (!Number.isInteger(target) || target <= 0) {
      throw new AppError('Campaign target_count无效。', { code: 'CAMPAIGN_QUANTITY_POLICY_INVALID' });
    }
    return {
      quantityMode: 'TARGETED', captureLimit: target, businessTarget: target,
      remaining: Math.max(0, target - current), targetReached: current >= target
    };
  }

  const config = campaign.config ?? {};
  const storage = config.targetCountStorage;
  const storageTarget = Number(campaign.storageTargetCount ?? campaign.targetCount);
  if (config.quantityMode !== 'OPEN_ENDED' || config.captureLimit !== null
    || storage?.kind !== 'LEGACY_NOT_NULL_SENTINEL'
    || storage?.value !== INITIAL_TARGET_STORAGE_SENTINEL
    || storageTarget !== INITIAL_TARGET_STORAGE_SENTINEL) {
    throw new AppError('Initial数量策略无效。', {
      code: 'INITIAL_QUANTITY_POLICY_INVALID',
      details: { campaignId: campaign.id ?? null }
    });
  }
  return {
    quantityMode: 'OPEN_ENDED', captureLimit: null, businessTarget: null,
    remaining: null, targetReached: null
  };
}
