export function createReportRepository(db) {
  return {
    resolveJobId(requestedJobId = null) {
      if (requestedJobId) {
        const found = db.prepare('SELECT id FROM crawl_jobs WHERE id=?').get(requestedJobId);
        if (!found) throw new Error(`未找到导出任务：${requestedJobId}`);
        return String(found.id);
      }
      const current = db.prepare(`SELECT last_job_id AS job_id,COUNT(*) AS count
        FROM catalog_memberships WHERE active=1 GROUP BY last_job_id
        ORDER BY count DESC LIMIT 1`).get();
      if (!current?.job_id) throw new Error('当前正式商品池没有可用于导出的 job。');
      return String(current.job_id);
    },

    listProducts(jobId,{ sortDirection = 'asc' } = {}) {
      const direction = String(sortDirection).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      return db.prepare(`SELECT p.id AS product_id,p.external_product_id AS goods_id,p.canonical_url,
          COALESCE(s.title,p.title) AS title,p.status,m.current_rank AS rank,
          m.primary_category,m.subcategory,s.price_amount,s.original_price_amount,s.discount_percent,
          s.sales_count,s.rating,s.review_count,s.captured_at,
          (SELECT pc.category_label FROM product_classifications pc WHERE pc.product_id=p.id
            ORDER BY pc.created_at DESC,pc.id DESC LIMIT 1) AS classification,
          (SELECT pi.local_path FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY CASE WHEN pi.source_url=s.image_url THEN 0 ELSE 1 END,pi.updated_at DESC,pi.id DESC LIMIT 1) AS local_image_path,
          (SELECT pi.content_type FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY CASE WHEN pi.source_url=s.image_url THEN 0 ELSE 1 END,pi.updated_at DESC,pi.id DESC LIMIT 1) AS image_content_type,
          (SELECT pi.content_sha256 FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY CASE WHEN pi.source_url=s.image_url THEN 0 ELSE 1 END,pi.updated_at DESC,pi.id DESC LIMIT 1) AS image_sha256
        FROM catalog_memberships m
        JOIN products p ON p.id=m.product_id
        JOIN product_snapshots s ON s.product_id=p.id AND s.job_id=?
        WHERE m.active=1
        ORDER BY m.current_rank ${direction},p.id ${direction}`).all(jobId).map(normalizeProduct);
    },

    listQuality(jobId) {
      return db.prepare(`SELECT job_id,check_code AS metric_name,metric_value AS actual,
        threshold_value AS threshold,passed,details_json,checked_at
        FROM data_quality_checks WHERE job_id=? ORDER BY check_code`).all(jobId).map(row => ({
          ...row,passed:Boolean(row.passed),problem_samples:qualitySamples(row.details_json)
        }));
    },

    listJobs() {
      return db.prepare(`SELECT j.id AS job_id,j.job_type,j.target_count,j.started_at,j.finished_at,j.status,
          j.discovered_count AS discovered,j.processed_items AS processed,j.success_items AS success,
          j.failed_items AS failed,j.resume_count,
          CASE
            WHEN j.last_error_code IS NOT NULL THEN j.last_error_code||': '||COALESCE(j.last_error_message,'')
            ELSE COALESCE((SELECT GROUP_CONCAT(summary,'; ') FROM (
              SELECT se.error_code||' ×'||COUNT(*) AS summary FROM scrape_errors se
              WHERE se.job_id=j.id GROUP BY se.error_code ORDER BY COUNT(*) DESC LIMIT 5
            )),'')
          END AS error_summary
        FROM crawl_jobs j ORDER BY j.created_at DESC`).all().map(row => ({ ...row }));
    },

    counts(jobId) {
      const one = (sql,...parameters) => Number(db.prepare(sql).get(...parameters).count);
      return {
        activeProducts:one('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1'),
        jobProducts:one(`SELECT COUNT(*) AS count FROM product_snapshots s
          JOIN catalog_memberships m ON m.product_id=s.product_id AND m.active=1 WHERE s.job_id=?`,jobId),
        qualityChecks:one('SELECT COUNT(*) AS count FROM data_quality_checks WHERE job_id=?',jobId),
        jobs:one('SELECT COUNT(*) AS count FROM crawl_jobs'),
        completedLocalImages:one(`SELECT COUNT(DISTINCT m.product_id) AS count FROM catalog_memberships m
          JOIN product_images pi ON pi.product_id=m.product_id
          WHERE m.active=1 AND pi.download_status='completed' AND pi.local_path IS NOT NULL`)
      };
    }
  };
}

function normalizeProduct(row) {
  return {
    ...row,product_id:Number(row.product_id),goods_id:String(row.goods_id),rank:numberOrNull(row.rank),
    price_amount:numberOrNull(row.price_amount),original_price_amount:numberOrNull(row.original_price_amount),
    discount_percent:numberOrNull(row.discount_percent),sales_count:numberOrNull(row.sales_count),
    rating:numberOrNull(row.rating),review_count:numberOrNull(row.review_count)
  };
}

function numberOrNull(value) { return value === null || value === undefined ? null : Number(value); }
function qualitySamples(value) {
  try {
    const parsed=JSON.parse(value ?? '{}');
    return Array.isArray(parsed.samples) ? parsed.samples.join(', ') : '';
  } catch { return ''; }
}
