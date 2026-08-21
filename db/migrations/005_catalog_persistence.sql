-- migrate: foreign_keys=off

DROP VIEW IF EXISTS v_current_products;

CREATE TABLE products_day4 (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'temu',
  external_product_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_domain TEXT NOT NULL DEFAULT 'www.temu.com',
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','gone','unknown')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  raw_identity_json TEXT,
  UNIQUE(platform, external_product_id)
) STRICT;

INSERT INTO products_day4(
  id,platform,external_product_id,canonical_url,source_domain,title,status,
  first_seen_at,last_seen_at,raw_identity_json
)
SELECT id,'temu',goods_id,canonical_url,source_domain,title,'active',
       first_seen_at,last_seen_at,raw_identity_json
FROM products;

DROP TABLE products;
ALTER TABLE products_day4 RENAME TO products;

CREATE TABLE catalog_memberships_day4 (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  site_country TEXT NOT NULL,
  language TEXT NOT NULL,
  currency TEXT NOT NULL,
  primary_category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  source_page_url TEXT,
  sort_order TEXT NOT NULL,
  current_rank INTEGER CHECK(current_rank IS NULL OR current_rank > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE RESTRICT,
  UNIQUE(product_id,site_country,language,currency,primary_category,subcategory,sort_order)
) STRICT;

INSERT INTO catalog_memberships_day4(
  product_id,site_country,language,currency,primary_category,subcategory,
  source_page_url,sort_order,current_rank,active,first_seen_at,last_seen_at,last_job_id
)
SELECT cm.product_id,cm.site_country,cm.language,cm.currency,cm.primary_category,cm.subcategory,
       NULL,cm.sort_order,cm.listing_rank,cm.active,MIN(cm.seen_at),MAX(cm.seen_at),
       (SELECT cm2.job_id FROM catalog_memberships cm2
        WHERE cm2.product_id=cm.product_id AND cm2.membership_key=cm.membership_key
        ORDER BY cm2.seen_at DESC,cm2.id DESC LIMIT 1)
FROM catalog_memberships cm
GROUP BY cm.product_id,cm.site_country,cm.language,cm.currency,
         cm.primary_category,cm.subcategory,cm.sort_order;

DROP TABLE catalog_memberships;
ALTER TABLE catalog_memberships_day4 RENAME TO catalog_memberships;

CREATE TABLE product_snapshots_day4 (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  price_amount REAL,
  original_price_amount REAL,
  discount_percent REAL,
  currency TEXT,
  sales_count INTEGER,
  rating REAL,
  review_count INTEGER,
  listing_rank INTEGER,
  shop_name TEXT,
  image_url TEXT,
  availability TEXT,
  extraction_quality REAL,
  missing_fields_json TEXT,
  raw_json TEXT,
  UNIQUE(job_id, product_id)
) STRICT;

INSERT INTO product_snapshots_day4(
  id,job_id,product_id,captured_at,source_url,title,price_amount,currency,
  sales_count,rating,review_count,listing_rank,availability,raw_json
)
SELECT id,job_id,product_id,captured_at,source_url,title,price_amount,currency,
       sales_count,rating,review_count,listing_rank,availability,raw_json
FROM product_snapshots;

DROP TABLE product_snapshots;
ALTER TABLE product_snapshots_day4 RENAME TO product_snapshots;

CREATE UNIQUE INDEX idx_products_platform_external
  ON products(platform, external_product_id);
CREATE INDEX idx_products_last_seen ON products(last_seen_at);
CREATE INDEX idx_memberships_scope_rank ON catalog_memberships(
  site_country,language,currency,primary_category,subcategory,sort_order,active,current_rank
);
CREATE INDEX idx_memberships_product_seen ON catalog_memberships(product_id,last_seen_at DESC);
CREATE INDEX idx_snapshots_product_captured ON product_snapshots(product_id,captured_at DESC);
CREATE INDEX idx_snapshots_job ON product_snapshots(job_id);

CREATE VIEW v_current_products AS
SELECT p.id,p.platform,p.external_product_id AS goods_id,p.canonical_url,
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
