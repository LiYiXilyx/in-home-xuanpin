CREATE TABLE temu_market_evidence_sessions (
  session_id TEXT PRIMARY KEY,
  review_run_id TEXT NOT NULL,
  anchor_temu_goods_id TEXT NOT NULL,
  query TEXT NOT NULL CHECK(length(trim(query)) BETWEEN 1 AND 500),
  status TEXT NOT NULL CHECK(status IN ('CREATED','BOUND','BEFORE_CAPTURED','AFTER_CAPTURED','ASSESSED','CLOSED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  bind_token_sha256 TEXT NOT NULL,
  bind_token_expires_at TEXT NOT NULL,
  bind_token_consumed_at TEXT,
  bound_tab_identity_hash TEXT,
  bound_context_hash TEXT,
  bound_page_url TEXT,
  close_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE(session_id,review_run_id,anchor_temu_goods_id),
  FOREIGN KEY(review_run_id,anchor_temu_goods_id) REFERENCES sourcing_run_items(run_id,temu_goods_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX uq_temu_evidence_one_writable_session
  ON temu_market_evidence_sessions(review_run_id,anchor_temu_goods_id)
  WHERE status<>'CLOSED';

CREATE TABLE temu_market_evidence_phases (
  session_id TEXT NOT NULL,
  review_run_id TEXT NOT NULL,
  anchor_temu_goods_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('BEFORE','AFTER')),
  status TEXT NOT NULL CHECK(status IN ('CREATING','SEALED')),
  page_url TEXT NOT NULL,
  query TEXT NOT NULL,
  tab_identity_hash TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  dom_schema_version TEXT NOT NULL,
  screenshot_relative_path TEXT NOT NULL,
  screenshot_size INTEGER NOT NULL CHECK(screenshot_size>0),
  screenshot_width INTEGER NOT NULL CHECK(screenshot_width>0),
  screenshot_height INTEGER NOT NULL CHECK(screenshot_height>0),
  screenshot_mime TEXT NOT NULL CHECK(screenshot_mime='image/png'),
  screenshot_sha256 TEXT NOT NULL,
  dom_snapshot_sha256 TEXT NOT NULL,
  card_count INTEGER NOT NULL CHECK(card_count>=0),
  cards_json TEXT NOT NULL CHECK(json_valid(cards_json)),
  safe_region_json TEXT NOT NULL CHECK(json_valid(safe_region_json)),
  captured_at TEXT NOT NULL,
  PRIMARY KEY(session_id,phase),
  FOREIGN KEY(session_id,review_run_id,anchor_temu_goods_id)
    REFERENCES temu_market_evidence_sessions(session_id,review_run_id,anchor_temu_goods_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE temu_manual_price_assessments (
  assessment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  review_run_id TEXT NOT NULL,
  anchor_temu_goods_id TEXT NOT NULL,
  assessment_revision INTEGER NOT NULL CHECK(assessment_revision>=1),
  evidence_phase TEXT NOT NULL CHECK(evidence_phase IN ('BEFORE','AFTER','MANUAL')),
  reference_goods_id TEXT,
  supplier_product_id TEXT,
  temu_price_eur REAL NOT NULL CHECK(temu_price_eur>0),
  temu_pack_quantity REAL NOT NULL CHECK(temu_pack_quantity>0),
  temu_unit_price_eur REAL NOT NULL CHECK(temu_unit_price_eur>0),
  supplier_price_cny REAL NOT NULL CHECK(supplier_price_cny>0),
  supplier_pack_quantity REAL NOT NULL CHECK(supplier_pack_quantity>0),
  moq REAL CHECK(moq IS NULL OR moq>=0),
  supplier_unit_price_cny REAL NOT NULL CHECK(supplier_unit_price_cny>0),
  supplier_unit_price_eur REAL NOT NULL CHECK(supplier_unit_price_eur>0),
  fx_cny_per_eur REAL NOT NULL CHECK(fx_cny_per_eur>0),
  fx_source TEXT NOT NULL,
  fx_as_of TEXT NOT NULL,
  price_ratio REAL NOT NULL CHECK(price_ratio>0),
  formula_version TEXT NOT NULL CHECK(formula_version='MANUAL_PRICE_RATIO_V1'),
  created_at TEXT NOT NULL,
  UNIQUE(session_id,assessment_revision),
  FOREIGN KEY(session_id,review_run_id,anchor_temu_goods_id)
    REFERENCES temu_market_evidence_sessions(session_id,review_run_id,anchor_temu_goods_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE temu_market_evidence_requests (
  request_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES temu_market_evidence_sessions(session_id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL
) STRICT;

PRAGMA user_version = 5;
