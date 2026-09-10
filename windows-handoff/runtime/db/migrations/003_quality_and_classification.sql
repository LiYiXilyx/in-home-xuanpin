CREATE TABLE scrape_errors (
  id INTEGER PRIMARY KEY,
  job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  retriable INTEGER NOT NULL DEFAULT 0 CHECK(retriable IN (0,1)),
  details_json TEXT,
  occurred_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE TABLE data_quality_checks (
  id INTEGER PRIMARY KEY,
  job_id TEXT REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  check_code TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'job',
  passed INTEGER NOT NULL CHECK(passed IN (0,1)),
  metric_value REAL,
  threshold_value REAL,
  details_json TEXT,
  checked_at TEXT NOT NULL,
  UNIQUE(job_id, check_code, scope)
) STRICT;

CREATE TABLE product_classifications (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  taxonomy TEXT NOT NULL DEFAULT 'week1-basic',
  category_key TEXT NOT NULL,
  category_label TEXT NOT NULL,
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  rule_version TEXT NOT NULL,
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0,1)),
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(product_id, job_id, taxonomy, category_key)
) STRICT;

CREATE INDEX idx_scrape_errors_job_stage ON scrape_errors(job_id, stage, occurred_at);
CREATE INDEX idx_quality_job_passed ON data_quality_checks(job_id, passed);
CREATE INDEX idx_classifications_category ON product_classifications(taxonomy, category_key, needs_review);
