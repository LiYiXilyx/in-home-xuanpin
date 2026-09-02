ALTER TABLE catalog_rpa_queue ADD COLUMN claim_generation INTEGER NOT NULL DEFAULT 0 CHECK(claim_generation >= 0);

CREATE TABLE catalog_rpa_claim_inspections (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  queue_id TEXT NOT NULL REFERENCES catalog_rpa_queue(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE RESTRICT,
  previous_inspection_id TEXT REFERENCES catalog_rpa_claim_inspections(id) ON DELETE RESTRICT,
  claim_token TEXT,
  claim_generation INTEGER NOT NULL CHECK(claim_generation >= 0),
  determination TEXT NOT NULL CHECK(determination IN ('ACTIVE','NOT_ELIGIBLE','STALE_NOT_PROVEN','STALE_CONFIRMED')),
  evidence_schema_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  inspected_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_catalog_rpa_claim_inspections_campaign_time
  ON catalog_rpa_claim_inspections(campaign_id,inspected_at,id);

CREATE TRIGGER catalog_rpa_claim_inspections_immutable_update
BEFORE UPDATE ON catalog_rpa_claim_inspections BEGIN
  SELECT RAISE(ABORT,'catalog rpa claim inspections immutable');
END;

CREATE TRIGGER catalog_rpa_claim_inspections_immutable_delete
BEFORE DELETE ON catalog_rpa_claim_inspections BEGIN
  SELECT RAISE(ABORT,'catalog rpa claim inspections immutable');
END;

CREATE TABLE catalog_rpa_claim_termination_audits (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  queue_id TEXT NOT NULL REFERENCES catalog_rpa_queue(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE RESTRICT,
  first_inspection_id TEXT NOT NULL REFERENCES catalog_rpa_claim_inspections(id) ON DELETE RESTRICT,
  second_inspection_id TEXT NOT NULL REFERENCES catalog_rpa_claim_inspections(id) ON DELETE RESTRICT,
  claim_token TEXT,
  claim_generation INTEGER NOT NULL,
  termination_reason TEXT NOT NULL,
  previous_statuses_json TEXT NOT NULL,
  new_statuses_json TEXT NOT NULL,
  stale_evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER catalog_rpa_claim_termination_audits_immutable_update
BEFORE UPDATE ON catalog_rpa_claim_termination_audits BEGIN
  SELECT RAISE(ABORT,'catalog rpa claim termination audits immutable');
END;

CREATE TRIGGER catalog_rpa_claim_termination_audits_immutable_delete
BEFORE DELETE ON catalog_rpa_claim_termination_audits BEGIN
  SELECT RAISE(ABORT,'catalog rpa claim termination audits immutable');
END;
