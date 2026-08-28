CREATE TABLE sourcing_runs (
  run_id TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK(method = 'YINGDAO_1688_ASSISTANT'),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('PREPARED','IMPORTED','NEEDS_REVIEW','COMPLETED','FAILED')),
  input_count INTEGER NOT NULL CHECK(input_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK(processed_count >= 0 AND processed_count <= input_count),
  fx_pair TEXT NOT NULL CHECK(fx_pair = 'CNY/EUR'),
  fx_rate REAL NOT NULL CHECK(fx_rate > 0),
  fx_source TEXT NOT NULL,
  fx_observed_at TEXT NOT NULL,
  scoring_weights_json TEXT NOT NULL
) STRICT;

CREATE TABLE sourcing_run_items (
  run_id TEXT NOT NULL REFERENCES sourcing_runs(run_id) ON DELETE RESTRICT,
  temu_goods_id TEXT NOT NULL,
  temu_title TEXT NOT NULL,
  temu_image_path TEXT NOT NULL,
  level1 TEXT,
  level2 TEXT,
  level3 TEXT,
  similar_cluster TEXT,
  search_status TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count BETWEEN 0 AND 5),
  manual_review_required INTEGER NOT NULL DEFAULT 1 CHECK(manual_review_required IN (0,1)),
  notes TEXT,
  PRIMARY KEY(run_id,temu_goods_id)
) STRICT;

CREATE TABLE supplier_match_candidates (
  run_id TEXT NOT NULL REFERENCES sourcing_runs(run_id) ON DELETE RESTRICT,
  temu_goods_id TEXT NOT NULL,
  candidate_rank INTEGER NOT NULL CHECK(candidate_rank BETWEEN 1 AND 5),
  supplier_platform TEXT NOT NULL DEFAULT '1688' CHECK(supplier_platform = '1688'),
  supplier_product_id TEXT NOT NULL,
  supplier_title TEXT NOT NULL,
  supplier_url TEXT NOT NULL,
  supplier_image_url TEXT,
  supplier_image_local_path TEXT,
  price_raw TEXT NOT NULL,
  price_min_rmb REAL NOT NULL CHECK(price_min_rmb >= 0),
  price_max_rmb REAL NOT NULL CHECK(price_max_rmb >= price_min_rmb),
  price_min_eur REAL NOT NULL CHECK(price_min_eur >= 0),
  price_max_eur REAL NOT NULL CHECK(price_max_eur >= price_min_eur),
  moq INTEGER CHECK(moq IS NULL OR moq >= 1),
  shop_name TEXT,
  image_similarity REAL CHECK(image_similarity IS NULL OR image_similarity BETWEEN 0 AND 1),
  image_similarity_status TEXT NOT NULL CHECK(image_similarity_status IN ('COMPUTED','NOT_IMPLEMENTED')),
  title_similarity REAL CHECK(title_similarity IS NULL OR title_similarity BETWEEN 0 AND 1),
  category_similarity REAL CHECK(category_similarity IS NULL OR category_similarity BETWEEN 0 AND 1),
  overall_similarity REAL CHECK(overall_similarity IS NULL OR overall_similarity BETWEEN 0 AND 1),
  captured_at TEXT NOT NULL,
  search_status TEXT NOT NULL,
  manual_review_required INTEGER NOT NULL CHECK(manual_review_required IN (0,1)),
  notes TEXT,
  PRIMARY KEY(run_id,temu_goods_id,candidate_rank),
  UNIQUE(run_id,temu_goods_id,supplier_product_id),
  UNIQUE(run_id,temu_goods_id,supplier_url),
  FOREIGN KEY(run_id,temu_goods_id) REFERENCES sourcing_run_items(run_id,temu_goods_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_supplier_match_candidates_goods
  ON supplier_match_candidates(temu_goods_id,captured_at DESC);
CREATE TABLE supplier_match_selections (
  run_id TEXT NOT NULL,
  temu_goods_id TEXT NOT NULL,
  candidate_rank INTEGER NOT NULL CHECK(candidate_rank BETWEEN 1 AND 5),
  decision_method TEXT NOT NULL CHECK(decision_method IN ('MANUAL_CONFIRMED','LOCAL_SCORING_CONFIRMED')),
  confirmed_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY(run_id,temu_goods_id),
  FOREIGN KEY(run_id,temu_goods_id,candidate_rank)
    REFERENCES supplier_match_candidates(run_id,temu_goods_id,candidate_rank) ON DELETE RESTRICT
) STRICT;
