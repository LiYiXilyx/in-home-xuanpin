-- migrate: foreign_keys=off

-- Day9.2 adds an explicit state for the operator-only session recovery gate.
CREATE TABLE crawl_jobs_day9_session (
  id TEXT PRIMARY KEY, job_type TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'operator_current_page',
  site_country TEXT, language TEXT, currency TEXT, primary_category TEXT, subcategory TEXT, source_url TEXT, sort_order TEXT,
  target_count INTEGER CHECK(target_count IS NULL OR target_count > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','running','paused','paused_manual_recovery','interrupted','completed','completed_with_errors','failed','cancelled')),
  pause_requested INTEGER NOT NULL DEFAULT 0 CHECK(pause_requested IN (0,1)), cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  checkpoint_json TEXT, config_json TEXT NOT NULL DEFAULT '{}',
  total_items INTEGER NOT NULL DEFAULT 0 CHECK(total_items >= 0), processed_items INTEGER NOT NULL DEFAULT 0 CHECK(processed_items >= 0),
  success_items INTEGER NOT NULL DEFAULT 0 CHECK(success_items >= 0), failed_items INTEGER NOT NULL DEFAULT 0 CHECK(failed_items >= 0),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK(discovered_count >= 0), stored_count INTEGER NOT NULL DEFAULT 0 CHECK(stored_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count >= 0), resume_count INTEGER NOT NULL DEFAULT 0 CHECK(resume_count >= 0),
  requested_at TEXT NOT NULL, started_at TEXT, heartbeat_at TEXT, updated_at TEXT NOT NULL, finished_at TEXT,
  last_error_code TEXT, last_error_message TEXT, created_at TEXT NOT NULL
) STRICT;
INSERT INTO crawl_jobs_day9_session SELECT * FROM crawl_jobs;
DROP TABLE crawl_jobs;
ALTER TABLE crawl_jobs_day9_session RENAME TO crawl_jobs;
CREATE INDEX idx_crawl_jobs_status_requested ON crawl_jobs(status, requested_at DESC);
CREATE INDEX idx_crawl_jobs_heartbeat ON crawl_jobs(status, heartbeat_at);

CREATE TABLE review_session_epochs (
  session_epoch_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, last_healthy_at TEXT, unhealthy_at TEXT, recovered_at TEXT,
  unhealthy_reason TEXT, recovery_count INTEGER NOT NULL DEFAULT 0 CHECK(recovery_count >= 0),
  status TEXT NOT NULL CHECK(status IN ('healthy','unhealthy','recovered')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_review_session_epochs_job ON review_session_epochs(job_id, started_at DESC);

CREATE TABLE review_session_control_checks (
  id INTEGER PRIMARY KEY,
  session_epoch_id TEXT NOT NULL REFERENCES review_session_epochs(session_epoch_id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  goods_id TEXT NOT NULL, source_url TEXT NOT NULL,
  check_phase TEXT NOT NULL CHECK(check_phase IN ('prepared','recovery_validation')),
  detail_status TEXT NOT NULL CHECK(detail_status IN ('available','unavailable','unknown')),
  checked_at TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(session_epoch_id, product_id, check_phase)
) STRICT;
CREATE INDEX idx_review_control_checks_job ON review_session_control_checks(job_id, check_phase);
