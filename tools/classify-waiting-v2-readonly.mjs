import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createOpportunityAnalysisService } from '../src/modules/opportunity/opportunity-analysis-service.mjs';
import { resolveEvidence } from '../src/modules/evidence/evidence-repair.mjs';
import { applyWaitingClassificationV2, buildWaitingClassificationReport } from '../src/modules/opportunity/opportunity-v2.mjs';
import { buildGroupingQa } from '../src/modules/opportunity/opportunity-grouping.mjs';
import { exportOpportunityWorkbook } from '../src/modules/opportunity/opportunity-workbook.mjs';

const outputDir = path.resolve(process.argv[2] ?? 'outputs/opportunity-classification-v2-2135-20260828');
const config = await loadConfig('config.json');
const db = openDatabase(config.app.databasePath, { readOnly: true });
let result, evidenceByKey, integrity, coreBefore;
try {
  const service = createOpportunityAnalysisService(db);
  result = service.getResult();
  coreBefore = service.getResult().coreCounts;
  integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  evidenceByKey = new Map(resolveEvidence(db, result.items).map(x => [`${x.platform}\u001f${x.goods_id}`, x]));
} finally { db.close(); }

const globalCache = path.resolve('outputs/week1-mvp/image-cache');
const legacyCache = path.resolve('backups/day6-baseline-1500-20260827/.catalog-images');
// Frozen from the first-round workbook QA. The current classifier has since
// gained extra heuristics; using its live output here would silently change
// the 593-item V2 baseline. These 14 ids were already clustered and are not
// reprocessed by this round.
const firstRoundClusteredIds = new Set([
  '601102785889782', '601100189584806', '601101378452674', '601100471708285',
  '601103079542065', '601099912963165', '601103360754096', '606570779926917',
  '606034194230547', '601103063160532', '606366836076550', '601099526863280',
  '601099588097218', '601103975016385',
]);
const imageStatus = new Map();
async function hasCachedImage(goodsId) {
  for (const dir of [globalCache, legacyCache]) {
    for (const ext of ['.avif', '.webp', '.jpg', '.jpeg', '.png']) {
      try { await fs.access(path.join(dir, `${goodsId}${ext}`)); return true; } catch { /* continue */ }
    }
  }
  return false;
}
for (const item of result.items) {
  if (item.productType !== '其它/待细分') continue;
  if (firstRoundClusteredIds.has(String(item.goodsId))) continue;
  imageStatus.set(String(item.goodsId), await hasCachedImage(String(item.goodsId)));
}

const v2WaitingIds = new Set(result.items.filter(item => item.productType === '其它/待细分' && !firstRoundClusteredIds.has(String(item.goodsId))).map(item => String(item.goodsId)));
const v2 = applyWaitingClassificationV2(result, imageStatus, { waitingIds: v2WaitingIds });
const report = buildWaitingClassificationReport(v2.items);
const groupedQa = buildGroupingQa(v2.items, { salesDescending: false });
const waitingBefore = report.rows.length;
const imageAvailable = report.rows.filter(x => x.image_evidence !== 'unavailable').length;
const imageUnavailable = waitingBefore - imageAvailable;
const categoryCounts = Object.fromEntries([...new Set(report.rows.map(x => x.similar_cluster))].sort().map(cluster => [cluster, report.rows.filter(x => x.similar_cluster === cluster).length]));
const manualSamples = {};
const manualSampleAvailability = {};
for (const [name, matcher, limit] of [
  ['covers', 'cover|车罩', 15], ['fasteners', 'screw|bolt|nut|washer|fastener|gasket|螺丝|螺栓|螺母|垫片|紧固件', 15],
  ['brackets', 'bracket|mount|holder|adapter|支架|转接件', 15], ['bags', 'bag|pouch|luggage|saddlebag|包', 15],
  ['mirrors', 'mirror|后视镜', 10], ['controls', 'lever|peg|grip|handlebar|throttle|拉杆|踏杆|把套|脚踏', 10],
  ['protection', 'slider|crash|guard|protector|pad|cushion|滑块|防摔块|护杠|护手|发动机', 10],
]) {
  // Keep the audit sample tied to the V2 waiting set, but allow a title-only
  // match when the conservative taxonomy deliberately leaves an item unknown.
  const candidates = report.rows.filter(x => new RegExp(matcher, 'i').test([
    x.title, x.title_evidence, x.image_evidence, x.similar_cluster, x.product_type, x.level3_segment,
  ].join(' ')));
  manualSamples[name] = candidates.slice(0, limit).map(x => x.goods_id);
  manualSampleAvailability[name] = { requested: limit, available: candidates.length, sampled: manualSamples[name].length };
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'waiting-classification-v2.json'), JSON.stringify({
  generated_at: new Date().toISOString(), snapshot_id: result.snapshot.id, active_pool_version: result.snapshot.sourcePoolVersionId,
  sales_data_status: 'SALES_DATA_SUSPENDED', production_db_modified: false, integrity, core_before: coreBefore,
  waiting_before: waitingBefore, image_available: imageAvailable, image_unavailable: imageUnavailable,
  formally_reclassified: report.counts.formally_reclassified, clustered_but_still_waiting: report.counts.clustered_but_still_waiting,
  still_unclustered: report.counts.still_unclustered, conservation: report.counts.formally_reclassified + report.counts.clustered_but_still_waiting + report.counts.still_unclustered === waitingBefore,
  similar_cluster_count: new Set(report.rows.map(x => x.similar_cluster).filter(x => x !== '未知')).size,
  category_counts: categoryCounts, groupingQa: groupedQa, manualSamples, manualSampleAvailability, rows: report.rows,
}, null, 2));
const csvHeader = ['goods_id', 'title', 'title_evidence', 'image_evidence', 'evidence_agreement', 'evidence_conflict', 'classification_confidence', 'classification_reason', 'level1_scene', 'product_type', 'level3_segment', 'similar_cluster', 'similar_product_group', 'outcome', 'needs_review', 'image_url'];
const csv = [csvHeader, ...report.rows.map(row => csvHeader.map(key => row[key] ?? ''))].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
await fs.writeFile(path.join(outputDir, 'waiting-classification-v2.csv'), `\ufeff${csv}`);

const workbook = await exportOpportunityWorkbook(v2, { outputDir, fileName: 'catalog-active-pool-2135-classification-v2.xlsx', evidenceByKey });
await fs.writeFile(path.join(outputDir, 'classification-v2-qa.json'), JSON.stringify({
  waiting_before: waitingBefore, formally_reclassified: report.counts.formally_reclassified,
  clustered_but_still_waiting: report.counts.clustered_but_still_waiting, still_unclustered: report.counts.still_unclustered,
  image_available: imageAvailable, image_unavailable: imageUnavailable, conservation: v2.v2.conservation,
  groupingQa: groupedQa, workbook, production_db_modified: false, integrity, active_pool_before_after: [coreBefore.activeMemberships, coreBefore.activeMemberships],
}, null, 2));
console.log(JSON.stringify({ outputDir, snapshot: result.snapshot, waiting_before: waitingBefore, ...report.counts,
  image_available: imageAvailable, image_unavailable: imageUnavailable, conservation: v2.v2.conservation,
  groupingQa: groupedQa, workbook, production_db_modified: false, integrity }, null, 2));
