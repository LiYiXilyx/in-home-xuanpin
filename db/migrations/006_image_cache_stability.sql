ALTER TABLE product_images ADD COLUMN download_status TEXT
  CHECK(download_status IS NULL OR download_status IN ('pending','completed','failed','skipped'));
ALTER TABLE product_images ADD COLUMN content_sha256 TEXT;
ALTER TABLE product_images ADD COLUMN last_error TEXT;
ALTER TABLE product_images ADD COLUMN downloaded_at TEXT;
ALTER TABLE product_images ADD COLUMN fetch_strategy TEXT;
ALTER TABLE product_images ADD COLUMN byte_length INTEGER CHECK(byte_length IS NULL OR byte_length >= 0);

UPDATE product_images SET
  download_status=CASE status WHEN 'downloaded' THEN 'completed' ELSE status END,
  content_sha256=sha256,
  last_error=error_message,
  downloaded_at=CASE WHEN status='downloaded' THEN updated_at ELSE NULL END;

CREATE INDEX idx_product_images_download_status
  ON product_images(product_id,download_status,updated_at DESC);
