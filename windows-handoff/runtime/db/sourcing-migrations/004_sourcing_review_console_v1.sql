ALTER TABLE supplier_match_candidates ADD COLUMN review_excluded INTEGER NOT NULL DEFAULT 0
  CHECK(review_excluded IN (0,1));
ALTER TABLE supplier_match_candidates ADD COLUMN operator_note TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN review_updated_at TEXT;

CREATE TABLE IF NOT EXISTS sourcing_goods_reviews (
  run_id TEXT NOT NULL,
  temu_goods_id TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(review_status IN ('PENDING','CONFIRMED','NO_SELECTION')),
  review_revision INTEGER NOT NULL DEFAULT 0 CHECK(review_revision>=0),
  review_updated_at TEXT,
  PRIMARY KEY(run_id,temu_goods_id),
  FOREIGN KEY(run_id,temu_goods_id)
    REFERENCES sourcing_run_items(run_id,temu_goods_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sourcing_one_selected_candidate_per_goods
  ON supplier_match_candidates(run_id,temu_goods_id)
  WHERE selected_candidate=1;
