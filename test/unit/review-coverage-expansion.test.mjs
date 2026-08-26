import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDay9EligibleQueue } from '../../src/modules/reviews/review-service.mjs';

test('Day9.8 selects ten new products across all priority categories and other eligible categories',() => {
  const labels=['整车防护罩','排气系统部件','车把与横把附件','维护工具','照明','后视镜','收纳/尾包','贴纸装饰','刹车/控制','其他配件','备用类别'];
  const products=labels.flatMap((label,index) => Array.from({ length:index === 0 ? 2:1 },(_,offset) => product(index*10+offset+1,label)));
  const excluded=products[0].goodsId;
  const result=buildDay9EligibleQueue(products,{ targetCount:10,expectedEligibleCount:products.length,excludeGoodsIds:[excluded] });
  assert.equal(result.selected.length,10);
  assert.ok(!result.selected.some(item => item.goodsId === excluded));
  for (const label of ['整车防护罩','排气系统部件','车把与横把附件']) assert.ok(result.selected.some(item => item.level3 === label));
  assert.ok(new Set(result.selected.map(item => item.level3)).size >= 9);
});

function product(id,level3) {
  return { productId:id,goodsId:String(600000000000000+id),title:`Product ${id}`,rank:id,price:10,sales:100,rating:4.8,
    reviewCount:100,categoryLabel:level3,level1:'摩托车配件',level2:'测试',level3,taxonomy:'week2-motorcycle-fine-v1',
    manualReviewRequired:false,needsReview:false,businessSignals:{},classificationConfidence:0.9 };
}
