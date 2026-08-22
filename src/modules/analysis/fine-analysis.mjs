import { sampleSizeStatus } from '../products/fine-taxonomy.mjs';

export function buildFineAnalysis(analysis,business,context={}) {
  const products=business.products;
  const metrics=business.categoryAlignment.map(alignment => {
    const categoryProducts=products.filter(item => item.categoryLabel === alignment.categoryLabel);
    const confidences=categoryProducts.map(item => Number(item.classificationConfidence)).filter(Number.isFinite);
    const market=alignment.marketMetric;const status=sampleSizeStatus(alignment.eligibleCount);
    return {
      level2:categoryProducts[0]?.level2 ?? '其他待复核',level3:alignment.categoryLabel,productFamily:alignment.categoryLabel,
      productCount:alignment.originalProductCount,eligibleCount:alignment.eligibleCount,excludedCount:alignment.excludedCount,pendingCount:alignment.pendingCount,
      priceMedian:market.price.median,priceP25:market.price.p25,priceP75:market.price.p75,salesMedian:market.sales.median,totalSales:market.sales.total,
      ratingMedian:market.rating.median,reviewCountMedian:market.reviews.median,top5SalesShare:market.top5SalesShare,top10SalesShare:market.top10SalesShare,
      classificationConfidence:confidences.length ? confidences.reduce((sum,value) => sum+value,0)/confidences.length : 0,
      opportunityScoreV2:alignment.businessEligibleOpportunityScore,sampleSizeStatus:status,missingData:missingData(categoryProducts)
    };
  }).sort((a,b) => (b.opportunityScoreV2 ?? -1)-(a.opportunityScoreV2 ?? -1) || b.eligibleCount-a.eligibleCount || a.level3.localeCompare(b.level3));
  const mainRanking=rank(metrics.filter(item => item.sampleSizeStatus === 'usable' && item.opportunityScoreV2 !== null));
  const observationRanking=rank(metrics.filter(item => item.sampleSizeStatus !== 'usable' && item.opportunityScoreV2 !== null));
  const candidates=mainRanking.slice(0,Math.min(5,Math.max(2,Math.min(3,mainRanking.length)))).map(item => ({ ...item,
    recommendationReason:`eligible=${item.eligibleCount}（usable），业务可做机会分 ${item.opportunityScoreV2.toFixed(2)}；仅作为评论/生命周期研究优先级，不是最终选品结论。` }));
  const beforeOtherCount=Number(context.beforeOtherCount ?? 0);const afterOtherCount=products.filter(item => item.categoryLabel === '其他').length;
  const manualReviewQueue=products.filter(item => item.manualReviewRequired).map(item => ({ goodsId:item.goodsId,title:item.title,currentCategory:item.previousCategory ?? '其他',aiOrRuleResult:item.categoryLabel,confidence:item.classificationConfidence,unresolvedReason:item.unresolvedReason }));
  return { version:'week2-business-eligible-v2',metrics,mainRanking,observationRanking,candidates,manualReviewQueue,
    summary:{ beforeOtherCount,afterOtherCount,resolvedCount:Number(context.processedQueueCount ?? 0)-manualReviewQueue.length,unresolvedCount:manualReviewQueue.length,manualReviewRequiredCount:manualReviewQueue.length,processedQueueCount:Number(context.processedQueueCount ?? 0) } };
}

function rank(items) { return items.map((item,index) => ({ rank:index+1,...item })); }
function missingData(products) { const missing=[];if (products.some(item => item.rating === null)) missing.push('rating');if (products.some(item => item.reviewCount === null)) missing.push('review_count');missing.push('最近30天评论','评论速度','生命周期','差评痛点','供应链可行性');return [...new Set(missing)]; }
