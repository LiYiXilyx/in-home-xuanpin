export function createProductRepository(db, { now = () => new Date().toISOString() } = {}) {
  const select = db.prepare(`SELECT id,platform,external_product_id AS externalProductId,
    canonical_url AS canonicalUrl,title,status,first_seen_at AS firstSeenAt,last_seen_at AS lastSeenAt
    FROM products WHERE platform=? AND external_product_id=?`);
  const upsert = db.prepare(`INSERT INTO products(
    platform,external_product_id,canonical_url,source_domain,title,status,first_seen_at,last_seen_at,raw_identity_json
  ) VALUES(?,?,?,?,?,'active',?,?,?)
  ON CONFLICT(platform,external_product_id) DO UPDATE SET
    canonical_url=excluded.canonical_url,
    title=COALESCE(excluded.title,products.title),
    status='active',last_seen_at=excluded.last_seen_at,
    raw_identity_json=COALESCE(excluded.raw_identity_json,products.raw_identity_json)`);

  return {
    upsert(product, { platform = 'temu' } = {}) {
      const timestamp = product.captured_at ?? now();
      upsert.run(platform, String(product.goods_id), product.canonical_url,
        domainOf(product.canonical_url), product.title ?? null, timestamp, timestamp,
        JSON.stringify({ goods_id: String(product.goods_id), canonical_url: product.canonical_url }));
      return select.get(platform, String(product.goods_id));
    },
    find(platform, externalProductId) { return select.get(platform, String(externalProductId)) ?? null; },
    count() { return Number(db.prepare('SELECT COUNT(*) AS count FROM products').get().count); }
  };
}

function domainOf(value) {
  try { return new URL(value).hostname; } catch { return 'www.temu.com'; }
}
