-- migrate: foreign_keys=off

CREATE TABLE crawl_jobs_day2 (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'operator_current_page',
  site_country TEXT,
  language TEXT,
  currency TEXT,
  primary_category TEXT,
  subcategory TEXT,
  source_url TEXT,
  sort_order TEXT,
  target_count INTEGER CHECK(target_count IS NULL OR target_count > 0),
  status TEXT NOT NULL CHECK(status IN (
    'pending','running','paused','interrupted','completed','completed_with_errors','failed','cancelled'
  )),
  pause_requested INTEGER NOT NULL DEFAULT 0 CHECK(pause_requested IN (0,1)),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  checkpoint_json TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  total_items INTEGER NOT NULL DEFAULT 0 CHECK(total_items >= 0),
  processed_items INTEGER NOT NULL DEFAULT 0 CHECK(processed_items >= 0),
  success_items INTEGER NOT NULL DEFAULT 0 CHECK(success_items >= 0),
  failed_items INTEGER NOT NULL DEFAULT 0 CHECK(failed_items >= 0),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK(discovered_count >= 0),
  stored_count INTEGER NOT NULL DEFAULT 0 CHECK(stored_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count >= 0),
  resume_count INTEGER NOT NULL DEFAULT 0 CHECK(resume_count >= 0),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  heartbeat_at TEXT,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO crawl_jobs_day2(
  id,job_type,status,target_count,config_json,checkpoint_json,
  total_items,processed_items,success_items,failed_items,
  discovered_count,stored_count,error_count,
  requested_at,started_at,updated_at,finished_at,created_at
)
SELECT id,job_type,
  CASE status WHEN 'partial' THEN 'completed_with_errors' ELSE status END,
  target_count,config_json,checkpoint_json,
  discovered_count,stored_count,stored_count,error_count,
  discovered_count,stored_count,error_count,
  created_at,started_at,updated_at,finished_at,created_at
FROM crawl_jobs;

DROP TABLE crawl_jobs;
ALTER TABLE crawl_jobs_day2 RENAME TO crawl_jobs;

CREATE TABLE crawl_events_day2 (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('debug','info','warn','error','success')),
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO crawl_events_day2(id,job_id,event_type,level,message,payload_json,created_at)
SELECT id,job_id,event_type,level,message,payload_json,created_at FROM crawl_events;
DROP TABLE crawl_events;
ALTER TABLE crawl_events_day2 RENAME TO crawl_events;

CREATE TABLE crawl_job_items (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
  item_key TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  checkpoint_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT,
  UNIQUE(job_id, item_key)
) STRICT;

CREATE INDEX idx_crawl_jobs_status_requested ON crawl_jobs(status, requested_at DESC);
CREATE INDEX idx_crawl_jobs_heartbeat ON crawl_jobs(status, heartbeat_at);
CREATE INDEX idx_crawl_events_job_created ON crawl_events(job_id, created_at);
CREATE INDEX idx_crawl_job_items_job_status_sequence ON crawl_job_items(job_id, status, sequence_no);
