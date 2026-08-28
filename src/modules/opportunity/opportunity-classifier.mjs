import { screenCatalogElectronicRisk } from '../catalog-scale/electronic-screening.mjs';

export const OPPORTUNITY_TAXONOMY_VERSION='motorcycle-opportunity-v2';

const PRODUCT_TYPES=Object.freeze([
  ['骑行收纳','尾包/后座包',/\b(?:tail|rear seat)\s*(?:bag|pack|pouch)|\bseat bag\b/i],
  ['骑行收纳','边包/鞍包',/\b(?:side bag|saddlebag|saddle bag|pannier)/i],
  ['骑行收纳','油箱包',/\btank\s*(?:bag|pouch)/i],
  ['骑行收纳','工具包/小包',/\b(?:tool bag|tool pouch|waist bag|leg bag|handlebar bag)/i],
  ['骑行收纳','骑行背包',/\b(?:motorcycle|riding)\s*backpack\b/i],
  ['骑行收纳','尾箱/硬箱',/\b(?:motorcycle|motorbike)\s+(?:luggage|tail box|top case|side box|helmet box)|\b(?:tail box|top case|side box|helmet box)\b.*\b(?:motorcycle|motorbike)\b/i],
  ['安全防护','车体防护',/\b(?:(?:waterproof|rain|dust|protective|outdoor|heavy[- ]duty|all[- ]season)\s+)*(?:motorcycle|motorbike|scooter|atv|quad)\s+(?:(?:waterproof|rain|dust|protective|outdoor|heavy[- ]duty|all[- ]season)\s+)*covers?\b|\bcovers?\s+for\s+(?:motorcycle|motorbike|scooter|atv|quad)\b/i],
  ['骑行收纳','其它收纳包',/\b(?:motorcycle|motorbike|scooter)\b(?:(?!\bcover\b).){0,80}\b(?:(?:storage|luggage|helmet|dry|tool)\s*)?(?:bag|backpack)\b|\b(?:(?:storage|luggage|helmet|dry|tool)\s*)?(?:bag|backpack)\b(?:(?!\bcover\b).){0,80}\b(?:motorcycle|motorbike|scooter)\b/i],
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
  const level3Segment=level3For(lower,productType);
  const similarProductCluster=similarClusterFor(lower,productType,level3Segment);
  const matchedKeyword=matched?.[2]?.exec(lower)?.[0]??null;
  const titleEvidence=matchedKeyword??(similarProductCluster!=='未知'?clusterKeywordFor(lower,similarProductCluster):'none');
  const imageEvidence=resolveImageEvidence(product);
  const evidenceConflict=Boolean(product.evidenceConflict??product.evidence_conflict??false);
  const classificationEvidence=titleEvidence!=='none'
    ? (imageEvidence!=='unavailable'&&imageEvidence!=='not_assessed'?'title+image':'title')
    : (imageEvidence!=='unavailable'&&imageEvidence!=='not_assessed'?'image':'none');
  const physicalForm=physicalFormFor(lower,level1Scene,productType);
  const fitmentType=YEAR.test(lower) ? 'year_specific':UNIVERSAL.test(lower) ? 'universal':BRAND.test(lower) ? 'model_specific':'unknown';
  const logisticsType=logisticsFor(lower,physicalForm);
  const ipRisk=ipRiskFor(lower,warnings);
  const ambiguous=productType==='其它/待细分' || dataQuality.includes('TITLE_MISSING') || dataQuality.includes('OBVIOUS_NON_MOTORCYCLE') || evidenceConflict;
  const confidence=title ? (evidenceConflict?0.2:ambiguous ? 0.45:classificationEvidence==='title+image'?0.95:matched ? 0.88:0.55):0;
  const reasons=[matched ? `标题规则命中“${productType}”`:'未命中稳定产品类型规则，保留人工复核',
    `物理形态=${physicalForm}`,`适配=${fitmentType}`,`物流=${logisticsType}`];
  if (warnings.length) reasons.push(`风险标记：${warnings.join(', ')}`);
  if (hardExclusions.length) reasons.push(`电子硬排除：${hardExclusions.join(', ')}`);
  const included=hardExclusions.length===0 && !dataQuality.includes('OBVIOUS_NON_MOTORCYCLE') && Boolean(title);
  const clusteringEvidence=titleEvidence==='none'?'none':`title_keyword: ${titleEvidence}`;
  const sortingGroup=[level1Scene,productType,level3Segment,similarProductCluster].join('|');
  return { dataQuality,hardExclusions,warnings,level1Scene,productType,level3Segment,similarProductCluster,sortingGroup,clusteringEvidence,
    classificationEvidence,titleEvidence,imageEvidence,evidenceConflict,physicalForm,fitmentType,logisticsType,ipRisk,
    included,classificationMethod:'rule',confidence,reasons,
    manualReviewRequired:ambiguous || warnings.includes('OBVIOUS_IP_RISK') || warnings.includes('COMPLEX_FITMENT') };
}
function level3For(text,type) {
  const rules={ '车体防护':[[/cover/,'车罩']], '尾包/后座包':[[/expandable|expand/,'可扩容后座包'],[/waterproof/,'防水后座包']], '链条维护':[[/adjust/,'链条调节器'],[/clean|brush/,'链条清洁工具']], '拉杆/踏杆':[[/shift/,'换挡杆'],[/brake/,'刹车拉杆'],[/clutch/,'离合拉杆']], '化油器/进气':[[/carburetor|carburettor/,'化油器'],[/air filter|air cleaner/,'空气滤芯']], '防盗锁具':[[/disc/,'碟刹锁'],[/helmet/,'头盔锁']],
    '紧固/密封件':[[/\b(?:screw|screws)\b/,'螺丝'],[/\b(?:bolt|bolts)\b/,'螺栓'],[/\b(?:nut|nuts)\b/,'螺母'],[/\b(?:washer|washers)\b/,'垫片'],[/\b(?:gasket|seal|seals)\b/,'密封件'],[/\b(?:bearing|bearings)\b/,'轴承'],[/\bfastener(?:s| kit| set)?\b/,'紧固件套装']] };
  return rules[type]?.find(([pattern])=>pattern.test(text))?.[1] ?? (type==='其它/待细分'?'其它/待细分':type);
}

function similarClusterFor(text,type,level3) {
  const formal={
    '车体防护':'车罩','尾包/后座包':'尾包','边包/鞍包':'边包','油箱包':'油箱包','工具包/小包':'工具包','骑行背包':'骑行背包','尾箱/硬箱':'尾箱/硬箱','其它收纳包':'包类',
    '安装支架/转接件':'安装支架/转接件','紧固/密封件':level3,'后视镜及支架':'后视镜','拉杆/踏杆':level3,'脚踏/脚蹬':'踏杆',
    '链条维护':level3,'车架防摔滑块':'滑块/防摔块','前叉滑块':'滑块/防摔块','轴保护块':'滑块/防摔块','扎带/固定带':'扎带/固定带',
    '防盗锁具':'防盗锁','维修支架':'维修支架','把套/握把':'把套','车身外壳件':/fender|mudguard/.test(text)?'挡泥板':'车身外壳件','风挡/整流罩':'风挡',
  };
  if(type!=='其它/待细分')return formal[type]??level3??type;
  const rules=[
    [/\b(?:(?:waterproof|rain|dust|protective|outdoor|heavy[- ]duty|all[- ]season)\s+)*(?:motorcycle|motorbike|scooter|atv|quad)\s+(?:(?:waterproof|rain|dust|protective|outdoor|heavy[- ]duty|all[- ]season)\s+)*covers?\b|\bcovers?\s+for\s+(?:motorcycle|motorbike|scooter|atv|quad)\b/,'车罩'],
    [/\b(?:tail|rear seat)\s*(?:bag|pack|pouch)|\bseat bag\b/,'尾包'],[/\btank\s*(?:bag|pouch)\b/,'油箱包'],[/\b(?:side bag|saddlebag|saddle bag|pannier)\b/,'边包'],[/\b(?:tool bag|tool pouch)\b/,'工具包'],
    [/\b(?:bracket|mount|adapter|holder|mounting plate|support plate)\b/,'安装支架/转接件'],
    [/\b(?:screw|screws)\b/,'螺丝'],[/\b(?:bolt|bolts)\b/,'螺栓'],[/\b(?:nut|nuts)\b/,'螺母'],[/\b(?:washer|washers)\b/,'垫片'],[/\bfastener(?:s| kit| set)?\b/,'螺丝/紧固件'],
    [/\b(?:rearview mirror|rear view mirror)\b/,'后视镜'],[/\b(?:brake lever|clutch lever|shift lever|starter lever)\b/,'拉杆'],[/\b(?:footpeg|foot peg|floorboard|footrest|foot rest)\b/,'踏杆'],
    [/\bchain\s*(?:adjuster|adjustment|tensioner)\b/,'链条调节器'],[/\bchain\b/,'链条'],[/\b(?:slider|crash block|crash pad)\b/,'滑块/防摔块'],[/\b(?:strap|tie|bungee|retaining rope)\b/,'扎带/固定带'],
    [/\b(?:disc brake lock|helmet lock|anti[- ]theft rope|security lock)\b/,'防盗锁'],[/\b(?:motorcycle stand|wheel stand|maintenance stand|lift stand)\b/,'维修支架'],[/\b(?:gasket|seal|seals)\b/,'密封件'],[/\b(?:bearing|bearings)\b/,'轴承'],
    [/\b(?:grip|grips|grip cover|throttle sleeve)\b/,'把套'],[/\b(?:fender|mudguard)\b/,'挡泥板'],[/\b(?:windscreen|windshield|wind deflector)\b/,'风挡'],[/\b(?:motorcycle|motorbike|scooter)\b(?:(?!\bcover\b).){0,100}\b(?:bag|pouch|backpack)\b|\b(?:bag|pouch|backpack)\b(?:(?!\bcover\b).){0,100}\b(?:motorcycle|motorbike|scooter)\b/,'包类']
  ];
  return rules.find(([pattern])=>pattern.test(text))?.[1] ?? (type==='其它/待细分'?'未知':level3||type||'未知');
}

function clusterKeywordFor(text,cluster) {
  const map={车罩:/\b(?:motorcycle cover|motorbike cover|bike cover|dust cover|rain cover|protective cover|waterproof cover|cover)\b/i,螺丝:/\bscrews?\b/i,螺栓:/\bbolts?\b/i,螺母:/\bnuts?\b/i,垫片:/\bwashers?\b/i,'螺丝/紧固件':/\bfasteners?\b/i,'安装支架/转接件':/\b(?:bracket|mount|adapter|holder|mounting plate|support plate)\b/i};
  return map[cluster]?.exec(text)?.[0]??cluster;
}

function resolveImageEvidence(product) {
  const explicit=product.imageEvidence??product.image_evidence??product.raw?.image_evidence??product.raw?.imageEvidence;
  if(explicit!==null&&explicit!==undefined&&String(explicit).trim())return String(explicit).trim();
  return product.imageUrl?'not_assessed':'unavailable';
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
