import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReviewActivity,classifyProductStage,stageLabel } from '../../src/modules/analysis/growth-calculator.mjs';

test('review windows use inclusive 7-day and 30-day UTC boundaries',() => {
  const activity=calculateReviewActivity(['2026-08-24','2026-08-18','2026-08-17','2026-07-26','2026-07-25','invalid'],{ asOfDate:'2026-08-24' });
  assert.deepEqual(activity,{ firstReviewDate:'2026-07-25',recent7dReviews:2,recent30dReviews:4,prior23dReviews:2,reviewVelocity:0.2857,priorReviewVelocity:0.087,velocityRatio:3.2839 });
});

test('lifecycle stages are deterministic and evidence based',() => {
  assert.equal(classifyProductStage(activity(2,8,6,0.2857,0.2609,1.095),{ snapshotReviewCount:20,coverageStatus:'complete' }).productStage,'new');
  assert.equal(classifyProductStage(activity(4,8,4,0.5714,0.1739,3.2858),{ snapshotReviewCount:500,coverageStatus:'complete' }).productStage,'growth');
  assert.equal(classifyProductStage(activity(1,11,10,0.1429,0.4348,0.3286),{ snapshotReviewCount:500,coverageStatus:'complete' }).productStage,'decline');
  assert.equal(classifyProductStage(activity(2,4,2,0.2857,0.087,3.28),{ snapshotReviewCount:500,coverageStatus:'complete' }).productStage,'mature');
});

test('missing or unfinished coverage remains data insufficient instead of fake decline',() => {
  const result=classifyProductStage({ ...activity(0,0,0,0,0,null),firstReviewDate:null },{ snapshotReviewCount:100,coverageStatus:null });
  assert.equal(result.productStage,null);assert.equal(result.dataStatus,'insufficient');assert.equal(stageLabel(result.productStage),'数据不足');
});

function activity(recent7dReviews,recent30dReviews,prior23dReviews,reviewVelocity,priorReviewVelocity,velocityRatio) {
  return { firstReviewDate:'2026-08-01',recent7dReviews,recent30dReviews,prior23dReviews,reviewVelocity,priorReviewVelocity,velocityRatio };
}
