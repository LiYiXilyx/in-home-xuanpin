CREATE TABLE catalog_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  campaign_type TEXT NOT NULL CHECK(campaign_type IN ('smoke','refresh','expansion','test')),
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  target_gate TEXT NOT NULL DEFAULT 'non_electronic_unique_count' CHECK(target_gate IN (
    'non_electronic_unique_count','business_eligible_count','reviewable_unique_count'
  )),
  target_count INTEGER NOT NULL CHECK(target_count > 0),
  baseline_pool_count INTEGER NOT NULL DEFAULT 0 CHECK(baseline_pool_count >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','opening','waiting_category_confirmation','running','paused','manual_required',
    'qa_pending','qa_failed','completed','failed','cancelled'
  )),
  qa_status TEXT NOT NULL DEFAULT 'pending' CHECK(qa_status IN ('pending','passed','failed')),
  raw_observed_count INTEGER NOT NULL DEFAULT 0 CHECK(raw_observed_count >= 0),
  electronic_excluded_count INTEGER NOT NULL DEFAULT 0 CHECK(electronic_excluded_count >= 0),
  non_electronic_unique_count INTEGER NOT NULL DEFAULT 0 CHECK(non_electronic_unique_count >= 0),
  business_eligible_count INTEGER NOT NULL DEFAULT 0 CHECK(business_eligible_count >= 0),
  reviewable_unique_count INTEGER NOT NULL DEFAULT 0 CHECK(reviewable_unique_count >= 0),
  source_count INTEGER NOT NULL DEFAULT 0 CHECK(source_count >= 0),
  completed_source_count INTEGER NOT NULL DEFAULT 0 CHECK(completed_source_count >= 0),
  config_json TEXT NOT NULL DEFAULT '{}',
  qa_summary_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_catalog_campaigns_category_status
  ON catalog_campaigns(category_key,status,created_at DESC);

CREATE TABLE catalog_sources (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('category','search','product_family')),
  level2 TEXT,
  level3 TEXT,
  search_keyword TEXT,
  navigation_hint_json TEXT NOT NULL DEFAULT '{}',
  sort_order TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  target_quota INTEGER CHECK(target_quota IS NULL OR target_quota > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','opening','waiting_page_ready','capturing','waiting_load_more','manual_required',
    'exhausted','completed','failed','cancelled'
  )),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id,source_key),
  UNIQUE(campaign_id,id)
) STRICT;

CREATE INDEX idx_catalog_sources_campaign_status_priority
  ON catalog_sources(campaign_id,status,priority,id);

CREATE TABLE catalog_source_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL DEFAULT 1 CHECK(run_number > 0),
  raw_observation_count INTEGER NOT NULL DEFAULT 0 CHECK(raw_observation_count >= 0),
  source_unique_count INTEGER NOT NULL DEFAULT 0 CHECK(source_unique_count >= 0),
  campaign_new_unique_count INTEGER NOT NULL DEFAULT 0 CHECK(campaign_new_unique_count >= 0),
  campaign_overlap_count INTEGER NOT NULL DEFAULT 0 CHECK(campaign_overlap_count >= 0),
  eligible_new_count INTEGER NOT NULL DEFAULT 0 CHECK(eligible_new_count >= 0),
  load_more_count INTEGER NOT NULL DEFAULT 0 CHECK(load_more_count >= 0),
  scroll_rounds INTEGER NOT NULL DEFAULT 0 CHECK(scroll_rounds >= 0),
  stop_reason TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(source_id,run_number)
) STRICT;

CREATE TABLE catalog_capture_batches (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  page_url TEXT,
  page_title TEXT,
  captured_at TEXT NOT NULL,
  payload_hash TEXT,
  received_count INTEGER NOT NULL DEFAULT 0 CHECK(received_count >= 0),
  staging_count INTEGER NOT NULL DEFAULT 0 CHECK(staging_count >= 0),
  excluded_count INTEGER NOT NULL DEFAULT 0 CHECK(excluded_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_count >= 0),
  processing_status TEXT NOT NULL DEFAULT 'accepted' CHECK(processing_status IN ('accepted','rejected')),
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,source_id,batch_id)
) STRICT;

CREATE INDEX idx_catalog_capture_batches_source_time
  ON catalog_capture_batches(source_id,captured_at);

CREATE TABLE catalog_staging_products (
  id INTEGER PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'temu',
  goods_id TEXT NOT NULL,
  first_source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE RESTRICT,
  latest_source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE RESTRICT,
  first_batch_id TEXT NOT NULL,
  first_seen_sequence INTEGER NOT NULL CHECK(first_seen_sequence > 0),
  latest_title TEXT,
  latest_source_url TEXT,
  canonical_url TEXT NOT NULL,
  image_url TEXT,
  price_amount REAL,
  currency TEXT,
  sales_count INTEGER,
  rating REAL,
  review_count INTEGER,
  electronic_screening_status TEXT NOT NULL CHECK(electronic_screening_status IN ('passed','manual_review_required')),
  business_eligible INTEGER CHECK(business_eligible IS NULL OR business_eligible IN (0,1)),
  reviewable INTEGER CHECK(reviewable IS NULL OR reviewable IN (0,1)),
  quality_status TEXT NOT NULL DEFAULT 'pending' CHECK(quality_status IN ('pending','passed','failed')),
  raw_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(campaign_id,platform,goods_id)
) STRICT;

CREATE INDEX idx_catalog_staging_campaign_screening
  ON catalog_staging_products(campaign_id,electronic_screening_status,quality_status);

CREATE TABLE catalog_exclusion_observations (
  id INTEGER PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  goods_id TEXT,
  title TEXT,
  exclusion_code TEXT NOT NULL CHECK(exclusion_code IN (
    'ELECTRONIC_PRODUCT','USB_PRODUCT','BATTERY_PRODUCT','RECHARGEABLE_PRODUCT',
    'BLUETOOTH_PRODUCT','WIRELESS_COMMUNICATION','AUDIO_ELECTRONIC',
    'LIGHTING_ELECTRONIC','CERTIFICATION_RISK'
  )),
  exclusion_reason TEXT NOT NULL,
  classifier_version TEXT NOT NULL,
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  detected_at TEXT NOT NULL,
  UNIQUE(campaign_id,source_id,batch_id,goods_id,exclusion_code)
) STRICT;

CREATE INDEX idx_catalog_exclusions_campaign_code
  ON catalog_exclusion_observations(campaign_id,exclusion_code,detected_at);

CREATE TABLE catalog_rpa_queue (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','opening','waiting_page_ready','capturing','waiting_load_more','manual_required',
    'completed','failed','cancelled'
  )),
  claim_token TEXT,
  claimed_at TEXT,
  heartbeat_at TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id,source_id)
) STRICT;

CREATE INDEX idx_catalog_rpa_queue_claim
  ON catalog_rpa_queue(status,created_at,id);

CREATE TABLE catalog_pool_versions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  product_count INTEGER NOT NULL CHECK(product_count >= 0),
  non_electronic_unique_count INTEGER NOT NULL CHECK(non_electronic_unique_count >= 0),
  business_eligible_count INTEGER NOT NULL DEFAULT 0 CHECK(business_eligible_count >= 0),
  reviewable_unique_count INTEGER NOT NULL DEFAULT 0 CHECK(reviewable_unique_count >= 0),
  status TEXT NOT NULL CHECK(status IN ('draft','ready','active','qa_failed','superseded')),
  qa_summary_json TEXT NOT NULL DEFAULT '{}',
  activated_at TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_catalog_pool_one_active_per_category
  ON catalog_pool_versions(category_key) WHERE status='active';

CREATE TABLE catalog_pool_version_items (
  id INTEGER PRIMARY KEY,
  pool_version_id TEXT NOT NULL REFERENCES catalog_pool_versions(id) ON DELETE CASCADE,
  staging_product_id INTEGER NOT NULL REFERENCES catalog_staging_products(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  membership_status TEXT NOT NULL DEFAULT 'seen' CHECK(membership_status IN ('seen','not_seen_in_campaign')),
  created_at TEXT NOT NULL,
  UNIQUE(pool_version_id,platform,goods_id)
) STRICT;

CREATE TABLE catalog_campaign_product_observations (
  id INTEGER PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL DEFAULT 'temu',
  goods_id TEXT NOT NULL,
  observation_status TEXT NOT NULL CHECK(observation_status IN (
    'seen','not_seen_in_campaign','navigation_not_resolved','manual_review_required'
  )),
  details_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL,
  UNIQUE(campaign_id,platform,goods_id)
) STRICT;

CREATE INDEX idx_catalog_campaign_observations_status
  ON catalog_campaign_product_observations(campaign_id,observation_status);

ALTER TABLE catalog_memberships ADD COLUMN category_key TEXT;
ALTER TABLE catalog_memberships ADD COLUMN category_profile_version TEXT;
ALTER TABLE catalog_memberships ADD COLUMN campaign_id TEXT REFERENCES catalog_campaigns(id) ON DELETE RESTRICT;
ALTER TABLE catalog_memberships ADD COLUMN source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL;

CREATE INDEX idx_catalog_memberships_category_active
  ON catalog_memberships(category_key,active,last_seen_at DESC);
