export function createImageRepository(db,{ now = () => new Date().toISOString() } = {}) {
  const select = db.prepare(`SELECT * FROM product_images
    WHERE product_id=? AND image_kind='main' AND source_url=?`);
  return {
    upsert(productId,image) {
      if (!image?.source_url) return null;
      const timestamp = now();
      const downloadStatus = image.download_status ?? (image.status === 'downloaded' ? 'completed' : image.status ?? 'failed');
      const legacyStatus = downloadStatus === 'completed' ? 'downloaded' : downloadStatus;
      db.prepare(`INSERT INTO product_images(
        product_id,image_kind,source_url,local_path,content_type,sha256,status,error_message,created_at,updated_at,
        download_status,content_sha256,last_error,downloaded_at,fetch_strategy,byte_length
      ) VALUES(?,'main',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(product_id,image_kind,source_url) DO UPDATE SET
        local_path=CASE WHEN excluded.download_status='completed' THEN excluded.local_path ELSE product_images.local_path END,
        content_type=CASE WHEN excluded.download_status='completed' THEN excluded.content_type ELSE product_images.content_type END,
        sha256=CASE WHEN excluded.download_status='completed' THEN excluded.sha256 ELSE product_images.sha256 END,
        content_sha256=CASE WHEN excluded.download_status='completed' THEN excluded.content_sha256 ELSE product_images.content_sha256 END,
        byte_length=CASE WHEN excluded.download_status='completed' THEN excluded.byte_length ELSE product_images.byte_length END,
        status=CASE WHEN product_images.download_status='completed' AND excluded.download_status<>'completed'
          THEN product_images.status ELSE excluded.status END,
        download_status=CASE WHEN product_images.download_status='completed' AND excluded.download_status<>'completed'
          THEN product_images.download_status ELSE excluded.download_status END,
        error_message=CASE WHEN excluded.download_status='completed' OR product_images.download_status='completed'
          THEN NULL ELSE excluded.error_message END,
        last_error=CASE WHEN excluded.download_status='completed' OR product_images.download_status='completed'
          THEN NULL ELSE excluded.last_error END,
        downloaded_at=CASE WHEN excluded.download_status='completed' THEN excluded.downloaded_at ELSE product_images.downloaded_at END,
        fetch_strategy=CASE WHEN excluded.download_status='completed' THEN excluded.fetch_strategy ELSE product_images.fetch_strategy END,
        updated_at=excluded.updated_at`).run(
        productId,image.source_url,image.local_path ?? null,image.content_type ?? null,
        image.content_sha256 ?? image.sha256 ?? null,legacyStatus,image.error_message ?? null,timestamp,timestamp,
        downloadStatus,image.content_sha256 ?? image.sha256 ?? null,image.error_message ?? null,
        downloadStatus === 'completed' ? (image.downloaded_at ?? timestamp) : null,image.fetch_strategy ?? null,
        image.byte_length ?? null);
      return select.get(productId,image.source_url);
    },
    listForProduct(productId) {
      return db.prepare(`SELECT * FROM product_images WHERE product_id=? ORDER BY
        CASE download_status WHEN 'completed' THEN 0 ELSE 1 END,updated_at DESC`).all(productId);
    }
  };
}
