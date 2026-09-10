import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEvidenceTitle, classifyWaitingProductV2, applyWaitingClassificationV2 } from '../../src/modules/opportunity/opportunity-v2.mjs';

const base = { platform: 'temu', goodsId: '1', priceAmount: 10, salesCount: 20, rating: 4.5, reviewCount: 3, imageUrl: 'cached', currentSourceUrl: 'source', currency: 'EUR' };

test('V2 title evidence prefers clean raw card title over item picture alt text', () => {
  const title = extractEvidenceTitle({ title: 'item picture motorcycle cover', raw: { raw_card_text: 'Top pickWaterproof Motorcycle Cover, All-Season Outdoor ProtectionOpen in new tab.€10.00' } });
  assert.equal(title, 'Waterproof Motorcycle Cover, All-Season Outdoor Protection');
});

test('V2 formal classification requires image evidence and keeps sales out of the decision', () => {
  const result = classifyWaitingProductV2({ ...base, title: 'item picture motorcycle cover', raw: { raw_card_text: 'Waterproof Motorcycle CoverOpen in new tab.' } }, { imageAvailable: true });
  assert.equal(result.outcome, 'FORMALLY_RECLASSIFIED');
  assert.equal(result.evidenceAgreement, true);
  assert.equal(result.similarProductCluster, '车罩');
  assert.equal(result.classificationConfidence >= 0.95, true);
});

test('V2 unavailable image never fabricates visual evidence', () => {
  const result = classifyWaitingProductV2({ ...base, title: 'item picture motorcycle cover', raw: { raw_card_text: 'Waterproof Motorcycle CoverOpen in new tab.' } }, { imageAvailable: false });
  assert.equal(result.imageEvidence, 'unavailable');
  assert.equal(result.evidenceAgreement, false);
  assert.equal(result.outcome, 'CLUSTERED_BUT_STILL_WAITING');
  assert.equal(result.manualReviewRequired, true);
});

test('V2 conservation keeps every waiting goods_id exactly once', () => {
  const result = { items: [
    { ...base, goodsId: '1', title: '其它', productType: '其它/待细分', similarProductCluster: '未知', raw: { raw_card_text: 'Waterproof Motorcycle CoverOpen in new tab.' } },
    { ...base, goodsId: '2', title: '其它', productType: '其它/待细分', similarProductCluster: '未知', raw: { raw_card_text: 'Universal Motorcycle AccessoryOpen in new tab.' } },
  ], summary: {} };
  const applied = applyWaitingClassificationV2(result, new Map([['1', true], ['2', false]]));
  assert.equal(applied.v2.waitingBefore, 2);
  assert.equal(applied.v2.conservation, true);
  assert.equal(new Set(applied.items.map(x => x.goodsId)).size, 2);
});
