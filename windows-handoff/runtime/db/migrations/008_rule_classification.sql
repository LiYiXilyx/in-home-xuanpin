ALTER TABLE product_classifications ADD COLUMN level1 TEXT;
ALTER TABLE product_classifications ADD COLUMN level2 TEXT;
ALTER TABLE product_classifications ADD COLUMN level3 TEXT;
ALTER TABLE product_classifications ADD COLUMN method TEXT NOT NULL DEFAULT 'rule';
ALTER TABLE product_classifications ADD COLUMN reasons_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_classifications_job_taxonomy
  ON product_classifications(job_id,taxonomy,created_at);
