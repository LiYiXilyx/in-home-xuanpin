import { classifyOpportunityProduct } from './opportunity-classifier.mjs';
import { extractEvidenceTitle, classifyWaitingProductV2 } from './opportunity-v2.mjs';

const GENERIC_TITLE = /^(?:icon|image|photo|picture|product image|item picture)$/i;
const ITEM_PICTURE_PREFIX = /^item\s+picture\s*/i;

// These are deliberately product-entity rules, not market/opportunity rules.
// They let an unclassified title avoid visual review without pretending that a
// missing taxonomy node is a formal classification.
const FAST_TITLE_RULES = Object.freeze([
  ['electronic', /\b(?:intercom|headset|headphones?|bluetooth|wireless|cdi|ignition\s+coil|voltage\s+regulator|alarm|usb|battery|rechargeable|speaker|motor\s+controller)\b/i],
  ['seat', /\b(?:motorcycle|motorbike|rider|passenger)?\s*seat\b|\b(?:seat\s+(?:cushion|cover|pad|backrest)|saddle\s+(?:bag|cover|pad)|backrest|seat\s+protector)\b/i],
  ['spark_plug', /\bspark\s+plugs?\b/i],
  ['drive_belt', /\b(?:drive|cvt)\s+belts?\b/i],
  ['foot_control', /\b(?:foot\s*peg|foot\s*rest|footrest|gear\s+(?:shifter|lever|shift)|shift\s+(?:lever|linkage|pad)|brake\s+(?:lever|pedal)|clutch|kick\s*start|pedal|master\s+cylinder|backrest)\b/i],
  ['grip_handlebar', /\b(?:handlebars?|handle\s+bar|grips?|grip\s+cover|throttle\s+sleeve)\b/i],
  ['storage_bag', /\b(?:tail\s+bag|rear\s+seat\s+bag|saddlebags?|saddle\s+bag|side\s+bag|pannier|tank\s+bag|tool\s+bag|pouch|luggage|backpack|storage\s+box|trunk\s+box|toolbox|cargo\s+box)\b/i],
  ['cover', /\b(?:motorcycle|motorbike|scooter|atv|quad)\b[^.]{0,90}\bcovers?\b|\bcovers?\b[^.]{0,90}\b(?:motorcycle|motorbike|scooter|atv|quad)\b/i],
  ['guard_protector', /\b(?:slider|crash\s+(?:bar|protector|pad)|axle\s+(?:block|slider)|fork\s+(?:slider|protector|gaiter)|frame\s+slider|handguards?|hand\s+guard|engine\s+guard|screen\s+protection|protective\s+(?:pad|film)|protector|anti[- ]collision)\b/i],
  ['mount_bracket', /\b(?:brackets?|mounts?|mounting|holder|adapter|extension|support\s+plate|clamp)\b/i],
  ['fastener', /\b(?:screws?|bolts?|nuts?|washers?|fasteners?|gaskets?|seals?|clips?|tie\s+wraps?)\b/i],
  ['maintenance', /\b(?:carburetor|carburettor|fuel\s+(?:filter|line|hose|pipe|tank|valve)|chain(?:\s+(?:guide|adjuster|tensioner|cleaner))?|sprocket|bearing|repair\s+tool|paddock\s+stand|maintenance\s+stand|wheel\s+(?:stand|roller)|kickstand|side\s+stand|piston|reed\s+valve|nozzle|inner\s+tube|tire\s+support|loading\s+ramp|ramp)\b/i],
  ['appearance', /\b(?:sticker|decal|trim|decorative|decoration|cap|cover\s+plate|head\s+cover|horn\s+cover|fairing|windscreen|windshield|fender|mudguard|winglet|license\s+(?:number\s+)?plate|spoke|wind\s+shield)\b/i],
  ['mirror', /\b(?:rear\s*view\s+mirror|rearview\s+mirror|mirror)\b/i],
  ['anti_theft', /\b(?:anti[- ]theft|security|disc\s+brake\s+lock|helmet\s+lock|lockable)\b/i],
]);

function rawObject(item) {
  if (!item?.raw) return {};
  if (typeof item.raw === 'object') return item.raw;
  try { return JSON.parse(item.raw); } catch { return {}; }
}

function cleanCandidate(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const stripped = text.replace(ITEM_PICTURE_PREFIX, '').trim();
  if (GENERIC_TITLE.test(stripped)) return '';
  return stripped;
}

/** Effective title with network/raw evidence preferred over polluted DOM text. */
export function extractEffectiveTitleV21(item) {
  const raw = rawObject(item);
  const rawCard = String(raw.raw_card_text ?? '').split(/\s*Open in new tab[\s\S]*$/i)[0]
    .replace(/^(?:(?:top\s*pick|quick\s*look|selection|top\s*rated|best[- ]selling\s*item)\s*)+/i, '').trim();
  const candidates = [
    raw.network_title, raw.networkTitle, raw.structured_title, raw.structuredTitle,
    raw.raw_card_title, rawCard, raw.title,
    item.networkTitle, item.sourceObservationTitle, item.latestSourceObservationTitle,
    item.snapshotTitle, item.title,
  ];
  const title = candidates.map(cleanCandidate).find(Boolean) ?? '';
  const tokens = title.split(/\s+/).filter(Boolean);
  const titleQuality = !title || GENERIC_TITLE.test(title) || tokens.length < 2 || title.length < 8 ? 'LOW' : 'HIGH';
  const titleSource = candidates.map(cleanCandidate).findIndex(Boolean);
  const sourceNames = ['network_title','networkTitle','structured_title','structuredTitle','raw_card_title','raw_card_text','raw.title','item.networkTitle','sourceObservationTitle','latestSourceObservationTitle','snapshotTitle','item.title'];
  return { title, titleQuality, titleSource: sourceNames[titleSource] ?? 'none' };
}

export function fastTitleMatch(title) {
  const lower = String(title ?? '').toLowerCase();
  return FAST_TITLE_RULES.find(([, pattern]) => pattern.test(lower))?.[0] ?? null;
}

function fastCluster(match, base) {
  const map = {
    seat: '座椅/坐垫', spark_plug: '火花塞', drive_belt: '传动皮带', foot_control: '脚踏/拉杆',
    grip_handlebar: '把套/车把', storage_bag: '包类', cover: '车罩', guard_protector: '护杠/护手',
    mount_bracket: '安装支架/转接件', fastener: '螺丝/紧固件', maintenance: '维修保养件',
    appearance: '外观改装件', mirror: '后视镜', electronic: '电子/认证风险', anti_theft: '防盗锁具',
  };
  return map[match] ?? base.similarProductCluster ?? '未知';
}

/**
 * V2.1 fast path: clear product entities are classified from title only and
 * never sent to visual review. Ambiguous/conflicting titles become candidates.
 */
export function classifyWaitingProductV21(item, { imageAvailable = false, visualReview = false } = {}) {
  const effective = extractEffectiveTitleV21(item);
  const title = effective.title;
  const base = classifyOpportunityProduct({ ...item, title, imageUrl: null, imageEvidence: 'not_assessed' });
  const match = fastTitleMatch(title);
  const titleClear = effective.titleQuality !== 'LOW' && Boolean(match || (base.productType !== '其它/待细分' && !base.evidenceConflict));
  const titleConflict = Boolean(base.evidenceConflict);
  const visualCandidate = !titleClear || titleConflict;

  if (visualCandidate && visualReview) {
    const reviewed = classifyWaitingProductV2(item, { imageAvailable });
    return { ...reviewed, title, titleQuality: effective.titleQuality, titleSource: effective.titleSource,
      titleFastPath: false, visualReviewCandidate: true, visualReviewStatus: 'REVIEWED' };
  }

  const cluster = fastCluster(match, base);
  const formal = titleClear && !titleConflict && !base.hardExclusions.length
    && base.productType !== '其它/待细分' && base.level3Segment !== '其它/待细分';
  const clusterOnly = !formal && titleClear && !titleConflict && !base.hardExclusions.length && match !== 'electronic';
  const outcome = formal ? 'FORMALLY_RECLASSIFIED' : clusterOnly ? 'CLUSTERED_BUT_STILL_WAITING' : 'STILL_UNCLUSTERED';
  const reason = base.hardExclusions.length
    ? `电子/认证风险排除：${base.hardExclusions.join(', ')}`
    : formal
      ? `Fast Title Rule 命中明确实体“${cluster}”；跳过视觉复核`
      : clusterOnly
        ? `Fast Title Rule 命中“${cluster}”；taxonomy 节点不足，保留待细分并跳过视觉复核`
        : titleConflict ? '标题与规则证据冲突，进入视觉复核候选' : '标题不足以确认唯一产品实体，进入视觉复核候选';
  return {
    ...base,
    title,
    titleEvidence: title || 'none',
    imageEvidence: visualCandidate ? (imageAvailable ? 'not_assessed' : 'unavailable') : 'not_assessed',
    evidenceAgreement: false,
    evidenceConflict: titleConflict,
    classificationEvidence: titleClear ? 'title' : 'none',
    classificationConfidence: formal ? Math.max(0.88, base.confidence) : clusterOnly ? 0.82 : Math.min(0.55, base.confidence),
    similarProductCluster: cluster,
    similarProductGroup: cluster === '未知' ? '未知' : `${cluster}|title-fast-rule`,
    classificationReason: reason,
    outcome,
    titleQuality: effective.titleQuality,
    titleSource: effective.titleSource,
    titleFastPath: titleClear,
    visualReviewCandidate: visualCandidate,
    visualReviewStatus: visualCandidate ? 'PENDING' : 'SKIPPED_TITLE_CLEAR',
    manualReviewRequired: !formal || base.manualReviewRequired,
  };
}

export function applyWaitingClassificationV21(result, imageStatusByGoodsId = new Map(), { waitingIds = null, visualResults = new Map() } = {}) {
  const waiting = result.items.filter(item => item.productType === '其它/待细分'
    && (waitingIds ? waitingIds.has(String(item.goodsId)) : true));
  const processed = new Map();
  for (const item of waiting) {
    const id = String(item.goodsId);
    const visual = visualResults.get(id);
    processed.set(id, { ...item, ...(visual ?? classifyWaitingProductV21(item, { imageAvailable: imageStatusByGoodsId.get(id), visualReview: false })), groupingV21: true });
  }
  const items = result.items.map(item => processed.get(String(item.goodsId)) ?? { ...item, similarProductGroup: item.similarProductGroup ?? item.similarProductCluster ?? '未知' });
  const rows = [...processed.values()];
  const counts = {
    formallyReclassified: rows.filter(x => x.outcome === 'FORMALLY_RECLASSIFIED').length,
    clusteredButStillWaiting: rows.filter(x => x.outcome === 'CLUSTERED_BUT_STILL_WAITING').length,
    stillUnclustered: rows.filter(x => x.outcome === 'STILL_UNCLUSTERED').length,
    visualCandidates: rows.filter(x => x.visualReviewCandidate).length,
    visualSkippedTitleClear: rows.filter(x => !x.visualReviewCandidate).length,
    titleLow: rows.filter(x => x.titleQuality === 'LOW').length,
    evidenceConflict: rows.filter(x => x.evidenceConflict).length,
  };
  const conservation = waiting.length === counts.formallyReclassified + counts.clusteredButStillWaiting + counts.stillUnclustered;
  return { ...result, items, summary: { ...(result.summary ?? {}), salesDataStatus: 'SALES_DATA_SUSPENDED', ...counts }, v21: { ...counts, waitingBefore: waiting.length, conservation }, sortOptions: { salesDescending: false } };
}

export function buildWaitingClassificationReportV21(items) {
  const rows = items.filter(x => x.groupingV21).map(x => ({
    goods_id: String(x.goodsId), title: x.title, title_quality: x.titleQuality, title_source: x.titleSource,
    title_fast_path: Boolean(x.titleFastPath), visual_review_candidate: Boolean(x.visualReviewCandidate),
    title_evidence: x.titleEvidence, image_evidence: x.imageEvidence, evidence_agreement: Boolean(x.evidenceAgreement),
    evidence_conflict: Boolean(x.evidenceConflict), classification_confidence: x.classificationConfidence,
    classification_reason: x.classificationReason, level1_scene: x.level1Scene, product_type: x.productType,
    level3_segment: x.level3Segment, similar_cluster: x.similarProductCluster, similar_product_group: x.similarProductGroup,
    outcome: x.outcome, needs_review: Boolean(x.manualReviewRequired), image_url: x.imageUrl ?? null,
  }));
  return { rows, counts: {
    formally_reclassified: rows.filter(x => x.outcome === 'FORMALLY_RECLASSIFIED').length,
    clustered_but_still_waiting: rows.filter(x => x.outcome === 'CLUSTERED_BUT_STILL_WAITING').length,
    still_unclustered: rows.filter(x => x.outcome === 'STILL_UNCLUSTERED').length,
    visual_candidates: rows.filter(x => x.visual_review_candidate).length,
    title_clear_skipped_visual: rows.filter(x => !x.visual_review_candidate).length,
  } };
}
