import { median,safeRound } from '../analysis/product-metrics.mjs';

export const OPPORTUNITY_SCORE_WEIGHTS=Object.freeze({ demand:0.25,commercialValue:0.20,entryFriendliness:0.25,reviewGap:0.15,quality:0.15 });
export const PRODUCT_SCORE_WEIGHTS=Object.freeze({ demandValidation:0.35,commercialValue:0.30,quality:0.15,reviewGap:0.20 });

export function analyzeOpportunitySegments(items) {
  const included=items.filter(item=>item.included);
  const groups=groupBy(included,item=>item.productType);
  const base=[...groups].map(([productType,products])=>aggregate(productType,products));
  const ranked=base.filter(item=>item.skuCount>=3);
  const distributions={
    totalSales:ranked.map(item=>Math.log1p(item.totalSales)),medianSales:ranked.map(item=>Math.log1p(item.medianSales)),
    averagePrice:ranked.map(item=>Math.log1p(item.averagePrice)),gmvPerSku:ranked.map(item=>Math.log1p(item.gmvPerSku)),
    skuCount:ranked.map(item=>Math.log1p(item.skuCount)),top3:ranked.map(item=>item.top3SalesShare),
    averageReviews:ranked.map(item=>Math.log1p(item.averageReviewCount)),reviewDensity:ranked.map(item=>item.reviewDensity),
    averageRating:ranked.map(item=>item.averageRating ?? 0)
  };
  return base.map(metric=>scoreSegment(metric,distributions)).sort((a,b)=>{
    if(a.sampleStatus!==b.sampleStatus)return a.sampleStatus==='RANKED'?-1:1;
    return Number(b.opportunityScore??-1)-Number(a.opportunityScore??-1)||b.totalSales-a.totalSales;
  });
}

export function rankOpportunityProducts(items,segments,{ limit=5 }={}) {
  const segmentByType=new Map(segments.map(item=>[item.productType,item]));
  const included=items.filter(item=>item.included && Number.isFinite(item.salesCount) && Number.isFinite(item.priceAmount));
  const candidates=included.filter(item=>{
    const segment=segmentByType.get(item.productType);return segment && item.salesCount>=segment.medianSales;
  });
  const distributions={ sales:candidates.map(x=>Math.log1p(x.salesCount)),gmv:candidates.map(x=>Math.log1p(x.estimatedGmv)),
    price:candidates.map(x=>Math.log1p(x.priceAmount)),rating:candidates.map(x=>x.rating??0),reviews:candidates.map(x=>Math.log1p(x.reviewCount??0)) };
  const scored=candidates.map(item=>{
    const segment=segmentByType.get(item.productType);
    const components={
      demandValidation:100*percentileRank(Math.log1p(item.salesCount),distributions.sales),
      commercialValue:100*(0.60*percentileRank(Math.log1p(item.estimatedGmv),distributions.gmv)+0.40*percentileRank(Math.log1p(item.priceAmount),distributions.price)),
      quality:100*percentileRank(item.rating??0,distributions.rating),
      reviewGap:100*(1-percentileRank(Math.log1p(item.reviewCount??0),distributions.reviews))
    };
    const productScore=sumWeighted(components,PRODUCT_SCORE_WEIGHTS);
    const majorRisks=[...item.warningCodes];
    if(segment.riskLevel==='high')majorRisks.push(segment.dominanceType??'HIGH_SEGMENT_CONCENTRATION');
    if(item.fitmentType!=='universal')majorRisks.push(`FITMENT_${item.fitmentType.toUpperCase()}`);
    if(item.ipRisk!=='unknown')majorRisks.push(`IP_RISK_${item.ipRisk.toUpperCase()}`);
    const tier=segment.sampleStatus==='VALIDATION_OPPORTUNITY'?'VALIDATION_OPPORTUNITY':
      segment.riskLevel==='high' || item.ipRisk!=='unknown' || item.warningCodes.includes('COMPLEX_FITMENT')?'CAUTION_WATCH':
        Number(segment.opportunityScore)>=70?'CORE_SCALE_OPPORTUNITY':'DIFFERENTIATION_OPPORTUNITY';
    const opportunityReasons=[`商品销量 ${item.salesCount} 不低于细分中位数 ${safeRound(segment.medianSales,2)}`,
      `估算GMV €${safeRound(item.estimatedGmv,2)}，仅用于当前池内比较`,
      `细分机会分 ${segment.opportunityScore??'验证样本'}，商品机会分 ${productScore}`];
    return { ...item,segment,productScore,scoreComponents:roundObject(components),tier,
      opportunityReasons,majorRisks:[...new Set(majorRisks)],nextValidationAction:nextAction(item,segment) };
  }).sort((a,b)=>b.productScore-a.productScore||b.estimatedGmv-a.estimatedGmv);

  const selected=[];const usedTypes=new Set();
  for(const item of scored){if(selected.length>=limit)break;if(usedTypes.has(item.productType))continue;selected.push(item);usedTypes.add(item.productType);}
  if(selected.length<Math.min(limit,scored.length))for(const item of scored){if(selected.length>=limit)break;if(!selected.includes(item))selected.push(item);}
  return { scored,selected:selected.map((item,index)=>({ ...item,candidateRank:index+1 })) };
}

function aggregate(productType,products) {
  const sales=products.map(x=>x.salesCount).filter(Number.isFinite);const prices=products.map(x=>x.priceAmount).filter(Number.isFinite);
  const ratings=products.map(x=>x.rating).filter(Number.isFinite);const reviews=products.map(x=>x.reviewCount).filter(Number.isFinite);
  const totalSales=sum(sales);const estimatedGmv=sum(products.map(x=>x.estimatedGmv).filter(Number.isFinite));
  const top3Sales=[...sales].sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0);
  const level1Scene=mode(products.map(x=>x.level1Scene));
  return { level1Scene,productType,skuCount:products.length,totalSales,averageSales:avg(sales),medianSales:median(sales)??0,
    averagePrice:avg(prices),estimatedGmv,gmvPerSku:estimatedGmv/products.length,averageRating:ratings.length?avg(ratings):null,
    averageReviewCount:reviews.length?avg(reviews):0,reviewDensity:totalSales>0?sum(reviews)/totalSales:0,
    top3SalesShare:totalSales>0?top3Sales/totalSales:0,products };
}

function scoreSegment(metric,d) {
  const sampleStatus=metric.skuCount<3?'VALIDATION_OPPORTUNITY':'RANKED';
  const dominance=diagnoseDominance(metric);
  if(sampleStatus!=='RANKED')return { ...withoutProducts(metric),opportunityScore:null,scoreComponents:{ weights:OPPORTUNITY_SCORE_WEIGHTS },sampleStatus,
    ...dominance,reasons:[`样本数${metric.skuCount}<3，不进入正式排名`,`保留为VALIDATION_OPPORTUNITY`] };
  const components={
    demand:100*(0.60*percentileRank(Math.log1p(metric.totalSales),d.totalSales)+0.40*percentileRank(Math.log1p(metric.medianSales),d.medianSales)),
    commercialValue:100*(0.55*percentileRank(Math.log1p(metric.averagePrice),d.averagePrice)+0.45*percentileRank(Math.log1p(metric.gmvPerSku),d.gmvPerSku)),
    entryFriendliness:100*(0.55*(1-percentileRank(Math.log1p(metric.skuCount),d.skuCount))+0.45*(1-percentileRank(metric.top3SalesShare,d.top3))),
    reviewGap:100*(0.60*(1-percentileRank(Math.log1p(metric.averageReviewCount),d.averageReviews))+0.40*(1-percentileRank(metric.reviewDensity,d.reviewDensity))),
    quality:100*percentileRank(metric.averageRating??0,d.averageRating)
  };
  const opportunityScore=sumWeighted(components,OPPORTUNITY_SCORE_WEIGHTS);
  return { ...withoutProducts(metric),opportunityScore,scoreComponents:{ ...roundObject(components),weights:OPPORTUNITY_SCORE_WEIGHTS },sampleStatus,
    ...dominance,reasons:[`SKU=${metric.skuCount}，总销量=${safeRound(metric.totalSales,2)}，中位销量=${safeRound(metric.medianSales,2)}`,
      `GMV/SKU=€${safeRound(metric.gmvPerSku,2)}，Top3=${safeRound(metric.top3SalesShare*100,1)}%`,
      `评论密度=${safeRound(metric.reviewDensity,4)}；仅作为评论壁垒信号`] };
}

function diagnoseDominance(metric) {
  if(metric.top3SalesShare<0.65)return { dominanceType:null,dominanceReason:'Top3集中度未达到高风险阈值',replicability:'medium',riskLevel:'low',manualReviewRequired:false };
  const top=[...metric.products].sort((a,b)=>(b.salesCount??0)-(a.salesCount??0)).slice(0,3);
  const top1Share=metric.totalSales>0?(top[0]?.salesCount??0)/metric.totalSales:0;
  const ip=top.some(item=>item.ipRisk!=='unknown'||item.warningCodes.includes('OBVIOUS_IP_RISK'));
  const fitment=top.filter(item=>['model_specific','year_specific'].includes(item.fitmentType)).length>=2;
  const type=ip?'IP_RISK':fitment?'FITMENT_SYSTEM_BARRIER':top1Share>=0.55?'SINGLE_LISTING_DOMINANCE':'BRAND_CHANNEL_DOMINANCE';
  const reason=type==='IP_RISK'?'头部商品存在明显品牌/logo风险':type==='FITMENT_SYSTEM_BARRIER'?'头部商品以车型/年份适配为主':
    type==='SINGLE_LISTING_DOMINANCE'?`单一商品占细分销量${safeRound(top1Share*100,1)}%`:'Top3高度集中，需核对品牌或渠道控制';
  return { dominanceType:type,dominanceReason:reason,replicability:type==='SINGLE_LISTING_DOMINANCE'?'medium':'low',riskLevel:'high',manualReviewRequired:true };
}

function nextAction(item,segment){return `人工确认商品图与适配范围；核对${item.logisticsType}物流成本；复核${item.ipRisk} IP风险；对“${segment.productType}”做供应与差评验证。`;}
function percentileRank(value,values){const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return 0;const less=sorted.filter(x=>x<value).length;const equal=sorted.filter(x=>x===value).length;return (less+0.5*equal)/sorted.length;}
function sumWeighted(components,weights){return safeRound(Object.entries(weights).reduce((sum,[key,w])=>sum+Number(components[key]??0)*w,0),2);}
function roundObject(obj){return Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,safeRound(v,2)]));}
function withoutProducts(metric){const { products,...rest }=metric;return rest;}
function groupBy(items,key){const map=new Map();for(const item of items){const k=key(item);if(!map.has(k))map.set(k,[]);map.get(k).push(item);}return map;}
function sum(values){return values.reduce((a,b)=>a+b,0);}
function avg(values){return values.length?sum(values)/values.length:0;}
function mode(values){const counts=new Map();for(const v of values)counts.set(v,(counts.get(v)??0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??'其它非电子摩托配件';}
