ALTER TABLE products ADD COLUMN source_url TEXT;

DROP VIEW IF EXISTS v_current_products;

CREATE VIEW v_current_products AS
SELECT p.id,p.platform,p.external_product_id AS goods_id,p.source_url,p.canonical_url,
       COALESCE(s.title,p.title) AS title,p.status,p.first_seen_at,p.last_seen_at,
       m.site_country,m.language,m.currency,m.primary_category,m.subcategory,
       m.sort_order,m.current_rank AS listing_rank,m.active,
       s.price_amount,s.sales_count,s.rating,s.review_count,s.image_url,s.captured_at
FROM products p
JOIN catalog_memberships m ON m.product_id=p.id AND m.active=1
LEFT JOIN product_snapshots s ON s.id=(
  SELECT ps.id FROM product_snapshots ps WHERE ps.product_id=p.id
  ORDER BY ps.captured_at DESC,ps.id DESC LIMIT 1
);
