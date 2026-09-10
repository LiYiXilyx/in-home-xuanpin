CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  goods_id TEXT NOT NULL UNIQUE,
  canonical_url TEXT NOT NULL,
  source_domain TEXT NOT NULL DEFAULT 'www.temu.com',
  title TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  raw_identity_json TEXT
) STRICT;

CREATE TABLE catalog_memberships (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  membership_key TEXT NOT NULL,
  site_country TEXT NOT NULL,
  language TEXT NOT NULL,
  currency TEXT NOT NULL,
  primary_category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  sort_order TEXT NOT NULL,
  listing_rank INTEGER CHECK(listing_rank IS NULL OR listing_rank > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  seen_at TEXT NOT NULL,
  UNIQUE(job_id, product_id, membership_key)
) STRICT;

CREATE TABLE product_snapshots (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  price_amount REAL,
  currency TEXT,
  sales_count INTEGER,
  rating REAL,
  review_count INTEGER,
  listing_rank INTEGER,
  availability TEXT,
  raw_json TEXT,
  UNIQUE(job_id, product_id)
) STRICT;

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_kind TEXT NOT NULL DEFAULT 'main',
  source_url TEXT NOT NULL,
  local_path TEXT,
  content_type TEXT,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','downloaded','failed','skipped')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, image_kind, source_url)
) STRICT;

CREATE INDEX idx_products_last_seen ON products(last_seen_at);
CREATE INDEX idx_memberships_scope_rank ON catalog_memberships(site_country, primary_category, subcategory, active, listing_rank);
CREATE INDEX idx_memberships_product_seen ON catalog_memberships(product_id, seen_at DESC);
CREATE INDEX idx_snapshots_product_captured ON product_snapshots(product_id, captured_at DESC);
CREATE INDEX idx_images_product_status ON product_images(product_id, status);

CREATE VIEW v_current_products AS
WITH latest_membership AS (
  SELECT cm.*, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY seen_at DESC, id DESC) AS row_number
  FROM catalog_memberships cm
), latest_snapshot AS (
  SELECT ps.*, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY captured_at DESC, id DESC) AS row_number
  FROM product_snapshots ps
)
SELECT p.id, p.goods_id, p.canonical_url, COALESCE(s.title, p.title) AS title,
       p.first_seen_at, p.last_seen_at,
       m.site_country, m.language, m.currency, m.primary_category, m.subcategory,
       m.sort_order, m.listing_rank, m.active,
       s.price_amount, s.sales_count, s.rating, s.review_count, s.captured_at
FROM products p
LEFT JOIN latest_membership m ON m.product_id = p.id AND m.row_number = 1
LEFT JOIN latest_snapshot s ON s.product_id = p.id AND s.row_number = 1;
