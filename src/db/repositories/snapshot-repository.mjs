const SNAPSHOT_FIELDS = ['title','price_amount','original_price_amount','discount_percent','currency','sales_count',
  'rating','review_count','listing_rank','shop_name','image_url','availability','extraction_quality'];

export function createSnapshotRepository(db) {
  const insert = db.prepare(`INSERT INTO product_snapshots(
    job_id,product_id,captured_at,source_url,title,price_amount,original_price_amount,discount_percent,
    currency,sales_count,rating,review_count,listing_rank,shop_name,image_url,availability,
    extraction_quality,missing_fields_json,raw_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(job_id,product_id) DO NOTHING`);
  return {
    insert(jobId, productId, product) {
      const missing = SNAPSHOT_FIELDS.filter(field => product[field] === null || product[field] === undefined || product[field] === '');
      const result = insert.run(jobId,productId,product.captured_at ?? new Date().toISOString(),product.source_url ?? product.canonical_url,
        product.title ?? null, product.price_amount ?? null, product.original_price_amount ?? null,
        product.discount_percent ?? null, product.currency ?? null, product.sales_count ?? null,
        product.rating ?? null, product.review_count ?? null, product.listing_rank ?? null,
        product.shop_name ?? null, product.image_url ?? null, product.availability ?? 'unknown',
        product.extraction_quality ?? null, JSON.stringify(missing), JSON.stringify(product.raw ?? product));
      return { inserted: Number(result.changes) === 1 };
    },
    countForJob(jobId) { return Number(db.prepare('SELECT COUNT(*) AS count FROM product_snapshots WHERE job_id=?').get(jobId).count); },
    count() { return Number(db.prepare('SELECT COUNT(*) AS count FROM product_snapshots').get().count); }
  };
}
