import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createOpportunityAnalysisService } from '../src/modules/opportunity/opportunity-analysis-service.mjs';
import { extractEffectiveTitleV21, classifyWaitingProductV21 } from '../src/modules/opportunity/opportunity-v21.mjs';

const started = performance.now();
const config = await loadConfig('config.json');
const db = openDatabase(config.app.databasePath, { readOnly: true });
let result;
try { result = createOpportunityAnalysisService(db).getResult(); } finally { db.close(); }
const firstRoundClusteredIds = new Set([
  '601102785889782', '601100189584806', '601101378452674', '601100471708285',
  '601103079542065', '601099912963165', '601103360754096', '606570779926917',
  '606034194230547', '601103063160532', '606366836076550', '601099526863280',
  '601099588097218', '601103975016385',
]);
const waiting = result.items.filter(item => item.productType === '其它/待细分' && !firstRoundClusteredIds.has(String(item.goodsId)));
const imageDirs = [path.resolve('outputs/week1-mvp/image-cache'), path.resolve('backups/day6-baseline-1500-20260827/.catalog-images')];
const imagePaths = new Map();
const imagePrepareStart = performance.now();
for (const dir of imageDirs) {
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
const titleQualityCounts = { HIGH: 0, LOW: 0 };
const ruleCounts = { formal: 0, clusterOnly: 0, unknown: 0, visualCandidates: 0 };
const titleSamples = [];
for (const item of waiting) {
  const effective = extractEffectiveTitleV21(item);
  titleQualityCounts[effective.titleQuality] = (titleQualityCounts[effective.titleQuality] ?? 0) + 1;
  for (const token of effective.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(x => x.length > 2)) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  const classified = classifyWaitingProductV21(item, { imageAvailable: imagePaths.has(String(item.goodsId)) });
  if (classified.outcome === 'FORMALLY_RECLASSIFIED') ruleCounts.formal++;
  else if (classified.outcome === 'CLUSTERED_BUT_STILL_WAITING') ruleCounts.clusterOnly++;
  else ruleCounts.unknown++;
  if (classified.visualReviewCandidate) ruleCounts.visualCandidates++;
  if (titleSamples.length < 10) titleSamples.push({ goods_id: item.goodsId, title: effective.title, title_quality: effective.titleQuality, title_source: effective.titleSource });
}
const tokenFrequencyMs = Math.round(performance.now() - tokenStart);
const lowQuality = waiting.filter(item => extractEffectiveTitleV21(item).titleQuality === 'LOW').length;
const estimate = {
  generated_at: new Date().toISOString(), waiting_count: waiting.length, title_quality: titleQualityCounts,
  image_cache_coverage: { available: waiting.filter(item => imagePaths.has(String(item.goodsId))).length, unavailable: waiting.filter(item => !imagePaths.has(String(item.goodsId))).length },
  rule_coverage_estimate: { formal: ruleCounts.formal, cluster_only: ruleCounts.clusterOnly, unknown: ruleCounts.unknown },
  visual_candidate_estimate: ruleCounts.visualCandidates, low_quality_title_count: lowQuality,
  top_tokens: [...tokenCounts].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([token, count]) => ({ token, count })),
  title_samples: titleSamples, timings_ms: { load_data_ms: Math.round(started - started), token_frequency_ms: tokenFrequencyMs, image_prepare_ms: imagePrepareMs, total_ms: Math.round(performance.now() - started) },
  expected_runtime: ruleCounts.visualCandidates <= 150 ? '30–45 minutes; visual review limited to candidates' : 'NOT READY: visual candidates exceed 150; expand title rules first',
  ready: ruleCounts.visualCandidates <= 150,
};
console.log(JSON.stringify(estimate, null, 2));
