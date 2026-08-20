CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  execution_ms INTEGER NOT NULL CHECK(execution_ms >= 0)
) STRICT;

CREATE TABLE crawl_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','partial','failed','cancelled')),
  target_count INTEGER CHECK(target_count IS NULL OR target_count > 0),
  config_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT,
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK(discovered_count >= 0),
  stored_count INTEGER NOT NULL DEFAULT 0 CHECK(stored_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count >= 0),
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE crawl_events (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('debug','info','warn','error')),
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_crawl_jobs_status_created ON crawl_jobs(status, created_at);
CREATE INDEX idx_crawl_events_job_created ON crawl_events(job_id, created_at);
