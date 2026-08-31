ALTER TABLE sourcing_runs ADD COLUMN import_status TEXT
  CHECK(import_status IN ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED'));
ALTER TABLE sourcing_runs ADD COLUMN source_dir TEXT;
ALTER TABLE sourcing_runs ADD COLUMN source_file_count INTEGER CHECK(source_file_count IS NULL OR source_file_count>=0);
ALTER TABLE sourcing_runs ADD COLUMN source_manifest_sha256 TEXT;
ALTER TABLE sourcing_runs ADD COLUMN image_cache_dir TEXT;
ALTER TABLE sourcing_runs ADD COLUMN selected_workbook_path TEXT;
ALTER TABLE sourcing_runs ADD COLUMN imported_at TEXT;
ALTER TABLE sourcing_runs ADD COLUMN sample_method TEXT;
ALTER TABLE sourcing_runs ADD COLUMN qa_json TEXT;

ALTER TABLE sourcing_run_items ADD COLUMN source_export_file TEXT;
ALTER TABLE sourcing_run_items ADD COLUMN source_file_sha256 TEXT;
ALTER TABLE sourcing_run_items ADD COLUMN source_candidate_count INTEGER CHECK(source_candidate_count IS NULL OR source_candidate_count>=0);
ALTER TABLE sourcing_run_items ADD COLUMN sampled_count INTEGER CHECK(sampled_count IS NULL OR sampled_count BETWEEN 0 AND 5);
ALTER TABLE sourcing_run_items ADD COLUMN temu_context_status TEXT CHECK(temu_context_status IN ('AVAILABLE','MISSING'));

ALTER TABLE supplier_match_candidates ADD COLUMN original_rank INTEGER CHECK(original_rank IS NULL OR original_rank>=1);
ALTER TABLE supplier_match_candidates ADD COLUMN sample_seed TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN sample_method TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN price_rmb REAL CHECK(price_rmb IS NULL OR price_rmb>=0);
ALTER TABLE supplier_match_candidates ADD COLUMN shipping_text TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN sales_amount_raw TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN moq_shipping_raw TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN monthly_sales INTEGER CHECK(monthly_sales IS NULL OR monthly_sales>=0);
ALTER TABLE supplier_match_candidates ADD COLUMN cumulative_sales INTEGER CHECK(cumulative_sales IS NULL OR cumulative_sales>=0);
ALTER TABLE supplier_match_candidates ADD COLUMN repurchase_rate REAL CHECK(repurchase_rate IS NULL OR repurchase_rate BETWEEN 0 AND 1);
ALTER TABLE supplier_match_candidates ADD COLUMN shipping_48h_rate REAL CHECK(shipping_48h_rate IS NULL OR shipping_48h_rate BETWEEN 0 AND 1);
ALTER TABLE supplier_match_candidates ADD COLUMN first_listed_at TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN updated_at TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN shop_qualification TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN image_download_status TEXT CHECK(image_download_status IN ('PENDING','SUCCESS','FAILED'));
ALTER TABLE supplier_match_candidates ADD COLUMN image_downloaded_at TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN image_sha256 TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN image_response_sha256 TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN imported_at TEXT;
ALTER TABLE supplier_match_candidates ADD COLUMN selected_candidate INTEGER CHECK(selected_candidate IS NULL OR selected_candidate IN (0,1));

CREATE TABLE IF NOT EXISTS sourcing_run_files (
  run_id TEXT NOT NULL REFERENCES sourcing_runs(run_id) ON DELETE RESTRICT,
  temu_goods_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  source_export_file TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  row_count INTEGER CHECK(row_count IS NULL OR row_count>=0),
  parse_status TEXT NOT NULL CHECK(parse_status IN ('PARSED','FAILED')),
  parse_error TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id,filename),
  UNIQUE(run_id,temu_goods_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sourcing_run_files_goods ON sourcing_run_files(run_id,temu_goods_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_candidates_run_goods_product
  ON supplier_match_candidates(run_id,temu_goods_id,supplier_product_id)
  WHERE supplier_product_id IS NOT NULL;

PRAGMA user_version = 3;
