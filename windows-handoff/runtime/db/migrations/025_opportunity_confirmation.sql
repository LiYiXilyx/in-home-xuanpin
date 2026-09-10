CREATE TABLE opportunity_confirmations (
  confirmation_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES opportunity_analysis_snapshots(id) ON DELETE RESTRICT,
  candidate_id INTEGER NOT NULL REFERENCES opportunity_product_candidates(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','needs_more_evidence')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  reviewed_by TEXT NOT NULL CHECK(length(trim(reviewed_by)) > 0),
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id,candidate_id),
  UNIQUE(snapshot_id,platform,goods_id),
  FOREIGN KEY(snapshot_id,platform,goods_id)
    REFERENCES opportunity_product_candidates(snapshot_id,platform,goods_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE opportunity_confirmation_events (
  event_id TEXT PRIMARY KEY,
  confirmation_id TEXT NOT NULL REFERENCES opportunity_confirmations(confirmation_id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL,
  candidate_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  previous_decision TEXT CHECK(previous_decision IS NULL OR previous_decision IN ('approved','rejected','needs_more_evidence')),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','needs_more_evidence')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  reviewed_by TEXT NOT NULL CHECK(length(trim(reviewed_by)) > 0),
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(snapshot_id,candidate_id)
    REFERENCES opportunity_confirmations(snapshot_id,candidate_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_opportunity_confirmations_decision
  ON opportunity_confirmations(snapshot_id,decision,candidate_id);

CREATE INDEX idx_opportunity_confirmation_events_candidate
  ON opportunity_confirmation_events(snapshot_id,candidate_id,created_at,event_id);
