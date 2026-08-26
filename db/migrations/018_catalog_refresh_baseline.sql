ALTER TABLE catalog_campaigns ADD COLUMN browser_profile_name TEXT;
ALTER TABLE catalog_campaigns ADD COLUMN browser_profile_directory TEXT;
ALTER TABLE catalog_campaigns ADD COLUMN browser_control_mode TEXT;

CREATE TABLE catalog_campaign_baseline_items (
  id INTEGER PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  membership_id INTEGER REFERENCES catalog_memberships(id) ON DELETE SET NULL,
  captured_at TEXT NOT NULL,
  UNIQUE(campaign_id,platform,goods_id)
) STRICT;

CREATE INDEX idx_catalog_campaign_baseline_campaign
  ON catalog_campaign_baseline_items(campaign_id,goods_id);

CREATE TABLE catalog_navigation_risk_observations (
  id INTEGER PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'temu',
  goods_id TEXT NOT NULL,
  historical_url_status TEXT NOT NULL DEFAULT 'not_checked' CHECK(historical_url_status IN (
    'not_checked','available','sold_out','context_mismatch','unreachable'
  )),
  fresh_navigation_status TEXT NOT NULL DEFAULT 'not_checked' CHECK(fresh_navigation_status IN (
    'not_checked','recovered','available','not_resolved'
  )),
  category_card_available INTEGER NOT NULL DEFAULT 0 CHECK(category_card_available IN (0,1)),
  search_context_mismatch INTEGER NOT NULL DEFAULT 0 CHECK(search_context_mismatch IN (0,1)),
  navigation_not_resolved INTEGER NOT NULL DEFAULT 0 CHECK(navigation_not_resolved IN (0,1)),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id,platform,goods_id)
) STRICT;

CREATE INDEX idx_catalog_navigation_risk_campaign
  ON catalog_navigation_risk_observations(campaign_id,historical_url_status,fresh_navigation_status);

CREATE TABLE catalog_refresh_materializations (
  campaign_id TEXT PRIMARY KEY REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  snapshot_job_id TEXT NOT NULL UNIQUE REFERENCES crawl_jobs(id) ON DELETE RESTRICT,
  products_before INTEGER NOT NULL CHECK(products_before >= 0),
  products_after INTEGER NOT NULL CHECK(products_after >= products_before),
  memberships_before INTEGER NOT NULL CHECK(memberships_before >= 0),
  memberships_after INTEGER NOT NULL CHECK(memberships_after >= memberships_before),
  snapshots_before INTEGER NOT NULL CHECK(snapshots_before >= 0),
  snapshots_after INTEGER NOT NULL CHECK(snapshots_after >= snapshots_before),
  reviews_before INTEGER NOT NULL CHECK(reviews_before >= 0),
  reviews_after INTEGER NOT NULL CHECK(reviews_after >= 0),
  products_inserted INTEGER NOT NULL CHECK(products_inserted >= 0),
  memberships_inserted INTEGER NOT NULL CHECK(memberships_inserted >= 0),
  snapshots_inserted INTEGER NOT NULL CHECK(snapshots_inserted >= 0),
  materialized_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalog_refresh_audits (
  campaign_id TEXT PRIMARY KEY REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  old_active_count INTEGER NOT NULL CHECK(old_active_count >= 0),
  new_observed_unique_count INTEGER NOT NULL CHECK(new_observed_unique_count >= 0),
  intersection_count INTEGER NOT NULL CHECK(intersection_count >= 0),
  new_goods_count INTEGER NOT NULL CHECK(new_goods_count >= 0),
  not_seen_count INTEGER NOT NULL CHECK(not_seen_count >= 0),
  historical_url_available_count INTEGER NOT NULL DEFAULT 0 CHECK(historical_url_available_count >= 0),
  historical_url_sold_out_count INTEGER NOT NULL DEFAULT 0 CHECK(historical_url_sold_out_count >= 0),
  fresh_navigation_recovered_count INTEGER NOT NULL DEFAULT 0 CHECK(fresh_navigation_recovered_count >= 0),
  category_card_available_count INTEGER NOT NULL DEFAULT 0 CHECK(category_card_available_count >= 0),
  search_context_mismatch_count INTEGER NOT NULL DEFAULT 0 CHECK(search_context_mismatch_count >= 0),
  navigation_not_resolved_count INTEGER NOT NULL DEFAULT 0 CHECK(navigation_not_resolved_count >= 0),
  duplicate_goods_id_count INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_goods_id_count >= 0),
  electronic_in_staging_count INTEGER NOT NULL DEFAULT 0 CHECK(electronic_in_staging_count >= 0),
  manual_review_count INTEGER NOT NULL DEFAULT 0 CHECK(manual_review_count >= 0),
  title_coverage REAL NOT NULL CHECK(title_coverage >= 0 AND title_coverage <= 1),
  price_coverage REAL NOT NULL CHECK(price_coverage >= 0 AND price_coverage <= 1),
  image_coverage REAL NOT NULL CHECK(image_coverage >= 0 AND image_coverage <= 1),
  sales_coverage REAL NOT NULL CHECK(sales_coverage >= 0 AND sales_coverage <= 1),
  rating_coverage REAL NOT NULL CHECK(rating_coverage >= 0 AND rating_coverage <= 1),
  review_count_coverage REAL NOT NULL CHECK(review_count_coverage >= 0 AND review_count_coverage <= 1),
  qa_passed INTEGER NOT NULL CHECK(qa_passed IN (0,1)),
  qa_details_json TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalog_pool_activation_history (
  id TEXT PRIMARY KEY,
  category_key TEXT NOT NULL,
  new_pool_version_id TEXT NOT NULL REFERENCES catalog_pool_versions(id) ON DELETE RESTRICT,
  previous_pool_version_id TEXT REFERENCES catalog_pool_versions(id) ON DELETE RESTRICT,
  legacy_active_membership_ids_json TEXT NOT NULL DEFAULT '[]',
  activated_at TEXT NOT NULL,
  rolled_back_at TEXT
) STRICT;

CREATE INDEX idx_catalog_pool_activation_category
  ON catalog_pool_activation_history(category_key,activated_at DESC);
