export function createCatalogRepository(db) {
  const scopeWhere = `site_country=? AND language=? AND currency=? AND primary_category=? AND subcategory=? AND sort_order=?`;
  return {
    activeCount(scope) {
      return Number(db.prepare(`SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1 AND ${scopeWhere}`)
        .get(...scopeValues(scope)).count);
    },
    activeProductIds(scope) {
      return db.prepare(`SELECT product_id AS productId FROM catalog_memberships WHERE active=1 AND ${scopeWhere}`)
        .all(...scopeValues(scope)).map(row => Number(row.productId));
    },
    upsert(productId, scope, product, jobId) {
      const [siteCountry,language,currency,primaryCategory,subcategory,sortOrder] = scopeValues(scope);
      db.prepare(`INSERT INTO catalog_memberships(
        product_id,site_country,language,currency,primary_category,subcategory,source_page_url,sort_order,
        current_rank,active,first_seen_at,last_seen_at,last_job_id
      ) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)
      ON CONFLICT(product_id,site_country,language,currency,primary_category,subcategory,sort_order) DO UPDATE SET
        source_page_url=excluded.source_page_url,current_rank=excluded.current_rank,active=1,
        last_seen_at=excluded.last_seen_at,last_job_id=excluded.last_job_id`).run(
        productId,siteCountry,language,currency,primaryCategory,subcategory,scope.sourcePageUrl ?? null,sortOrder,
        product.listing_rank ?? null,
        product.captured_at, product.captured_at, jobId);
    },
    deactivateMissing(scope, activeProductIds, jobId, timestamp = new Date().toISOString()) {
      const ids = [...new Set(activeProductIds.map(Number))];
      const placeholders = ids.map(() => '?').join(',');
      const sql = `UPDATE catalog_memberships SET active=0,last_seen_at=?,last_job_id=?
        WHERE active=1 AND ${scopeWhere}${ids.length ? ` AND product_id NOT IN (${placeholders})` : ''}`;
      return Number(db.prepare(sql).run(timestamp, jobId, ...scopeValues(scope), ...ids).changes);
    },
    count(scope) {
      return Number(db.prepare(`SELECT COUNT(*) AS count FROM catalog_memberships WHERE ${scopeWhere}`)
        .get(...scopeValues(scope)).count);
    }
  };
}

export function scopeValues(scope) {
  return [scope.siteCountry,scope.language,scope.currency,scope.primaryCategory,scope.subcategory,scope.sortOrder];
}
