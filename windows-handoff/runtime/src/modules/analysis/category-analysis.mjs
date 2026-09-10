import { ratioAtLeast,safeRound,summarizeNumbers,topSalesShare } from './product-metrics.mjs';

export const ANALYSIS_VERSION='week2-market-v1';
export const OTHER_CATEGORY='其他';
export const OPPORTUNITY_WEIGHTS=Object.freeze({
  demand:0.35,competition:0.25,priceSpace:0.15,maturity:0.15,dataConfidence:0.10
});

export function analyzeCategories(products,{ analysisVersion=ANALYSIS_VERSION,highReviewThreshold }={}) {
  if (!Array.isArray(products) || products.length === 0) throw new Error('市场分析没有可用商品。');
  const threshold=highReviewThreshold ?? summarizeNumbers(products.map(item => item.reviewCount)).p75 ?? 0;
  const groups=new Map();
  for (const product of products) {
    const categoryLabel=String(product.categoryLabel || '未分类');
    if (!groups.has(categoryLabel)) groups.set(categoryLabel,[]);
    groups.get(categoryLabel).push({ ...product,categoryLabel });
  }
  const base=[...groups].map(([categoryLabel,items]) => aggregateCategory(categoryLabel,items,products.length,threshold));
  const explicit=base.filter(metric => !metric.isOther);
  const reference=explicit.length ? explicit : base;
  const ranges={
    productCount:range(reference.map(item => item.productCount)),
    totalSales:range(reference.map(item => item.totalSales)),
    medianSales:range(reference.map(item => item.medianSales)),
    medianPrice:range(reference.map(item => item.medianPrice)),
    priceIqrRatio:range(reference.map(item => item.priceIqrRatio))
  };
  const metrics=base.map(metric => scoreCategory(metric,ranges,analysisVersion))
    .sort((a,b) => Number(a.isOther)-Number(b.isOther) || b.opportunityScore-a.opportunityScore || b.productCount-a.productCount);
  const needsReviewCount=products.filter(item => item.needsReview).length;
  const otherCount=products.filter(item => String(item.categoryLabel) === OTHER_CATEGORY).length;
  const clearClassifiedCount=products.filter(item => !item.needsReview && String(item.categoryLabel) !== OTHER_CATEGORY).length;
  const overall={
    activeProductCount:products.length,
    categoryCount:metrics.length,
    classifiedCoverage:clearClassifiedCount/products.length,
    clearClassifiedCount,
    needsReviewCount,
    otherCount,
    highReviewThreshold:threshold,
    price:summarizeNumbers(products.map(item => item.price)),
    sales:summarizeNumbers(products.map(item => item.sales)),
    rating:summarizeNumbers(products.map(item => item.rating)),
    reviews:summarizeNumbers(products.map(item => item.reviewCount))
  };
  return { analysisVersion,overall,categories:metrics,products };
}

function aggregateCategory(categoryLabel,items,totalProducts,highReviewThreshold) {
  const price=summarizeNumbers(items.map(item => item.price));
  const sales=summarizeNumbers(items.map(item => item.sales));
  const rating=summarizeNumbers(items.map(item => item.rating));
  const reviews=summarizeNumbers(items.map(item => item.reviewCount));
  const needsReviewCount=items.filter(item => item.needsReview).length;
  return {
    categoryLabel,
    isOther:categoryLabel === OTHER_CATEGORY,
    productCount:items.length,
    productShare:items.length/totalProducts,
    needsReviewCount,
    needsReviewShare:needsReviewCount/items.length,
    price,sales,rating,reviews,
    totalSales:sales.total ?? 0,
    medianSales:sales.median ?? 0,
    medianPrice:price.median ?? 0,
    priceIqrRatio:price.median && price.p75 !== null && price.p25 !== null ? (price.p75-price.p25)/price.median : 0,
    rating45Share:ratioAtLeast(items.map(item => item.rating),4.5),
    highReviewShare:ratioAtLeast(items.map(item => item.reviewCount),highReviewThreshold),
    top5SalesShare:topSalesShare(items.map(item => item.sales),5),
    top10SalesShare:topSalesShare(items.map(item => item.sales),10),
    coverage:{
      price:price.count/items.length,
      sales:sales.count/items.length,
      rating:rating.count/items.length,
      reviews:reviews.count/items.length
    }
  };
}

function scoreCategory(metric,ranges,analysisVersion) {
  const demand=100*(
    0.45*normalize(metric.totalSales,ranges.totalSales)+
    0.35*normalize(metric.medianSales,ranges.medianSales)+
    0.20*normalize(metric.productCount,ranges.productCount)
  );
  const competition=100*(0.60*(1-metric.top10SalesShare)+0.40*(1-metric.top5SalesShare));
  const priceSpace=100*(0.60*normalize(metric.medianPrice,ranges.medianPrice)+0.40*normalize(metric.priceIqrRatio,ranges.priceIqrRatio));
  const maturity=100*(0.60*Math.min(1,Math.max(0,(metric.rating.avg ?? 0)/5))+0.40*(metric.rating45Share ?? 0));
  const numericCoverage=Object.values(metric.coverage).reduce((sum,value) => sum+value,0)/4;
  const classificationReliability=Math.max(0.1,1-metric.needsReviewShare)*(metric.isOther ? 0.25 : 1);
  const dataConfidence=100*numericCoverage*classificationReliability;
  const components={
    demand:safeRound(demand,2),competition:safeRound(competition,2),priceSpace:safeRound(priceSpace,2),
    maturity:safeRound(maturity,2),dataConfidence:safeRound(dataConfidence,2),weights:OPPORTUNITY_WEIGHTS
  };
  const opportunityScore=safeRound(
    demand*OPPORTUNITY_WEIGHTS.demand+competition*OPPORTUNITY_WEIGHTS.competition+
    priceSpace*OPPORTUNITY_WEIGHTS.priceSpace+maturity*OPPORTUNITY_WEIGHTS.maturity+
    dataConfidence*OPPORTUNITY_WEIGHTS.dataConfidence,2);
  const reasons=[
    demand >= 70 ? '当前商品池需求强度较高' : demand >= 40 ? '当前商品池需求强度中等' : '当前商品池需求强度较低',
    `Top10销量占比 ${(metric.top10SalesShare*100).toFixed(1)}%，仅表示当前1000商品池头部集中度`,
    `价格中位数 €${(metric.price.median ?? 0).toFixed(2)}，价格P25–P75为 €${(metric.price.p25 ?? 0).toFixed(2)}–€${(metric.price.p75 ?? 0).toFixed(2)}`,
    `评分/评论数据完整度 ${(numericCoverage*100).toFixed(1)}%`
  ];
  if (metric.needsReviewCount) reasons.push(`${metric.needsReviewCount} 个商品需要人工复核，降低数据可信度`);
  if (metric.isOther) reasons.push('“其他”不是可直接决策的真实业务细分类，本分数仅供拆分类优先级参考');
  return { ...metric,analysisVersion,opportunityScore,scoreComponents:components,reasons };
}

function range(values) {
  const numbers=values.filter(value => Number.isFinite(Number(value))).map(Number);
  return { min:Math.min(...numbers),max:Math.max(...numbers) };
}

function normalize(value,{ min,max }) {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 0.5;
  return Math.min(1,Math.max(0,(value-min)/(max-min)));
}
