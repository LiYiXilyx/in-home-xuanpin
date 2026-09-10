import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createOpportunityAnalysisService } from '../src/modules/opportunity/opportunity-analysis-service.mjs';
import { resolveEvidence } from '../src/modules/evidence/evidence-repair.mjs';
import { applyWaitingClassificationV21, buildWaitingClassificationReportV21, extractEffectiveTitleV21 } from '../src/modules/opportunity/opportunity-v21.mjs';
import { buildGroupingQa } from '../src/modules/opportunity/opportunity-grouping.mjs';
import { exportOpportunityWorkbook } from '../src/modules/opportunity/opportunity-workbook.mjs';

const outputDir = path.resolve(process.argv[2] ?? 'outputs/opportunity-classification-v2.1-2135-20260828');
const started = performance.now();
const config = await loadConfig('config.json');
const db = openDatabase(config.app.databasePath, { readOnly: true });
let result, evidenceByKey, integrity, coreBefore;
const loadStart = performance.now();
try {
  const service = createOpportunityAnalysisService(db);
  result = service.getResult();
  coreBefore = result.coreCounts;
  integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  evidenceByKey = new Map(resolveEvidence(db, result.items).map(x => [`${x.platform}\u001f${x.goods_id}`, x]));
} finally { db.close(); }
const loadDataMs = Math.round(performance.now() - loadStart);

const firstRoundClusteredIds = new Set([
  '601102785889782', '601100189584806', '601101378452674', '601100471708285',
  '601103079542065', '601099912963165', '601103360754096', '606570779926917',
  '606034194230547', '601103063160532', '606366836076550', '601099526863280',
  '601099588097218', '601103975016385',
]);
const waiting = result.items.filter(item => item.productType === '其它/待细分' && !firstRoundClusteredIds.has(String(item.goodsId)));
const waitingIds = new Set(waiting.map(item => String(item.goodsId)));

// One directory scan replaces per-item fs.access calls.
const imagePrepareStart = performance.now();
const imagePaths = new Map();
for (const dir of [path.resolve('outputs/week1-mvp/image-cache'), path.resolve('backups/day6-baseline-1500-20260827/.catalog-images')]) {
  let names = [];
  try { names = await fs.readdir(dir); } catch { continue; }
  for (const name of names) {
    const match = name.match(/^(\d+)(?:\.avif|\.webp|\.jpg|\.jpeg|\.png)$/i);
    if (match && !imagePaths.has(match[1])) imagePaths.set(match[1], path.join(dir, name));
  }
}
const imagePrepareMs = Math.round(performance.now() - imagePrepareStart);

const tokenStart = performance.now();
const tokenCounts = new Map();
const titleSources = {};
for (const item of waiting) {
  const effective = extractEffectiveTitleV21(item);
  titleSources[effective.titleSource] = (titleSources[effective.titleSource] ?? 0) + 1;
  for (const token of effective.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(x => x.length > 2)) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }
}
const tokenFrequencyMs = Math.round(performance.now() - tokenStart);

const ruleStart = performance.now();
const v21 = applyWaitingClassificationV21(result, new Map(waiting.map(item => [String(item.goodsId), imagePaths.has(String(item.goodsId))])), { waitingIds });
const report = buildWaitingClassificationReportV21(v21.items);
const ruleClassificationMs = Math.round(performance.now() - ruleStart);
const visualCandidates = report.rows.filter(row => row.visual_review_candidate);
const imageAvailable = waiting.filter(item => imagePaths.has(String(item.goodsId))).length;
const imageUnavailable = waiting.length - imageAvailable;
const sourceCount = report.rows.reduce((acc, row) => { acc[row.title_source] = (acc[row.title_source] ?? 0) + 1; return acc; }, {});
const categoryCounts = Object.fromEntries([...new Set(report.rows.map(x => x.similar_cluster))].sort().map(cluster => [cluster, report.rows.filter(x => x.similar_cluster === cluster).length]));
const finalizeStart = performance.now();
const visualReviewCandidates = visualCandidates.map(row => ({ goods_id: row.goods_id, title: row.title, title_quality: row.title_quality,
  provisional_product_type: row.product_type, provisional_cluster: row.similar_cluster, image_available: imagePaths.has(row.goods_id),
  visual_review_status: 'PENDING', reason: row.classification_reason }));
const finalizeMs = Math.round(performance.now() - finalizeStart);

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(path.join(outputDir, 'visual-sheets'), { recursive: true });
const writeStart = performance.now();
await fs.writeFile(path.join(outputDir, 'visual-review-candidates.json'), JSON.stringify({ count: visualReviewCandidates.length, candidates: visualReviewCandidates }, null, 2));
await fs.writeFile(path.join(outputDir, 'waiting-classification-v2.1.json'), JSON.stringify({
  generated_at: new Date().toISOString(), snapshot_id: result.snapshot.id, active_pool_version: result.snapshot.sourcePoolVersionId,
  sales_data_status: 'SALES_DATA_SUSPENDED', production_db_modified: false, integrity, core_before: coreBefore,
  waiting_before: report.rows.length, effective_title_sources: sourceCount, title_quality: {
    HIGH: report.rows.filter(x => x.title_quality === 'HIGH').length,
    LOW: report.rows.filter(x => x.title_quality === 'LOW').length,
  }, image_available: imageAvailable, image_unavailable: imageUnavailable,
  formally_reclassified: report.counts.formally_reclassified, clustered_but_still_waiting: report.counts.clustered_but_still_waiting,
  still_unclustered: report.counts.still_unclustered, visual_candidates: report.counts.visual_candidates,
  title_clear_skipped_visual: report.counts.title_clear_skipped_visual,
  conservation: report.rows.length === report.counts.formally_reclassified + report.counts.clustered_but_still_waiting + report.counts.still_unclustered,
  category_counts: categoryCounts, top_tokens: [...tokenCounts].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([token, count]) => ({ token, count })),
  visual_review_candidates: visualReviewCandidates, rows: report.rows,
}, null, 2));
const finalizeWriteMs = Math.round(performance.now() - writeStart);
const workbookStart = performance.now();
const workbook = await exportOpportunityWorkbook(v21, { outputDir, fileName: 'catalog-active-pool-2135-classification-v2.1.xlsx', evidenceByKey });
const excelExportMs = Math.round(performance.now() - workbookStart);
const qaStart = performance.now();
const groupingQa = buildGroupingQa(v21.items, { salesDescending: false });
const qaMs = Math.round(performance.now() - qaStart);
const counts = report.counts;
const totalMs = Math.round(performance.now() - started);
const runtime = { load_data_ms: loadDataMs, token_frequency_ms: tokenFrequencyMs, rule_classification_ms: ruleClassificationMs,
  secondary_evidence_ms: 0, image_prepare_ms: imagePrepareMs, visual_review_ms: 0, finalize_ms: finalizeMs + finalizeWriteMs,
  excel_export_ms: excelExportMs, qa_ms: qaMs, total_ms: totalMs };
const summary = `# Opportunity Classification V2.1 Fast Path Result\n\n- Input waiting: ${report.rows.length}\n- Effective title quality: HIGH ${runtime.title_quality_high ?? report.rows.filter(x => x.title_quality === 'HIGH').length}, LOW ${report.rows.filter(x => x.title_quality === 'LOW').length}\n- Title-clear visual skips: ${counts.title_clear_skipped_visual}\n- Visual candidates pending: ${counts.visual_candidates}\n- Formal: ${counts.formally_reclassified}; cluster-only: ${counts.clustered_but_still_waiting}; still unknown: ${counts.still_unclustered}\n- Production DB write: 0; integrity: ${integrity}\n- Active Pool before/after: ${coreBefore.activeMemberships}/${coreBefore.activeMemberships}\n- Runtime (ms): ${JSON.stringify(runtime)}\n- Slowest stage: ${Object.entries(runtime).filter(([key]) => key !== 'total_ms').sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none'}\n- Visual sheets: none generated; candidates are pending targeted review.\n`;
await fs.writeFile(path.join(outputDir, 'classification-v2.1-summary.md'), summary);
await fs.writeFile(path.join(outputDir, 'classification-v2.1-qa.json'), JSON.stringify({
  waiting_before: report.rows.length, ...counts, image_available: imageAvailable, image_unavailable: imageUnavailable,
  conservation: report.rows.length === counts.formally_reclassified + counts.clustered_but_still_waiting + counts.still_unclustered,
  groupingQa, runtime, slowest_stage: Object.entries(runtime).filter(([key]) => key !== 'total_ms').sort((a, b) => b[1] - a[1])[0]?.[0],
  production_db_modified: false, integrity, active_pool_before_after: [coreBefore.activeMemberships, coreBefore.activeMemberships], workbook,
}, null, 2));
console.log(JSON.stringify({ outputDir, waiting_before: report.rows.length, ...counts, image_available: imageAvailable, image_unavailable: imageUnavailable,
  conservation: report.rows.length === counts.formally_reclassified + counts.clustered_but_still_waiting + counts.still_unclustered,
  groupingQa, runtime, production_db_modified: false, integrity, workbook }, null, 2));
