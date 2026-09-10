CREATE TABLE market_analysis_runs (
  id TEXT PRIMARY KEY,
  source_catalog_job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE RESTRICT,
  active_product_count INTEGER NOT NULL CHECK(active_product_count >= 0),
  taxonomy TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  config_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE category_metrics (
  id INTEGER PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES market_analysis_runs(id) ON DELETE CASCADE,
  category_label TEXT NOT NULL,
  product_count INTEGER NOT NULL CHECK(product_count >= 0),
  product_share REAL NOT NULL CHECK(product_share >= 0 AND product_share <= 1),
  avg_price REAL,
  median_price REAL,
  min_price REAL,
  max_price REAL,
  p25_price REAL,
  p75_price REAL,
  avg_sales REAL,
  median_sales REAL,
  p75_sales REAL,
  p90_sales REAL,
  total_sales REAL,
  avg_rating REAL,
  median_rating REAL,
  rating_45_share REAL CHECK(rating_45_share IS NULL OR (rating_45_share >= 0 AND rating_45_share <= 1)),
  avg_review_count REAL,
  median_review_count REAL,
  high_review_share REAL CHECK(high_review_share IS NULL OR (high_review_share >= 0 AND high_review_share <= 1)),
  top5_sales_share REAL CHECK(top5_sales_share IS NULL OR (top5_sales_share >= 0 AND top5_sales_share <= 1)),
  top10_sales_share REAL CHECK(top10_sales_share IS NULL OR (top10_sales_share >= 0 AND top10_sales_share <= 1)),
  opportunity_score REAL NOT NULL CHECK(opportunity_score >= 0 AND opportunity_score <= 100),
  score_components_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(analysis_run_id, category_label)
) STRICT;

CREATE INDEX idx_market_runs_source_created
  ON market_analysis_runs(source_catalog_job_id, created_at DESC);

CREATE INDEX idx_category_metrics_run_score
  ON category_metrics(analysis_run_id, opportunity_score DESC);
