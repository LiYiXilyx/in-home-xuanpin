CREATE TABLE review_queue (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  goods_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','opening','waiting_operator','capturing','completed','failed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  opened_at TEXT,
  capture_started_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id,product_id)
) STRICT;

CREATE INDEX idx_review_queue_job_status
  ON review_queue(job_id,status,created_at);
CREATE INDEX idx_review_queue_goods
  ON review_queue(job_id,goods_id);
