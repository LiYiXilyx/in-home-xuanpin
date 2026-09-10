CREATE TABLE catalog_expansion_checkpoints (
  id INTEGER PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  milestone_count INTEGER NOT NULL CHECK(milestone_count > 0),
  baseline_count INTEGER NOT NULL CHECK(baseline_count >= 0),
  actual_unique_count INTEGER NOT NULL CHECK(actual_unique_count >= milestone_count),
  true_net_new_count INTEGER NOT NULL CHECK(true_net_new_count >= 0),
  raw_observed_count INTEGER NOT NULL CHECK(raw_observed_count >= 0),
  electronic_excluded_count INTEGER NOT NULL CHECK(electronic_excluded_count >= 0),
  manual_review_count INTEGER NOT NULL CHECK(manual_review_count >= 0),
  duplicate_goods_id_count INTEGER NOT NULL CHECK(duplicate_goods_id_count >= 0),
  distinct_goods_id_count INTEGER NOT NULL CHECK(distinct_goods_id_count >= 0),
  integrity_check TEXT NOT NULL,
  source_contributions_json TEXT NOT NULL DEFAULT '[]',
  captured_at TEXT NOT NULL,
  UNIQUE(campaign_id,milestone_count)
) STRICT;

CREATE INDEX idx_catalog_expansion_checkpoints_campaign
  ON catalog_expansion_checkpoints(campaign_id,milestone_count);
