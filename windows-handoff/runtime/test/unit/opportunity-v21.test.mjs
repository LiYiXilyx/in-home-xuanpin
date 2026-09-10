import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWaitingProductV21, extractEffectiveTitleV21, fastTitleMatch } from '../../src/modules/opportunity/opportunity-v21.mjs';

const base = { goodsId: 'v21-1', priceAmount: 12, salesCount: 10, rating: 4.5, reviewCount: 2, imageUrl: 'https://img.test/a.jpg', currentSourceUrl: 'https://www.temu.com/a' };

test('V2.1 uses effective raw title and skips visual review for clear product', () => {
  const item = { ...base, title: 'item picture', raw: { raw_card_text: 'Universal Motorcycle Tail Bag Open in new tab' } };
  const effective = extractEffectiveTitleV21(item);
  assert.equal(effective.title, 'Universal Motorcycle Tail Bag');
  assert.equal(effective.titleQuality, 'HIGH');
  const result = classifyWaitingProductV21(item, { imageAvailable: true });
  assert.equal(result.titleFastPath, true);
  assert.equal(result.visualReviewCandidate, false);
  assert.equal(result.visualReviewStatus, 'SKIPPED_TITLE_CLEAR');
});

test('V2.1 sends ambiguous title to visual candidate queue without inspecting the image', () => {
  const result = classifyWaitingProductV21({ ...base, title: 'Universal Motorcycle Accessory' }, { imageAvailable: true });
  assert.equal(result.titleFastPath, false);
  assert.equal(result.visualReviewCandidate, true);
  assert.equal(result.visualReviewStatus, 'PENDING');
  assert.equal(result.imageEvidence, 'not_assessed');
});

test('V2.1 fast rules cover common entities and do not use sales fields', () => {
  assert.equal(fastTitleMatch('Waterproof Motorcycle Cover'), 'cover');
  assert.equal(fastTitleMatch('Stainless Steel Bolt Kit'), 'fastener');
  assert.equal(fastTitleMatch('Motorcycle Mirror Mount'), 'mount_bracket');
  const result = classifyWaitingProductV21({ ...base, title: 'Motorcycle Tail Bag', salesCount: 999999999 }, { imageAvailable: false });
  assert.equal(result.visualReviewCandidate, false);
  assert.equal(result.imageEvidence, 'not_assessed');
});
