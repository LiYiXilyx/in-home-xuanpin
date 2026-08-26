CREATE TABLE navigation_resolutions (
  id TEXT PRIMARY KEY,
  goods_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  historical_source_url TEXT,
  fresh_url TEXT,
  resolution_method TEXT,
  source_page_url TEXT,
  resolved_at TEXT NOT NULL,
  detail_verified INTEGER NOT NULL DEFAULT 0 CHECK(detail_verified IN (0,1)),
  error_code TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX idx_navigation_resolutions_job_goods
  ON navigation_resolutions(job_id,goods_id,resolved_at DESC);

CREATE INDEX idx_navigation_resolutions_error
  ON navigation_resolutions(job_id,error_code,resolved_at DESC);
