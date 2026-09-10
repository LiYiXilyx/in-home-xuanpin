import { analyzeCategories } from './category-analysis.mjs';

export const BUSINESS_RULE_VERSION='week2-business-v1';

const USB_PATTERN=/\b(?:usb(?:[-\s]?[a-z0-9]+)?|type[-\s]?c)\b/i;
const BATTERY_PATTERN=/\b(?:battery|batteries|battery-powered|rechargeable|lithium|li[-\s]?ion|power\s*bank)\b/i;
const CERTIFICATION_PATTERN=/\b(?:bluetooth|headset|headphone|earphone|earbud|intercom|audio|speaker|charger|charging|wireless\s+audio|microphone)\b/i;

export function screenBusinessEligibility(product) {
  const title=String(product.title ?? '');
  const exclusionCodes=[];
  const exclusionReasons=[];
  const screeningWarnings=[];
  const signals=product.businessSignals ?? {};
  const isElectronic=signals.isElectronic === true || String(product.categoryLabel) === '电子/通信';
  const isUsb=signals.hasUsb === true || USB_PATTERN.test(title);
  const isBattery=signals.batteryRisk === true || BATTERY_PATTERN.test(title);
  const hasCertificationRisk=signals.certificationRisk === true || CERTIFICATION_PATTERN.test(title);
  const price=numberOrNull(product.price);
  const rating=numberOrNull(product.rating);
  const reviewCount=numberOrNull(product.reviewCount);

  if (isElectronic) addRule(exclusionCodes,exclusionReasons,'ELECTRONIC_PRODUCT','电子/通信类暂不进入当前候选范围');
  if (isUsb) addRule(exclusionCodes,exclusionReasons,'USB_PRODUCT','标题命中USB/Type-C产品规则');
  if (isBattery) addRule(exclusionCodes,exclusionReasons,'BATTERY_PRODUCT','标题命中电池/锂电/充电电池产品规则');
  if (hasCertificationRisk) addRule(exclusionCodes,exclusionReasons,'CERTIFICATION_RISK','标题命中蓝牙/音频/充电等认证风险规则');
  if (price !== null && price < 5) addRule(exclusionCodes,exclusionReasons,'PRICE_BELOW_5_EUR','Temu售价低于5 EUR业务准入线');
  if (rating === null || reviewCount === null) screeningWarnings.push('UNKNOWN_REVIEW_REQUIRED');
  if (rating !== null && rating < 4.6) screeningWarnings.push('RATING_BELOW_4_6');
  if (reviewCount !== null && reviewCount <= 3) screeningWarnings.push('REVIEW_COUNT_LTE_3');

  const fineTaxonomy=String(product.taxonomy ?? '').startsWith('week2-motorcycle-fine');
  const needsFineClassification=Boolean(product.manualReviewRequired) || String(product.categoryLabel) === '其他' || (!fineTaxonomy && Boolean(product.needsReview));
  const businessEligible=exclusionCodes.length ? false : needsFineClassification ? null : true;
  const businessStatus=businessEligible === true ? '可做' : businessEligible === false ? '排除' : '待细分类';
  const enterFurtherAnalysis=businessEligible === true;
  return {
    ...product,businessEligible,businessStatus,businessExclusionCodes:exclusionCodes,
    businessExclusionCode:exclusionCodes.join('|'),businessExclusionReason:exclusionReasons.join('；'),
    screeningWarnings,screeningWarning:screeningWarnings.join('|'),needsFineClassification,
    enterFurtherAnalysis,followUpStatus:enterFurtherAnalysis ? '是' : businessEligible === null ? '先细分类' : '否',
    businessRuleVersion:BUSINESS_RULE_VERSION,
    ruleFlags:{ isElectronic,isUsb,isBattery,hasCertificationRisk,priceBelow5:price !== null && price < 5 }
  };
}

export function buildBusinessAlignment(marketAnalysis) {
  const products=marketAnalysis.products.map(screenBusinessEligibility);
  const eligibleProducts=products.filter(item => item.businessEligible === true);
  const businessAnalysis=eligibleProducts.length ? analyzeCategories(eligibleProducts,{ analysisVersion:marketAnalysis.analysisVersion }) : { categories:[],overall:null };
  const marketByCategory=new Map(marketAnalysis.categories.map(item => [item.categoryLabel,item]));
  const businessByCategory=new Map(businessAnalysis.categories.map(item => [item.categoryLabel,item]));
  const categoryAlignment=marketAnalysis.categories.map(marketMetric => {
    const categoryProducts=products.filter(item => item.categoryLabel === marketMetric.categoryLabel);
    const eligibleCount=categoryProducts.filter(item => item.businessEligible === true).length;
    const excludedCount=categoryProducts.filter(item => item.businessEligible === false).length;
    const pendingCount=categoryProducts.filter(item => item.businessEligible === null).length;
    return {
      categoryLabel:marketMetric.categoryLabel,originalProductCount:categoryProducts.length,eligibleCount,excludedCount,pendingCount,
      exclusionRate:categoryProducts.length ? excludedCount/categoryProducts.length : 0,
      marketOpportunityScore:marketMetric.opportunityScore,
      businessEligibleOpportunityScore:businessByCategory.get(marketMetric.categoryLabel)?.opportunityScore ?? null,
      marketMetric,businessMetric:businessByCategory.get(marketMetric.categoryLabel) ?? null
    };
  });
  const marketRanking=marketAnalysis.categories.filter(item => !item.isOther)
    .map((item,index) => ({ rank:index+1,categoryLabel:item.categoryLabel,score:item.opportunityScore,productCount:item.productCount }));
  const businessRanking=businessAnalysis.categories.filter(item => !item.isOther)
    .map((item,index) => ({ rank:index+1,categoryLabel:item.categoryLabel,score:item.opportunityScore,productCount:item.productCount }));
  const summary={
    total:products.length,eligibleCount:products.filter(item => item.businessEligible === true).length,
    excludedCount:products.filter(item => item.businessEligible === false).length,
    pendingFineClassificationCount:products.filter(item => item.businessEligible === null).length,
    electronicsCount:products.filter(item => item.ruleFlags.isElectronic).length,
    usbCount:products.filter(item => item.ruleFlags.isUsb).length,
    batteryCount:products.filter(item => item.ruleFlags.isBattery).length,
    certificationRiskCount:products.filter(item => item.ruleFlags.hasCertificationRisk || item.ruleFlags.isBattery).length,
    priceBelow5Count:products.filter(item => item.ruleFlags.priceBelow5).length,
    screeningWarningCount:products.filter(item => item.screeningWarnings.length).length,
    needsFineClassificationCount:products.filter(item => item.needsFineClassification).length
  };
  const fineClassificationQueue=products.filter(item => item.needsFineClassification && item.businessEligible !== false)
    .sort((a,b) => (a.rank ?? Number.MAX_SAFE_INTEGER)-(b.rank ?? Number.MAX_SAFE_INTEGER));
  const marketScoreByCategory=new Map([...marketByCategory].map(([label,metric]) => [label,metric.opportunityScore]));
  for (const product of products) product.marketOpportunityScore=marketScoreByCategory.get(product.categoryLabel) ?? null;
  return { ruleVersion:BUSINESS_RULE_VERSION,summary,products,categoryAlignment,marketRanking,businessRanking,businessAnalysis,fineClassificationQueue };
}

function addRule(codes,reasons,code,reason) {
  if (!codes.includes(code)) { codes.push(code);reasons.push(reason); }
}
function numberOrNull(value) { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); }
