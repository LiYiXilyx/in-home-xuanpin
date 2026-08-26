CREATE TABLE product_lifecycle_runs (
  id TEXT PRIMARY KEY,
  source_catalog_job_id TEXT REFERENCES crawl_jobs(id) ON DELETE RESTRICT,
  analysis_as_of_date TEXT NOT NULL CHECK(analysis_as_of_date GLOB '????-??-??'),
  rule_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  active_product_count INTEGER NOT NULL CHECK(active_product_count >= 0),
  reviewed_product_count INTEGER NOT NULL DEFAULT 0 CHECK(reviewed_product_count >= 0),
  config_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE product_lifecycle_metrics (
  id INTEGER PRIMARY KEY,
  lifecycle_run_id TEXT NOT NULL REFERENCES product_lifecycle_runs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  goods_id TEXT NOT NULL,
  first_review_date TEXT CHECK(first_review_date IS NULL OR first_review_date GLOB '????-??-??'),
  recent_7d_reviews INTEGER NOT NULL DEFAULT 0 CHECK(recent_7d_reviews >= 0),
  recent_30d_reviews INTEGER NOT NULL DEFAULT 0 CHECK(recent_30d_reviews >= 0),
  prior_23d_reviews INTEGER NOT NULL DEFAULT 0 CHECK(prior_23d_reviews >= 0),
  review_velocity REAL NOT NULL DEFAULT 0 CHECK(review_velocity >= 0),
  prior_review_velocity REAL NOT NULL DEFAULT 0 CHECK(prior_review_velocity >= 0),
  velocity_ratio REAL CHECK(velocity_ratio IS NULL OR velocity_ratio >= 0),
  product_stage TEXT CHECK(product_stage IS NULL OR product_stage IN ('new','growth','mature','decline')),
  data_status TEXT NOT NULL CHECK(data_status IN ('sufficient','partial','insufficient')),
  stored_review_count INTEGER NOT NULL DEFAULT 0 CHECK(stored_review_count >= 0),
  snapshot_review_count INTEGER CHECK(snapshot_review_count IS NULL OR snapshot_review_count >= 0),
  snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK(snapshot_count >= 0),
  coverage_status TEXT,
  coverage_stop_reason TEXT,
  first_review_is_observed INTEGER NOT NULL DEFAULT 1 CHECK(first_review_is_observed IN (0,1)),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(lifecycle_run_id,product_id)
) STRICT;

CREATE INDEX idx_lifecycle_runs_created
  ON product_lifecycle_runs(created_at DESC);

CREATE INDEX idx_lifecycle_metrics_run_stage
  ON product_lifecycle_metrics(lifecycle_run_id,product_stage,data_status);

CREATE INDEX idx_lifecycle_metrics_product
  ON product_lifecycle_metrics(product_id,lifecycle_run_id);
