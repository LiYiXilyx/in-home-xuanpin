CREATE TABLE sourcing_runs (
  run_id TEXT PRIMARY KEY,
  git_commit_sha TEXT NOT NULL,
  machine_role TEXT NOT NULL CHECK(machine_role='1688_RUNNER'),
  machine_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','WAITING_FOR_HUMAN','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  input_count INTEGER NOT NULL CHECK(input_count>=0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK(processed_count>=0 AND processed_count<=input_count),
  target_count INTEGER NOT NULL CHECK(target_count>=1),
  input_manifest_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','WAITING_FOR_HUMAN','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(run_id,temu_goods_id)
) STRICT;

CREATE TABLE supplier_match_candidates (
  run_id TEXT NOT NULL,
  temu_goods_id TEXT NOT NULL,
  candidate_rank INTEGER NOT NULL CHECK(candidate_rank BETWEEN 1 AND 5),
  supplier_platform TEXT NOT NULL DEFAULT '1688' CHECK(supplier_platform='1688'),
  supplier_product_id TEXT,
  supplier_title TEXT,
  supplier_url TEXT,
  supplier_image_url TEXT,
  supplier_image_local_path TEXT,
  price_raw TEXT,
  price_min_rmb REAL CHECK(price_min_rmb IS NULL OR price_min_rmb>=0),
  price_max_rmb REAL CHECK(price_max_rmb IS NULL OR price_max_rmb>=price_min_rmb),
  moq INTEGER CHECK(moq IS NULL OR moq>=1),
  shop_name TEXT,
  captured_at TEXT NOT NULL,
  capture_status TEXT NOT NULL,
  manual_review_required INTEGER NOT NULL DEFAULT 1 CHECK(manual_review_required IN (0,1)),
  notes TEXT,
  PRIMARY KEY(run_id,temu_goods_id,candidate_rank),
  UNIQUE(run_id,temu_goods_id,supplier_product_id),
  UNIQUE(run_id,temu_goods_id,supplier_url),
  FOREIGN KEY(run_id,temu_goods_id) REFERENCES sourcing_run_items(run_id,temu_goods_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE supplier_matches (
  run_id TEXT NOT NULL,
  temu_goods_id TEXT NOT NULL,
  candidate_rank INTEGER NOT NULL CHECK(candidate_rank BETWEEN 1 AND 5),
  decision_method TEXT NOT NULL CHECK(decision_method IN ('MANUAL_CONFIRMED','LOCAL_SCORING_CONFIRMED')),
  confirmed_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY(run_id,temu_goods_id),
  FOREIGN KEY(run_id,temu_goods_id,candidate_rank) REFERENCES supplier_match_candidates(run_id,temu_goods_id,candidate_rank) ON DELETE RESTRICT
) STRICT;

CREATE TABLE fx_rates (
  id INTEGER PRIMARY KEY,
  run_id TEXT REFERENCES sourcing_runs(run_id) ON DELETE RESTRICT,
  fx_pair TEXT NOT NULL CHECK(fx_pair='CNY/EUR'),
  fx_rate REAL NOT NULL CHECK(fx_rate>0),
  fx_source TEXT NOT NULL,
  fx_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_sourcing_candidates_goods ON supplier_match_candidates(temu_goods_id,captured_at DESC);

PRAGMA user_version = 1;
