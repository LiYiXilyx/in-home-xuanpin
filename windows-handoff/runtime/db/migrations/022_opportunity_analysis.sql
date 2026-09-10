CREATE TABLE opportunity_analysis_snapshots (
  id TEXT PRIMARY KEY,
  source_pool_version_id TEXT NOT NULL REFERENCES catalog_pool_versions(id) ON DELETE RESTRICT,
  source_campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  source_pool_count INTEGER NOT NULL CHECK(source_pool_count > 0),
  category_key TEXT NOT NULL,
  site_country TEXT NOT NULL,
  language TEXT NOT NULL,
  currency TEXT NOT NULL,
  sort_context TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('frozen','analyzing','awaiting_confirmation','failed')),
  config_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT,
  generated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(source_pool_version_id)
) STRICT;

CREATE TABLE opportunity_snapshot_items (
  id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES opportunity_analysis_snapshots(id) ON DELETE CASCADE,
  pool_version_item_id INTEGER NOT NULL REFERENCES catalog_pool_version_items(id) ON DELETE RESTRICT,
  staging_product_id INTEGER NOT NULL REFERENCES catalog_staging_products(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  title TEXT,
  current_source_url TEXT,
  canonical_url TEXT NOT NULL,
  image_url TEXT,
  price_amount REAL,
  currency TEXT,
  sales_count INTEGER,
  rating REAL,
  review_count INTEGER,
  estimated_gmv REAL,
  included INTEGER NOT NULL DEFAULT 1 CHECK(included IN (0,1)),
  data_quality_json TEXT NOT NULL DEFAULT '[]',
  hard_exclusion_codes_json TEXT NOT NULL DEFAULT '[]',
  warning_codes_json TEXT NOT NULL DEFAULT '[]',
  level1_scene TEXT,
  product_type TEXT,
  physical_form TEXT,
  fitment_type TEXT,
  logistics_type TEXT,
  ip_risk TEXT,
  classification_method TEXT NOT NULL DEFAULT 'rule' CHECK(classification_method IN ('rule','ai','manual')),
  classification_confidence REAL NOT NULL DEFAULT 0 CHECK(classification_confidence >= 0 AND classification_confidence <= 1),
  classification_reasons_json TEXT NOT NULL DEFAULT '[]',
  manual_review_required INTEGER NOT NULL DEFAULT 0 CHECK(manual_review_required IN (0,1)),
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id,platform,goods_id),
  UNIQUE(snapshot_id,sequence)
) STRICT;

CREATE INDEX idx_opportunity_items_segment
  ON opportunity_snapshot_items(snapshot_id,included,product_type,sales_count DESC);

CREATE INDEX idx_opportunity_items_review
  ON opportunity_snapshot_items(snapshot_id,manual_review_required,classification_confidence);

CREATE TABLE opportunity_segment_metrics (
  id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES opportunity_analysis_snapshots(id) ON DELETE CASCADE,
  level1_scene TEXT NOT NULL,
  product_type TEXT NOT NULL,
  sku_count INTEGER NOT NULL CHECK(sku_count > 0),
  total_sales REAL NOT NULL,
  average_sales REAL NOT NULL,
  median_sales REAL NOT NULL,
  average_price REAL NOT NULL,
  estimated_gmv REAL NOT NULL,
  gmv_per_sku REAL NOT NULL,
  average_rating REAL,
  average_review_count REAL,
  review_density REAL,
  top3_sales_share REAL NOT NULL CHECK(top3_sales_share >= 0 AND top3_sales_share <= 1),
  opportunity_score REAL,
  score_components_json TEXT NOT NULL DEFAULT '{}',
  sample_status TEXT NOT NULL CHECK(sample_status IN ('RANKED','VALIDATION_OPPORTUNITY')),
  dominance_type TEXT,
  dominance_reason TEXT,
  replicability TEXT,
  risk_level TEXT,
  manual_review_required INTEGER NOT NULL DEFAULT 0 CHECK(manual_review_required IN (0,1)),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id,product_type)
) STRICT;

CREATE INDEX idx_opportunity_segments_score
  ON opportunity_segment_metrics(snapshot_id,sample_status,opportunity_score DESC);

CREATE TABLE opportunity_product_candidates (
  id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES opportunity_analysis_snapshots(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  product_type TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN (
    'CORE_SCALE_OPPORTUNITY','DIFFERENTIATION_OPPORTUNITY',
    'VALIDATION_OPPORTUNITY','CAUTION_WATCH'
  )),
  candidate_rank INTEGER NOT NULL CHECK(candidate_rank > 0),
  product_score REAL NOT NULL CHECK(product_score >= 0 AND product_score <= 100),
  estimated_gmv REAL NOT NULL,
  opportunity_reasons_json TEXT NOT NULL DEFAULT '[]',
  major_risks_json TEXT NOT NULL DEFAULT '[]',
  next_validation_action TEXT NOT NULL,
  manual_review_required INTEGER NOT NULL DEFAULT 1 CHECK(manual_review_required IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id,platform,goods_id),
  UNIQUE(snapshot_id,candidate_rank)
) STRICT;

CREATE INDEX idx_opportunity_candidates_rank
  ON opportunity_product_candidates(snapshot_id,candidate_rank);
