-- migrate: foreign_keys=off

CREATE TABLE opportunity_analysis_snapshots_rebuilt (
  id TEXT PRIMARY KEY,
  source_pool_version_id TEXT NOT NULL REFERENCES catalog_pool_versions(id) ON DELETE RESTRICT,
  source_campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  source_pool_count INTEGER NOT NULL CHECK(source_pool_count > 0),
  category_key TEXT NOT NULL, site_country TEXT NOT NULL, language TEXT NOT NULL, currency TEXT NOT NULL,
  sort_context TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('frozen','analyzing','awaiting_confirmation','failed')),
  config_json TEXT NOT NULL DEFAULT '{}', summary_json TEXT, generated_at TEXT NOT NULL, completed_at TEXT
) STRICT;
INSERT INTO opportunity_analysis_snapshots_rebuilt SELECT * FROM opportunity_analysis_snapshots;
DROP TABLE opportunity_analysis_snapshots;
ALTER TABLE opportunity_analysis_snapshots_rebuilt RENAME TO opportunity_analysis_snapshots;
CREATE INDEX idx_opportunity_snapshots_source_pool ON opportunity_analysis_snapshots(source_pool_version_id,generated_at DESC);

ALTER TABLE opportunity_snapshot_items ADD COLUMN level3_segment TEXT;
