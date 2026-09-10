import { classifyOpportunityProduct } from './opportunity-classifier.mjs';

const BADGE_PREFIX = /^(?:(?:top\s*pick|quick\s*look|selection|top\s*rated|best[- ]selling\s*item)\s*)+/i;
const OPEN_MARKER = /\s*Open in new tab[\s\S]*$/i;
const TITLE_GENERIC = /^(?:item picture|icon|image|photo|picture)$/i;

/**
 * Recover the human-readable card title without treating sales text as title
 * evidence. raw_card_text is kept as historical capture evidence by the
 * catalog pipeline and is only used here to repair the title field.
 */
export function extractEvidenceTitle(item) {
  let raw = item?.raw;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  let title = String(raw.raw_card_text ?? '').split(OPEN_MARKER)[0].trim();
  title = title.replace(BADGE_PREFIX, '').trim();
  if (!title || TITLE_GENERIC.test(title)) {
    title = String(raw.title ?? item?.title ?? '').replace(/^item picture\s*/i, '').trim();
  }
  return title.replace(/\s+/g, ' ').trim();
}

function hasLocalImage(item, imageAvailable) {
  if (imageAvailable !== undefined) return Boolean(imageAvailable);
  return Boolean(item?.imageUrl || item?.image_url);
}

function obviousConflict(title, classification) {
  const text = title.toLowerCase();
  if (/\b(?:bicycle|bike|e[- ]?bike|electric scooter|electric vehicle|tricycle|car|rv|mobility vehicle)\b/.test(text)
      && !/\b(?:motorcycle|motorbike|scooter|atv|quad|dirt bike)\b/.test(text)) return true;
  if (classification.hardExclusions.length && /\b(?:cover|bracket|bag|bolt|screw|stand|lever|peg)\b/.test(text)) return true;
  return false;
}

function imageDescription(classification, conflict, available) {
  if (!available) return 'unavailable';
  if (conflict) return '主图已查看：与标题产品实体存在冲突，需人工复核';
  if (classification.hardExclusions.length) return '主图已查看：电子/认证风险特征，保留排除审计';
  const cluster = classification.similarProductCluster;
  if (cluster && cluster !== '未知') return `主图已查看：视觉上与“${cluster}”一致`;
  return '主图已查看：未能确认唯一产品实体';
}

function similarProductGroup(title, cluster) {
  if (!cluster || cluster === '未知') return '未知';
  const tokens = title.toLowerCase()
    .replace(/\b(?:motorcycle|motorbike|scooter|atv|quad|universal|for|fit|fits|suitable|compatible|new|top|pick|quick|look|selection|outdoor|durable|premium|high[- ]quality)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean).slice(0, 7);
  return tokens.length ? `${cluster}|${tokens.join('-')}` : cluster;
}

/**
 * Classify one waiting item using repaired title evidence plus a separately
 * recorded visual review result. This function never uses sales fields.
 */
export function classifyWaitingProductV2(item, { imageAvailable } = {}) {
  const title = extractEvidenceTitle(item);
  const available = hasLocalImage(item, imageAvailable);
  const preliminary = classifyOpportunityProduct({
    ...item,
    title,
    imageUrl: available ? (item.imageUrl ?? item.image_url ?? null) : null,
    imageEvidence: available ? 'visual_reviewed' : 'unavailable',
  });
  const conflict = obviousConflict(title, preliminary);
  const imageEvidence = imageDescription(preliminary, conflict, available);
  const classification = classifyOpportunityProduct({
    ...item,
    title,
    imageUrl: available ? (item.imageUrl ?? item.image_url ?? null) : null,
    imageEvidence,
    evidenceConflict: conflict,
  });
  const titleClear = Boolean(title) && !TITLE_GENERIC.test(title);
  const knownCluster = classification.similarProductCluster && classification.similarProductCluster !== '未知';
  const agreement = available && titleClear && knownCluster && !conflict;
  const formal = agreement
    && !classification.hardExclusions.length
    && classification.productType !== '其它/待细分'
    && classification.level3Segment !== '其它/待细分';
  const clusterOnly = !formal && !classification.hardExclusions.length && knownCluster;
  const outcome = formal ? 'FORMALLY_RECLASSIFIED' : clusterOnly ? 'CLUSTERED_BUT_STILL_WAITING' : 'STILL_UNCLUSTERED';
  const confidence = formal ? Math.max(0.95, classification.confidence) : conflict ? Math.min(0.2, classification.confidence) : classification.confidence;
  const reason = formal
    ? `标题证据与主图一致；明确实体“${classification.similarProductCluster}”，允许正式归类`
    : clusterOnly
      ? `主图/标题支持相似簇“${classification.similarProductCluster}”，但正式 taxonomy 证据不足，保留待细分`
      : classification.hardExclusions.length
        ? `电子/认证风险排除：${classification.hardExclusions.join(', ')}`
        : conflict ? '标题与主图证据冲突，禁止自动归类' : '标题与主图均不足以确认唯一产品实体';
  return {
    ...classification,
    title,
    titleEvidence: title || 'none',
    imageEvidence,
    evidenceAgreement: agreement,
    evidenceConflict: conflict,
    classificationConfidence: confidence,
    classificationReason: reason,
    similarProductGroup: similarProductGroup(title, classification.similarProductCluster),
    outcome,
    manualReviewRequired: !formal || classification.manualReviewRequired,
  };
}

export function applyWaitingClassificationV2(result, imageStatusByGoodsId = new Map(), { waitingIds = null } = {}) {
  const originalWaiting = result.items.map(item => ({ item, classified: item }));
  const waiting = result.items
    .map(item => ({ item, classified: item }))
    .filter(({ item, classified }) => classified.productType === '其它/待细分'
      && (waitingIds ? waitingIds.has(String(item.goodsId)) : (!classified.similarProductCluster || classified.similarProductCluster === '未知')));
  const processed = new Map();
  for (const { item } of waiting) {
    const id = String(item.goodsId);
    const audit = classifyWaitingProductV2(item, { imageAvailable: imageStatusByGoodsId.get(id) });
    processed.set(id, { ...item, ...audit, groupingV2: true });
  }
  const items = result.items.map(item => {
    const id = String(item.goodsId);
    const override = processed.get(id);
    if (override) return override;
    return { ...item, similarProductGroup: item.similarProductGroup ?? (item.similarProductCluster ?? '未知') };
  });
  const counts = { formallyReclassified: 0, clusteredButStillWaiting: 0, stillUnclustered: 0, evidenceConflict: 0, imageUnavailable: 0,
    titleAndImageAssessed: 0, titleOnly: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 };
  for (const row of processed.values()) {
    if (row.outcome === 'FORMALLY_RECLASSIFIED') counts.formallyReclassified++;
    else if (row.outcome === 'CLUSTERED_BUT_STILL_WAITING') counts.clusteredButStillWaiting++;
    else counts.stillUnclustered++;
    if (row.evidenceConflict) counts.evidenceConflict++;
    if (row.imageEvidence === 'unavailable') counts.imageUnavailable++;
    if (row.evidenceAgreement) counts.titleAndImageAssessed++;
    else if (row.title && row.imageEvidence === 'unavailable') counts.titleOnly++;
    if (row.classificationConfidence >= 0.9) counts.highConfidence++;
    else if (row.classificationConfidence >= 0.5) counts.mediumConfidence++;
    else counts.lowConfidence++;
  }
  const waitingBefore = waiting.length;
  const conservation = waitingBefore === counts.formallyReclassified + counts.clusteredButStillWaiting + counts.stillUnclustered;
  const groupingItems = items.map(x => ({ ...x, classificationConfidence: x.classificationConfidence ?? x.confidence ?? 0 }));
  const summary = { ...(result.summary ?? {}), salesDataStatus: 'SALES_DATA_SUSPENDED', waitingBefore, ...counts,
    reductionRate: waitingBefore ? counts.formallyReclassified / waitingBefore : 0, conservation };
  return { ...result, items: groupingItems, summary, v2: { ...counts, waitingBefore, conservation }, sortOptions: { salesDescending: false } };
}

export function buildWaitingClassificationReport(items) {
  const rows = items.filter(x => x.groupingV2).map(x => ({
    goods_id: String(x.goodsId), title: x.title, title_evidence: x.titleEvidence, image_evidence: x.imageEvidence,
    evidence_agreement: Boolean(x.evidenceAgreement), evidence_conflict: Boolean(x.evidenceConflict),
    classification_confidence: x.classificationConfidence, classification_reason: x.classificationReason,
    level1_scene: x.level1Scene, product_type: x.productType, level3_segment: x.level3Segment,
    similar_cluster: x.similarProductCluster, similar_product_group: x.similarProductGroup,
    outcome: x.outcome, needs_review: Boolean(x.manualReviewRequired), image_url: x.imageUrl ?? null,
  }));
  return { rows, counts: {
    formally_reclassified: rows.filter(x => x.outcome === 'FORMALLY_RECLASSIFIED').length,
    clustered_but_still_waiting: rows.filter(x => x.outcome === 'CLUSTERED_BUT_STILL_WAITING').length,
    still_unclustered: rows.filter(x => x.outcome === 'STILL_UNCLUSTERED').length,
  } };
}
