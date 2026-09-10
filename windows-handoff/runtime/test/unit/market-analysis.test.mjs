import test from 'node:test';
import assert from 'node:assert/strict';
import { median,percentile,summarizeNumbers,topSalesShare } from '../../src/modules/analysis/product-metrics.mjs';
import { analyzeCategories } from '../../src/modules/analysis/category-analysis.mjs';
import { buildBusinessAlignment,screenBusinessEligibility } from '../../src/modules/analysis/business-screening.mjs';

test('percentile and median use linear interpolation',() => {
  assert.equal(median([4,1,3,2]),2.5);
  assert.equal(percentile([0,10,20,30],0.25),7.5);
  assert.equal(percentile([0,10,20,30],0.9),27);
});

test('numeric summaries ignore null, empty, NaN and Infinity',() => {
  const summary=summarizeNumbers([null,'',1,'2',Number.NaN,Number.POSITIVE_INFINITY,3]);
  assert.deepEqual(summary,{ count:3,total:6,min:1,max:3,avg:2,median:2,p25:1.5,p75:2.5,p90:2.8 });
  assert.equal(median([null,'']),null);
});

test('top sales share handles normal, short and zero-sales categories',() => {
  assert.equal(topSalesShare([50,30,20],2),0.8);
  assert.equal(topSalesShare([50,30,20],10),1);
  assert.equal(topSalesShare([0,0],5),0);
});

test('category aggregation reconciles product totals and distributions',() => {
  const result=analyzeCategories([
    product('a','刹车/控制',10,100,4.8,20),product('b','刹车/控制',20,300,4.6,40),
    product('c','照明',30,50,4.2,10)
  ]);
  assert.equal(result.categories.reduce((sum,item) => sum+item.productCount,0),3);
  const brakes=result.categories.find(item => item.categoryLabel === '刹车/控制');
  assert.equal(brakes.productCount,2);assert.equal(brakes.price.median,15);assert.equal(brakes.sales.total,400);
  assert.equal(brakes.top5SalesShare,1);
});

test('opportunity score is explainable and remains within 0–100',() => {
  const result=analyzeCategories([
    product('a','大类',20,1000,4.8,500),product('b','大类',30,800,4.7,300),
    product('c','小类',5,10,4.0,2)
  ]);
  for (const metric of result.categories) {
    assert.ok(metric.opportunityScore >= 0 && metric.opportunityScore <= 100);
    assert.equal(metric.analysisVersion,'week2-market-v1');
    assert.equal(Object.keys(metric.scoreComponents.weights).length,5);
    assert.ok(metric.reasons.length >= 4);
  }
});

test('needs_review and 其他 reduce classified coverage and confidence',() => {
  const result=analyzeCategories([
    product('a','刹车/控制',20,100,4.8,30,false),
    product('b','照明',30,200,4.6,50,true),
    product('c','其他',10,400,4.9,80,true)
  ]);
  assert.equal(result.overall.needsReviewCount,2);
  assert.equal(result.overall.otherCount,1);
  assert.equal(result.overall.classifiedCoverage,1/3);
  const other=result.categories.find(item => item.categoryLabel === '其他');
  assert.ok(other.scoreComponents.dataConfidence < 10);
  assert.match(other.reasons.join(' '),/真实业务细分类/);
});

function product(goodsId,categoryLabel,price,sales,rating,reviewCount,needsReview=false) {
  return { goodsId,title:`Product ${goodsId}`,categoryLabel,price,sales,rating,reviewCount,needsReview };
}

test('business screening hard-excludes electronics, USB, battery, certification risk and price below 5',() => {
  const screened=screenBusinessEligibility({ ...product('x','电子/通信',4.99,100,4.8,20),title:'Bluetooth USB rechargeable battery headset' });
  assert.equal(screened.businessEligible,false);
  assert.deepEqual(screened.businessExclusionCodes,[
    'ELECTRONIC_PRODUCT','USB_PRODUCT','BATTERY_PRODUCT','CERTIFICATION_RISK','PRICE_BELOW_5_EUR'
  ]);
  assert.equal(screened.followUpStatus,'否');
});

test('rating and review thresholds only create warnings',() => {
  const screened=screenBusinessEligibility(product('x','刹车/控制',8,100,4.5,3));
  assert.equal(screened.businessEligible,true);
  assert.deepEqual(screened.screeningWarnings,['RATING_BELOW_4_6','REVIEW_COUNT_LTE_3']);
});

test('other and needs-review products wait for fine classification instead of being excluded',() => {
  const other=screenBusinessEligibility(product('x','其他',8,100,4.8,20,true));
  assert.equal(other.businessEligible,null);assert.equal(other.needsFineClassification,true);assert.equal(other.followUpStatus,'先细分类');
  assert.deepEqual(other.businessExclusionCodes,[]);
});

test('business alignment keeps market and eligible rankings independent',() => {
  const products=[
    product('a','刹车/控制',8,100,4.8,20),
    { ...product('b','电子/通信',20,1000,4.9,500),title:'Bluetooth headset' },
    product('c','其他',9,200,4.7,50,true)
  ];
  const market=analyzeCategories(products);
  const aligned=buildBusinessAlignment(market);
  assert.equal(aligned.summary.eligibleCount,1);assert.equal(aligned.summary.excludedCount,1);assert.equal(aligned.summary.pendingFineClassificationCount,1);
  assert.ok(aligned.marketRanking.some(item => item.categoryLabel === '电子/通信'));
  assert.ok(!aligned.businessRanking.some(item => item.categoryLabel === '电子/通信'));
  assert.equal(aligned.fineClassificationQueue.length,1);
});
