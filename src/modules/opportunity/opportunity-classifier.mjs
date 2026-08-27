import { screenCatalogElectronicRisk } from '../catalog-scale/electronic-screening.mjs';

export const OPPORTUNITY_TAXONOMY_VERSION='motorcycle-opportunity-v1';

const PRODUCT_TYPES=Object.freeze([
  ['骑行收纳','尾包/后座包',/\b(?:tail|rear seat)\s*(?:bag|pack|pouch)|\bseat bag\b/i],
  ['骑行收纳','边包/鞍包',/\b(?:side bag|saddlebag|saddle bag|pannier)/i],
  ['骑行收纳','油箱包',/\btank\s*(?:bag|pouch)/i],
  ['骑行收纳','工具包/小包',/\b(?:tool bag|tool pouch|waist bag|leg bag|handlebar bag)/i],
  ['骑行收纳','骑行背包',/\b(?:motorcycle|riding)\s*backpack\b/i],
  ['安全防护','摩托车车罩',/\b(?:motorcycle|motorbike|scooter|atv|quad)\s*(?:cover|covers)|\bcover\b.*\b(?:motorcycle|motorbike|scooter|atv|quad)\b/i],
  ['安全防护','前叉滑块',/\bfork\s*(?:slider|protector|guard|pad)\b/i],
  ['安全防护','轴保护块',/\b(?:axle|wheel)\s*(?:block|slider|protector|guard)\b/i],
  ['安全防护','车架防摔滑块',/\b(?:crash|fall|frame)\s*(?:slider|protector|guard|pad)|\bslider\b/i],
  ['安全防护','护杠/护手',/\b(?:handguard|hand guard|crash bar|engine guard|lever guard)/i],
  ['安全防护','支架加大垫',/\b(?:kickstand|side stand)\b.*\b(?:pad|plate|enlarger|extension|support)/i],
  ['安全防护','防盗锁具',/\b(?:disc brake lock|helmet lock|anti[- ]theft rope|security lock)/i],
  ['控制操纵','车把/横把',/\b(?:handlebar|handle bar|crossbar)\b/i],
  ['控制操纵','把套/握把',/\b(?:grip|grips|grip cover|throttle sleeve)\b/i],
  ['控制操纵','拉杆/踏杆',/\b(?:brake lever|clutch lever|shift lever|starter lever|kick start|pedal|foot lever)/i],
  ['控制操纵','脚踏/脚蹬',/\b(?:footpeg|foot peg|floorboard|footrest|foot rest)/i],
  ['控制操纵','油门控制件',/\b(?:throttle control|cruise control|accelerator|throttle clamp)/i],
  ['控制操纵','后视镜及支架',/\b(?:rearview mirror|rear view mirror|mirror bracket|mirror adapter)/i],
  ['维修保养','排气管/消音器',/\b(?:exhaust|muffler|silencer|tailpipe|link pipe)\b/i],
  ['维修保养','排气连接件',/\b(?:exhaust spring|exhaust clamp|exhaust gasket|spring hook)/i],
  ['维修保养','燃油管路',/\b(?:fuel|gas|petrol)\b.*\b(?:hose|line|pipe|filter|petcock|valve|cap|tank switch)/i],
  ['维修保养','化油器/进气',/\b(?:carburetor|carburettor|intake pipe|air filter|air cleaner)/i],
  ['维修保养','链条维护',/\b(?:chain brush|chain cleaner|chain tension|chain adjust|chain guide)/i],
  ['维修保养','维修支架',/\b(?:motorcycle stand|wheel stand|maintenance stand|lift stand|support stand)/i],
  ['维修保养','紧固/密封件',/\b(?:screw|bolt|nut|washer|gasket|seal|bearing|spring|clip|clamp|fastener)/i],
  ['外观改装','风挡/整流罩',/\b(?:windscreen|windshield|fairing|wind deflector)/i],
  ['外观改装','贴纸/装饰件',/\b(?:decal|sticker|emblem|badge|decorative|decoration|trim)/i],
  ['外观改装','车身外壳件',/\b(?:fender|mudguard|cowling|side panel|body panel)/i],
  ['其它非电子摩托配件','安装支架/转接件',/\b(?:bracket|mount|adapter|holder|support plate)\b/i],
  ['其它非电子摩托配件','扎带/固定带',/\b(?:strap|tie|bungee|elastic cord|retaining rope)/i],
]);

const BRAND=/\b(?:honda|yamaha|kawasaki|suzuki|ducati|bmw|harley|davidson|ktm|husqvarna|triumph|aprilia|vespa|indian|benelli|cfmoto)\b/i;
const YEAR=/\b(?:19|20)\d{2}\s*(?:-|to|–|—)\s*(?:19|20)?\d{2}\b|\b(?:19|20)\d{2}\b/i;
const UNIVERSAL=/\buniversal\b|\bmost motorcycles\b|\bmultiple models\b/i;
const OBVIOUS_NON_MOTORCYCLE=/\b(?:dog|cat|pet collar|kitchen|bathroom|bedroom|sofa|curtain|baby stroller|laptop|iphone case)\b/i;

export function classifyOpportunityProduct(product) {
  const title=String(product.title ?? '').normalize('NFKC').trim();
  const lower=title.toLowerCase();
  const dataQuality=[];
  if (!title) dataQuality.push('TITLE_MISSING');
  if (product.priceAmount===null || product.priceAmount===undefined) dataQuality.push('PRICE_MISSING');
  if (product.salesCount===null || product.salesCount===undefined) dataQuality.push('SALES_COUNT_MISSING');
  if (product.rating===null || product.rating===undefined) dataQuality.push('RATING_MISSING');
  if (product.reviewCount===null || product.reviewCount===undefined) dataQuality.push('REVIEW_COUNT_MISSING');
  if (!product.imageUrl) dataQuality.push('IMAGE_MISSING');
  if (!product.currentSourceUrl) dataQuality.push('SOURCE_URL_MISSING');
  if (product.currency && product.currency!=='EUR') dataQuality.push('CURRENCY_ANOMALY');
  if (Number(product.priceAmount)===0) dataQuality.push('PRICE_ZERO');
  if (Number(product.salesCount)<0 || Number(product.salesCount)>100_000_000) dataQuality.push('SALES_ANOMALY');
  if (OBVIOUS_NON_MOTORCYCLE.test(lower)) dataQuality.push('OBVIOUS_NON_MOTORCYCLE');

  const electronic=screenCatalogElectronicRisk({ title });
  const hardExclusions=electronic.decision==='exclude' ? [...electronic.codes]:[];
  const warnings=[];
  if (Number.isFinite(Number(product.priceAmount)) && Number(product.priceAmount)<5) warnings.push('PRICE_BELOW_5_EUR');
  if (BRAND.test(lower)) warnings.push('OBVIOUS_BRAND_DEPENDENCY');
  if (/\b(?:logo|emblem|badge|licensed|replica)\b/i.test(lower)) warnings.push('OBVIOUS_IP_RISK');
  if (/\b(?:exhaust|muffler|stand|lift|crash bar|engine guard|windshield|fairing)\b/i.test(lower)) warnings.push('HEAVY_OR_BULKY');
  if (YEAR.test(lower) || (BRAND.test(lower) && /\b(?:for|fit|compatible|suitable)\b/i.test(lower))) warnings.push('COMPLEX_FITMENT');

  const matched=PRODUCT_TYPES.find(([, ,pattern])=>pattern.test(lower));
  const level1Scene=matched?.[0] ?? '其它非电子摩托配件';
  const productType=matched?.[1] ?? '其它/待细分';
  const physicalForm=physicalFormFor(lower,level1Scene,productType);
  const fitmentType=YEAR.test(lower) ? 'year_specific':UNIVERSAL.test(lower) ? 'universal':BRAND.test(lower) ? 'model_specific':'unknown';
  const logisticsType=logisticsFor(lower,physicalForm);
  const ipRisk=ipRiskFor(lower,warnings);
  const ambiguous=productType==='其它/待细分' || dataQuality.includes('TITLE_MISSING') || dataQuality.includes('OBVIOUS_NON_MOTORCYCLE');
  const confidence=title ? (ambiguous ? 0.45:matched ? 0.88:0.55):0;
  const reasons=[matched ? `标题规则命中“${productType}”`:'未命中稳定产品类型规则，保留人工复核',
    `物理形态=${physicalForm}`,`适配=${fitmentType}`,`物流=${logisticsType}`];
  if (warnings.length) reasons.push(`风险标记：${warnings.join(', ')}`);
  if (hardExclusions.length) reasons.push(`电子硬排除：${hardExclusions.join(', ')}`);
  const included=hardExclusions.length===0 && !dataQuality.includes('OBVIOUS_NON_MOTORCYCLE') && Boolean(title);
  return { dataQuality,hardExclusions,warnings,level1Scene,productType,physicalForm,fitmentType,logisticsType,ipRisk,
    included,classificationMethod:'rule',confidence,reasons,
    manualReviewRequired:ambiguous || warnings.includes('OBVIOUS_IP_RISK') || warnings.includes('COMPLEX_FITMENT') };
}

function ipRiskFor(text,warnings) {
  if (/\b(?:logo|emblem|badge|licensed|replica)\b/i.test(text) || warnings.includes('OBVIOUS_BRAND_DEPENDENCY')) return 'brand_logo';
  if (/\b(?:copyright|character|cartoon|graphic print|anime)\b/i.test(text)) return 'copyrighted_graphic';
  if (/\b(?:fairing|body panel|cowling|decorative frame)\b/i.test(text)) return 'design_risk';
  if (/\b(?:patent|patented|proprietary mechanism)\b/i.test(text)) return 'structural_patent_risk';
  return 'unknown';
}

function physicalFormFor(text,scene,type) {
  if (/\b(?:bag|pouch|backpack|saddlebag|pannier)\b/i.test(text)) return 'soft_bag';
  if (/\b(?:cover|dust cover)\b/i.test(text)) return 'textile_cover';
  if (/\b(?:hose|tube|pipe|line)\b/i.test(text)) return 'tube_pipe';
  if (/\b(?:rubber|silicone|gasket|seal|grip)\b/i.test(text)) return 'rubber_component';
  if (/\b(?:windscreen|windshield|fairing|fender|panel)\b/i.test(text)) return 'molded_panel';
  if (/\b(?:bracket|adapter|lever|pedal|peg|bolt|screw|spring|stand|guard|slider)\b/i.test(text)) return 'metal_hardware';
  if (scene==='维修保养' || type.includes('排气')) return 'mixed_assembly';
  return 'unknown';
}

function logisticsFor(text,form) {
  if (['soft_bag','textile_cover'].includes(form) || /\b(?:strap|rope|cord)\b/i.test(text)) return 'soft_compressible';
  if (/\b(?:exhaust|muffler|stand|lift|crash bar|engine guard|windshield|fairing)\b/i.test(text)) return 'heavy_bulky';
  if (['metal_hardware','tube_pipe','rubber_component'].includes(form)) return 'light_small';
  return 'unknown';
}
