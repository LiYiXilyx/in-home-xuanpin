import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentFingerprint,isValidIsoDate,parseReviewCard,verifyProductIdentity } from '../../src/modules/reviews/review-parser.mjs';
import { mapCaptureFailure,summarizeCoverage } from '../../src/modules/reviews/review-service.mjs';
import { classifyDetailAvailability } from '../../src/jobs/review-job-runner.mjs';

test('review parser preserves traceability and stable fallback dedupe fields',() => {
  const parsed=parseReviewCard({ dateText:'August 20, 2026',ratingText:'5 out of 5 stars',contentText:'Works very well',sku:'Black',country:'Germany',imageUrls:['https://img.test/a.jpg'],rawText:'raw' },
    { productId:7,goodsId:'123',sourceUrl:'https://www.temu.com/goods.html?goods_id=123',capturedAt:'2026-08-22T00:00:00.000Z',now:new Date('2026-08-22T00:00:00Z') });
  assert.equal(parsed.valid,true);assert.equal(parsed.review.reviewId,null);assert.equal(parsed.review.reviewDate,'2026-08-20');
  assert.equal(parsed.review.rating,5);assert.equal(parsed.review.hasImage,true);assert.match(parsed.review.dedupeKey,/^fp:/);
  assert.equal(parsed.review.contentFingerprint,createContentFingerprint('  WORKS very well '));
});

test('invalid dates, ratings and source goods id are rejected',() => {
  const parsed=parseReviewCard({ dateText:'not a date',ratingText:'9 stars',contentText:'x' },{ productId:1,goodsId:'1',sourceUrl:'https://www.temu.com/goods.html?goods_id=2' });
  assert.equal(parsed.valid,false);assert.ok(parsed.errors.includes('INVALID_REVIEW_DATE'));assert.ok(parsed.errors.includes('INVALID_RATING'));assert.ok(parsed.errors.includes('SOURCE_GOODS_ID_MISMATCH'));
});

test('goods id verification and ISO date validation are strict',() => {
  assert.equal(verifyProductIdentity({ expectedGoodsId:'123',currentUrl:'https://www.temu.com/goods.html?goods_id=123' }).valid,true);
  assert.equal(verifyProductIdentity({ expectedGoodsId:'123',currentUrl:'https://www.temu.com/goods.html?goods_id=999' }).valid,false);
  assert.equal(isValidIsoDate('2026-02-28'),true);assert.equal(isValidIsoDate('2026-02-30'),false);
});

test('detail availability distinguishes a real product page from stale listing cards',() => {
  assert.equal(classifyDetailAvailability('This item is sold out. Check out similar items.'),'unavailable');
  assert.equal(classifyDetailAvailability('Customer reviews\nAdd to cart'),'unknown');
  assert.equal(classifyDetailAvailability('Customer reviews',{ purchaseAction:true }),'available');
  assert.equal(classifyDetailAvailability('Temu navigation only'),'unknown');
});

test('capture failures preserve partial data and block CAPTCHA without bypass',() => {
  assert.deepEqual(mapCaptureFailure({ code:'CAPTCHA' },{ reviewsCaptured:0 }),{ taskStatus:'blocked',crawlCompleteness:'blocked',stopReason:'CAPTCHA',retriable:true });
  const network=mapCaptureFailure({ code:'NETWORK_ERROR',retriable:true },{ reviewsCaptured:4 });
  assert.equal(network.taskStatus,'completed_partial');assert.equal(network.crawlCompleteness,'partial');
});

test('coverage summary separates complete, partial, failed and no-review',() => {
  const summary=summarizeCoverage([{ crawlCompleteness:'complete',taskStatus:'completed',reviewsCaptured:5,pagesScanned:2 },{ crawlCompleteness:'partial',taskStatus:'completed_partial',reviewsCaptured:2,pagesScanned:1 },{ crawlCompleteness:'no_review',taskStatus:'no_review',reviewsCaptured:0,pagesScanned:1 }]);
  assert.equal(summary.byCompleteness.complete,1);assert.equal(summary.byCompleteness.partial,1);assert.equal(summary.byCompleteness.no_review,1);assert.equal(summary.reviewsCaptured,7);
});
