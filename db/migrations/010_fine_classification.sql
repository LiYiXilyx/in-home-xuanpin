CREATE TABLE fine_classification_attempts (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  taxonomy TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('rule','ai','manual')),
  provider TEXT,
  model TEXT,
  model_version TEXT,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  structured_output_json TEXT NOT NULL,
  validation_result_json TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  unresolved_reason TEXT,
  classified_at TEXT NOT NULL,
  UNIQUE(product_id,job_id,taxonomy,method,input_hash)
) STRICT;

CREATE INDEX idx_fine_attempts_job_taxonomy
  ON fine_classification_attempts(job_id,taxonomy,classified_at);

CREATE INDEX idx_fine_attempts_manual_review
  ON fine_classification_attempts(taxonomy,unresolved_reason,confidence);
