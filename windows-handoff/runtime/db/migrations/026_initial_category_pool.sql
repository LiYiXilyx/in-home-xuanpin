-- migrate: foreign_keys=off

CREATE TABLE catalog_campaigns_v26 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  campaign_type TEXT NOT NULL CHECK(campaign_type IN ('smoke','refresh','expansion','test','initial')),
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
  updated_at TEXT NOT NULL,
  browser_profile_name TEXT,
  browser_profile_directory TEXT,
  browser_control_mode TEXT,
  baseline_source TEXT CHECK(baseline_source IS NULL OR baseline_source IN ('ACTIVE_POOL_VERSION','LEGACY_ACTIVE_MEMBERSHIPS')),
  baseline_pool_version_id TEXT
) STRICT;

INSERT INTO catalog_campaigns_v26 (
  id,name,campaign_type,category_key,category_profile_version,target_gate,target_count,
  baseline_pool_count,status,qa_status,raw_observed_count,electronic_excluded_count,
  non_electronic_unique_count,business_eligible_count,reviewable_unique_count,source_count,
  completed_source_count,config_json,qa_summary_json,started_at,finished_at,created_at,updated_at,
  browser_profile_name,browser_profile_directory,browser_control_mode,baseline_source,baseline_pool_version_id
)
SELECT
  id,name,campaign_type,category_key,category_profile_version,target_gate,target_count,
  baseline_pool_count,status,qa_status,raw_observed_count,electronic_excluded_count,
  non_electronic_unique_count,business_eligible_count,reviewable_unique_count,source_count,
  completed_source_count,config_json,qa_summary_json,started_at,finished_at,created_at,updated_at,
  browser_profile_name,browser_profile_directory,browser_control_mode,baseline_source,baseline_pool_version_id
FROM catalog_campaigns;

DROP TABLE catalog_campaigns;
ALTER TABLE catalog_campaigns_v26 RENAME TO catalog_campaigns;

CREATE INDEX idx_catalog_campaigns_category_status
  ON catalog_campaigns(category_key,status,created_at DESC);

CREATE TABLE catalog_initial_pool_eligibility_audits (
  campaign_id TEXT PRIMARY KEY REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  pool_history_count INTEGER NOT NULL CHECK(pool_history_count = 0),
  active_membership_count INTEGER NOT NULL CHECK(active_membership_count = 0),
  prior_nonterminal_initial_count INTEGER NOT NULL CHECK(prior_nonterminal_initial_count = 0),
  pool_history_json TEXT NOT NULL DEFAULT '[]',
  active_membership_ids_json TEXT NOT NULL DEFAULT '[]',
  eligible INTEGER NOT NULL CHECK(eligible = 1),
  checked_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalog_initial_pool_candidate_state (
  campaign_id TEXT PRIMARY KEY REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK(current_revision >= 0),
  current_hash TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count >= 0),
  candidate_hash_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  field_set_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalog_initial_pool_candidate_items (
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE RESTRICT,
  first_batch_id TEXT NOT NULL,
  staging_product_id INTEGER,
  activation_payload_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  first_seen_sequence INTEGER NOT NULL CHECK(first_seen_sequence > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id,platform,goods_id)
) STRICT;

CREATE TABLE catalog_initial_pool_batch_contexts (
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  capture_mode TEXT NOT NULL,
  site_country TEXT NOT NULL,
  language TEXT NOT NULL,
  currency TEXT NOT NULL,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  sort_order TEXT NOT NULL,
  page_url TEXT NOT NULL,
  binding_version TEXT NOT NULL,
  binding_fingerprint TEXT NOT NULL,
  page_health_status TEXT NOT NULL,
  dom_ready INTEGER NOT NULL CHECK(dom_ready IN (0,1)),
  network_ready INTEGER NOT NULL CHECK(network_ready IN (0,1)),
  captcha_blocking INTEGER NOT NULL CHECK(captcha_blocking IN (0,1)),
  search_no_results INTEGER NOT NULL CHECK(search_no_results IN (0,1)),
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id,source_id,batch_id)
) STRICT;

CREATE TABLE catalog_initial_pool_qa_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','PASSED','FAILED')),
  candidate_count INTEGER NOT NULL CHECK(candidate_count > 0),
  candidate_revision INTEGER NOT NULL CHECK(candidate_revision > 0),
  candidate_hash TEXT NOT NULL,
  candidate_hash_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  field_set_version TEXT NOT NULL,
  mandatory_passed INTEGER CHECK(mandatory_passed IS NULL OR mandatory_passed IN (0,1)),
  checks_json TEXT NOT NULL DEFAULT '[]',
  failure_codes_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,request_id)
) STRICT;

CREATE TABLE catalog_initial_pool_qa_candidate_items (
  qa_run_id TEXT NOT NULL REFERENCES catalog_initial_pool_qa_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  source_id TEXT NOT NULL,
  first_batch_id TEXT NOT NULL,
  staging_product_id INTEGER,
  activation_payload_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(qa_run_id,platform,goods_id),
  UNIQUE(qa_run_id,ordinal)
) STRICT;

CREATE TABLE catalog_initial_pool_activation_requests (
  request_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  qa_run_id TEXT NOT NULL REFERENCES catalog_initial_pool_qa_runs(id) ON DELETE RESTRICT,
  candidate_revision INTEGER NOT NULL CHECK(candidate_revision > 0),
  candidate_hash TEXT NOT NULL,
  parameters_hash TEXT NOT NULL,
  pool_version_id TEXT NOT NULL UNIQUE REFERENCES catalog_pool_versions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;
