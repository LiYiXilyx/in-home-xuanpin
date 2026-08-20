import fs from 'node:fs/promises';
import path from 'node:path';
import { validateListingPage } from './listing-validator.mjs';
import { collectListingProducts } from './listing-scroll.mjs';

export const QUALITY_FIELDS = [
  'goods_id', 'canonical_url', 'title', 'image_url', 'price_amount', 'sales_count', 'rating', 'review_count',
  'listing_rank', 'site_country', 'language', 'currency', 'primary_category', 'subcategory', 'sort_order', 'captured_at'
];

export async function captureCurrentPage(page, config, job, options = {}) {
  const jobId = options.jobId ?? 'untracked';
  const debugDir = path.join(config.export?.outputDir ?? config.outputDir, 'debug', safeName(jobId));
  try {
    const validation = await (options.validatePage ?? validateListingPage)(page, config, job);
    const capturedAt = options.capturedAt ?? new Date().toISOString();
    const collected = await (options.collectProducts ?? collectListingProducts)(page, config, job, {
      ...options, capturedAt,
      onRound: state => {
        options.onRound?.(state);
        if (!options.quiet) process.stdout.write(`发现唯一商品 ${state.discovered}/${state.targetCount}\r`);
      }
    });
    if (!options.quiet) process.stdout.write('\n');
    const quality = buildQualityReport(collected.products, collected);
    return { ...collected, validation: summarizeValidation(validation), quality, capturedAt, sourceUrl: sanitizeListingUrl(page.url()) };
  } catch (error) {
    await saveFailureEvidence(page, debugDir, error).catch(() => {});
    throw error;
  }
}

export function buildQualityReport(products, collection = {}) {
  const missingFields = Object.fromEntries(QUALITY_FIELDS.map(field => [field, 0]));
  for (const product of products) {
    for (const field of QUALITY_FIELDS) if (product[field] === null || product[field] === '') missingFields[field] += 1;
  }
  const total = products.length;
  const completeness = Object.fromEntries(QUALITY_FIELDS.map(field => [field,
    total === 0 ? 0 : Number((((total - missingFields[field]) / total) * 100).toFixed(2))
  ]));
  const uniqueGoodsIds = new Set(products.map(item => item.goods_id).filter(Boolean)).size;
  return {
    discovered_count: Number(collection.totalOccurrences ?? total), product_count: total,
    unique_goods_id_count: uniqueGoodsIds,
    duplicate_count: Number(collection.duplicateOccurrences ?? Math.max(0, total - uniqueGoodsIds)),
    duplicate_rate: Number(collection.totalOccurrences ?? total) === 0 ? 0
      : Number(((Number(collection.duplicateOccurrences ?? 0) / Number(collection.totalOccurrences ?? total)) * 100).toFixed(2)),
    completeness_percent: completeness, missing_fields: missingFields, samples: products.slice(0, 5)
  };
}

export function printQualityPreview(result, log = console.log) {
  log('--- Day 3 持久化前质量预览 ---');
  log(`当前发现商品观察总数：${result.quality.discovered_count}`);
  log(`去重后商品总数：${result.quality.product_count}`);
  log(`唯一 goods_id 数：${result.quality.unique_goods_id_count}`);
  log(`重复数：${result.quality.duplicate_count}`);
  log(`字段完整率：${JSON.stringify(result.quality.completeness_percent)}`);
  log(`缺失字段统计：${JSON.stringify(result.quality.missing_fields)}`);
  log(`前 5 条样本：${JSON.stringify(result.quality.samples, null, 2)}`);
}

export async function saveCaptureResult(result, config, jobId, extra = {}) {
  const dir = path.join(config.export?.outputDir ?? config.outputDir, 'debug', safeName(jobId));
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, 'catalog-result.json');
  await fs.writeFile(target, JSON.stringify({ ...result, ...extra }, null, 2), 'utf8');
  return target;
}
async function saveFailureEvidence(page, dir, error) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'failure.html'), await page.content(), 'utf8');
  await fs.writeFile(path.join(dir, 'failure.json'), JSON.stringify({
    code: error?.code ?? 'CAPTURE_FAILED', message: error?.message ?? String(error), captured_at: new Date().toISOString()
  }, null, 2), 'utf8');
  await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: false }).catch(() => {});
}
function summarizeValidation(value) { return { valid: value.valid, url: sanitizeListingUrl(value.url), productLinkCount: value.productLinkCount, htmlLang: value.htmlLang, expected: value.expected }; }
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, '_'); }

export function sanitizeListingUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
