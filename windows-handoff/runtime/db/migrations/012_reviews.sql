CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  capture_job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  goods_id TEXT NOT NULL,
  review_id TEXT,
  rating REAL NOT NULL CHECK(rating >= 1 AND rating <= 5),
  content TEXT NOT NULL,
  review_date TEXT NOT NULL CHECK(review_date GLOB '????-??-??'),
  sku TEXT,
  country TEXT,
  has_image INTEGER NOT NULL DEFAULT 0 CHECK(has_image IN (0,1)),
  image_urls_json TEXT NOT NULL DEFAULT '[]',
  source_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  raw_json TEXT,
  UNIQUE(product_id,dedupe_key)
) STRICT;

CREATE UNIQUE INDEX idx_reviews_goods_review_id
  ON reviews(goods_id,review_id) WHERE review_id IS NOT NULL AND review_id<>'';
CREATE INDEX idx_reviews_product_date ON reviews(product_id,review_date DESC);
CREATE INDEX idx_reviews_fingerprint ON reviews(goods_id,review_date,rating,content_fingerprint);

CREATE TABLE review_capture_coverage (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  goods_id TEXT NOT NULL,
  cutoff_date TEXT NOT NULL CHECK(cutoff_date GLOB '????-??-??'),
  newest_captured_review_date TEXT,
  oldest_captured_review_date TEXT,
  reviews_captured INTEGER NOT NULL DEFAULT 0 CHECK(reviews_captured >= 0),
  pages_scanned INTEGER NOT NULL DEFAULT 0 CHECK(pages_scanned >= 0),
  crawl_completeness TEXT CHECK(crawl_completeness IN ('complete','partial','no_review','blocked','failed')),
  task_status TEXT NOT NULL DEFAULT 'pending' CHECK(task_status IN (
    'pending','running','paused','retrying','completed','completed_partial','blocked','failed','cancelled','no_review'
  )),
  stop_reason TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(job_id,product_id)
) STRICT;

CREATE INDEX idx_review_coverage_job_status
  ON review_capture_coverage(job_id,task_status,product_id);
