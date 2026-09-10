ALTER TABLE catalog_campaigns ADD COLUMN baseline_source TEXT
  CHECK(baseline_source IS NULL OR baseline_source IN ('ACTIVE_POOL_VERSION','LEGACY_ACTIVE_MEMBERSHIPS'));

ALTER TABLE catalog_campaigns ADD COLUMN baseline_pool_version_id TEXT;

CREATE TABLE catalog_baseline_consistency_audits (
  campaign_id TEXT PRIMARY KEY REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  baseline_source TEXT NOT NULL CHECK(baseline_source IN ('ACTIVE_POOL_VERSION','LEGACY_ACTIVE_MEMBERSHIPS')),
  active_pool_version_id TEXT,
  active_pool_version_count INTEGER NOT NULL CHECK(active_pool_version_count >= 0),
  active_membership_count INTEGER NOT NULL CHECK(active_membership_count >= 0),
  intersection_count INTEGER NOT NULL CHECK(intersection_count >= 0),
  consistent INTEGER NOT NULL CHECK(consistent IN (0,1)),
  checked_at TEXT NOT NULL
) STRICT;
