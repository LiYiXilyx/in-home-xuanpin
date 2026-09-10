const COMPLETENESS_FIELDS = [
  ['canonical_url','canonical_url_completeness'],['title','title_completeness'],
  ['price_amount','price_completeness'],['image_url','image_completeness'],
  ['sales_count','sales_count_completeness'],['rating','rating_completeness'],
  ['review_count','review_count_completeness'],['listing_rank','rank_completeness']
];

export function checkCatalogQuality(products, options = {}) {
  const total = products.length;
  const ids = products.map(item => String(item.goods_id ?? '')).filter(Boolean);
  const uniqueCount = new Set(ids).size;
  const duplicateCount = Math.max(0, total - uniqueCount);
  const imageUrls = products.map(item => item.image_url).filter(Boolean);
  const duplicateImageCount = imageUrls.length - new Set(imageUrls).size;
  const invalidImage = products.filter(item => item.image_url && !isHttpUrl(item.image_url));
  const numericAnomalies = products.filter(item => hasNumericAnomaly(item));
  const samples = {
    duplicate_goods_id: duplicateSamples(ids),
    numeric_range: numericAnomalies.slice(0, 20).map(item => item.goods_id),
    image_url: invalidImage.slice(0, 20).map(item => item.goods_id)
  };
  const thresholds = {
    title: options.minTitleCompleteness ?? 0.5,
    price_amount: options.minPriceCompleteness ?? 0.5,
    image_url: options.minImageCompleteness ?? 0.5,
    duplicate_image_rate: options.maxDuplicateImageRate ?? 0.1
  };
  const metrics = [metric('unique_goods_id', uniqueCount, total, 'count', uniqueCount === total, samples.duplicate_goods_id),
    metric('duplicate_rate', ratio(duplicateCount,total), 0, 'ratio', duplicateCount === 0, samples.duplicate_goods_id)];
  for (const [field, code] of COMPLETENESS_FIELDS) {
    const value = ratio(products.filter(item => present(item[field])).length,total);
    const threshold = field === 'canonical_url' || field === 'listing_rank' ? 1 : (thresholds[field] ?? 0);
    metrics.push(metric(code,value,threshold,'ratio',value >= threshold,
      products.filter(item => !present(item[field])).slice(0,20).map(item => item.goods_id)));
  }
  metrics.push(metric('numeric_range_anomalies',numericAnomalies.length,0,'count',numericAnomalies.length === 0,samples.numeric_range));
  metrics.push(metric('image_url_anomalies',invalidImage.length,0,'count',invalidImage.length === 0,samples.image_url));
  metrics.push(metric('duplicate_image_url_rate',ratio(duplicateImageCount,imageUrls.length),thresholds.duplicate_image_rate,
    'ratio',ratio(duplicateImageCount,imageUrls.length) <= thresholds.duplicate_image_rate,duplicateImageSamples(imageUrls)));
  return { total,uniqueGoodsId: uniqueCount,duplicateCount,duplicateRate: ratio(duplicateCount,total),metrics,
    passed: metrics.every(item => item.passed),samples };
}

export function saveQualityChecks(db, jobId, report, { now = () => new Date().toISOString() } = {}) {
  const statement = db.prepare(`INSERT INTO data_quality_checks(
    job_id,check_code,scope,passed,metric_value,threshold_value,details_json,checked_at
  ) VALUES(?,?,'job',?,?,?,?,?)
  ON CONFLICT(job_id,check_code,scope) DO UPDATE SET passed=excluded.passed,
    metric_value=excluded.metric_value,threshold_value=excluded.threshold_value,
    details_json=excluded.details_json,checked_at=excluded.checked_at`);
  for (const item of report.metrics) {
    statement.run(jobId,item.code,item.passed ? 1 : 0,item.actual,item.threshold,
      JSON.stringify({ unit: item.unit, samples: item.samples }),now());
  }
  return report.metrics.length;
}

function metric(code,actual,threshold,unit,passed,samples=[]) { return { code,actual,threshold,unit,passed,samples }; }
function present(value) { return value !== null && value !== undefined && value !== ''; }
function ratio(value,total) { return total ? Number((value / total).toFixed(6)) : 0; }
function isHttpUrl(value) { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } }
function hasNumericAnomaly(item) {
  return (present(item.price_amount) && (item.price_amount <= 0 || item.price_amount > 1_000_000)) ||
    (present(item.sales_count) && (item.sales_count < 0 || item.sales_count > 1_000_000_000)) ||
    (present(item.rating) && (item.rating < 0 || item.rating > 5)) ||
    (present(item.review_count) && (item.review_count < 0 || item.review_count > 1_000_000_000)) ||
    (present(item.listing_rank) && (!Number.isInteger(item.listing_rank) || item.listing_rank < 1));
}
function duplicateSamples(values) {
  const seen = new Set(); const duplicates = new Set();
  for (const value of values) { if (seen.has(value)) duplicates.add(value); seen.add(value); }
  return [...duplicates].slice(0,20);
}
function duplicateImageSamples(values) { return duplicateSamples(values); }
