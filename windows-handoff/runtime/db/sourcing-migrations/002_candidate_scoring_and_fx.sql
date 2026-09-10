ALTER TABLE sourcing_runs ADD COLUMN method TEXT NOT NULL DEFAULT 'NATIVE_1688_IMAGE_SEARCH'
  CHECK(method IN ('NATIVE_1688_IMAGE_SEARCH','YINGDAO_1688_ASSISTANT'));

ALTER TABLE supplier_match_candidates ADD COLUMN fx_rate_id INTEGER REFERENCES fx_rates(id) ON DELETE RESTRICT;
ALTER TABLE supplier_match_candidates ADD COLUMN price_min_eur REAL CHECK(price_min_eur IS NULL OR price_min_eur>=0);
ALTER TABLE supplier_match_candidates ADD COLUMN price_max_eur REAL CHECK(price_max_eur IS NULL OR price_max_eur>=price_min_eur);
ALTER TABLE supplier_match_candidates ADD COLUMN image_similarity REAL CHECK(image_similarity IS NULL OR image_similarity BETWEEN 0 AND 1);
ALTER TABLE supplier_match_candidates ADD COLUMN image_similarity_status TEXT NOT NULL DEFAULT 'NOT_IMPLEMENTED'
  CHECK(image_similarity_status IN ('COMPUTED','NOT_IMPLEMENTED'));
ALTER TABLE supplier_match_candidates ADD COLUMN title_similarity REAL CHECK(title_similarity IS NULL OR title_similarity BETWEEN 0 AND 1);
ALTER TABLE supplier_match_candidates ADD COLUMN category_similarity REAL CHECK(category_similarity IS NULL OR category_similarity BETWEEN 0 AND 1);
ALTER TABLE supplier_match_candidates ADD COLUMN overall_similarity REAL CHECK(overall_similarity IS NULL OR overall_similarity BETWEEN 0 AND 1);
ALTER TABLE supplier_match_candidates ADD COLUMN scoring_weights_json TEXT;

PRAGMA user_version = 2;
