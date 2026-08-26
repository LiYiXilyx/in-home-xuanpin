import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY9_8_FAMILIES,selectReviewGateItems } from '../../src/modules/reviews/review-sample-gate.mjs';

test('Day9.8 R1 uses the frozen sample and takes exactly one ranked item per Top 5 family',() => {
  const items=DAY9_8_FAMILIES.flatMap((family,familyIndex) => Array.from({ length:10 },(_,offset) => ({
    priorityRank:offset*5+familyIndex+1,goodsId:String(601000000000000+familyIndex*10+offset),productFamily:family,
    priorityScore:90-offset,businessEligible:true,electronicRisk:false
  })));
  const result=selectReviewGateItems({ sampleCount:50,items },{ gate:'R1' });
  assert.equal(result.targetCount,5);assert.equal(result.selected.length,5);
  assert.deepEqual(result.selected.map(item => item.productFamily),DAY9_8_FAMILIES);
  assert.deepEqual(result.selected.map(item => item.priorityRank),[1,2,3,4,5]);
});

test('Day9.8 R2 and R3 preserve sample ranks and family coverage without rescoring',() => {
  const items=DAY9_8_FAMILIES.flatMap((family,familyIndex) => Array.from({ length:10 },(_,offset) => ({
    priorityRank:offset*5+familyIndex+1,goodsId:String(602000000000000+familyIndex*10+offset),productFamily:family,
    priorityScore:50+familyIndex,businessEligible:true,electronicRisk:false
  })));
  const r2=selectReviewGateItems({ sampleCount:50,items },{ gate:'R2' });
  assert.equal(r2.selected.length,10);assert.deepEqual(r2.selected.map(item => item.priorityRank),[1,6,2,7,3,8,4,9,5,10]);
  const r3=selectReviewGateItems({ sampleCount:50,items },{ gate:'R3' });
  assert.deepEqual(r3.selected.map(item => item.priorityRank),Array.from({ length:50 },(_,index) => index+1));
});
