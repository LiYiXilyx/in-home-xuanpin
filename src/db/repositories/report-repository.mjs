import { resolveEvidence } from '../../modules/evidence/evidence-repair.mjs';
import { AppError } from '../../shared/errors.mjs';

export function createReportRepository(db) {
  function assertPool(poolVersionId,categoryKey) {
    if(!poolVersionId || !categoryKey)throw new AppError('Excel 导出必须显式提供 pool_version_id 与 category_key。',{code:'EXPORT_SCOPE_REQUIRED'});
    const pool=db.prepare('SELECT category_key FROM catalog_pool_versions WHERE id=?').get(poolVersionId);
    if(!pool || pool.category_key!==categoryKey)throw new AppError('Pool 与 Category 不匹配。',{code:'POOL_CATEGORY_MISMATCH',details:{poolVersionId,categoryKey}});
  }
  return {
    resolveJobId(requestedJobId = null,{poolVersionId,categoryKey}={}) {
      assertPool(poolVersionId,categoryKey);
      if (requestedJobId) {
        const found = db.prepare('SELECT id FROM crawl_jobs WHERE id=?').get(requestedJobId);
        if (!found) throw new Error(`未找到导出任务：${requestedJobId}`);
        const belongs=db.prepare(`SELECT 1 FROM catalog_pool_version_items i JOIN products p
          ON p.platform=i.platform AND p.external_product_id=i.goods_id JOIN catalog_memberships m ON m.product_id=p.id
          WHERE i.pool_version_id=? AND i.category_key=? AND m.category_key=? AND m.last_job_id=? LIMIT 1`).get(poolVersionId,categoryKey,categoryKey,requestedJobId);
        if(!belongs)throw new AppError('导出 job 不属于 Category Pool。',{code:'EXPORT_JOB_SCOPE_MISMATCH'});
        return String(found.id);
      }
      const rows=db.prepare(`SELECT DISTINCT m.last_job_id job_id FROM catalog_pool_version_items i JOIN products p
        ON p.platform=i.platform AND p.external_product_id=i.goods_id JOIN catalog_memberships m ON m.product_id=p.id
        WHERE i.pool_version_id=? AND i.category_key=? AND m.category_key=? AND m.last_job_id IS NOT NULL`).all(poolVersionId,categoryKey,categoryKey);
      if(rows.length!==1)throw new AppError('Category Pool 无法唯一解析导出 job。',{code:'EXPORT_SCOPE_UNRESOLVED',details:{poolVersionId,categoryKey,jobIds:rows.map(x=>x.job_id)}});
      return String(rows[0].job_id);
    },

    listProducts(jobId,{ sortDirection = 'asc',poolVersionId,categoryKey } = {}) {
      assertPool(poolVersionId,categoryKey);
      const direction = String(sortDirection).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      const rows=db.prepare(`SELECT p.id product_id,p.external_product_id goods_id,p.platform FROM catalog_pool_version_items i
        JOIN products p ON p.platform=i.platform AND p.external_product_id=i.goods_id
        WHERE i.pool_version_id=? AND i.category_key=? ORDER BY i.id`).all(poolVersionId,categoryKey);
      const evidenceByKey=new Map(resolveEvidence(db,rows).map(item=>[`${item.platform}\u001f${item.goods_id}`,item]));
      return db.prepare(`SELECT p.id AS product_id,p.external_product_id AS goods_id,p.platform,p.source_url,p.canonical_url,
          COALESCE(s.title,p.title) AS title,p.status,m.current_rank AS rank,
          m.primary_category,m.subcategory,s.price_amount,s.original_price_amount,s.discount_percent,
          s.sales_count,s.rating,s.review_count,s.captured_at,
          (SELECT pc.category_label FROM product_classifications pc WHERE pc.product_id=p.id
            AND pc.job_id=? ORDER BY pc.created_at DESC,pc.id DESC LIMIT 1) AS classification,
          (SELECT pi.local_path FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY CASE WHEN pi.source_url=s.image_url THEN 0 ELSE 1 END,pi.updated_at DESC,pi.id DESC LIMIT 1) AS local_image_path,
          (SELECT pi.content_type FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY CASE WHEN pi.source_url=s.image_url THEN 0 ELSE 1 END,pi.updated_at DESC,pi.id DESC LIMIT 1) AS image_content_type,
          (SELECT pi.content_sha256 FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY CASE WHEN pi.source_url=s.image_url THEN 0 ELSE 1 END,pi.updated_at DESC,pi.id DESC LIMIT 1) AS image_sha256
        FROM catalog_pool_version_items i JOIN products p ON p.platform=i.platform AND p.external_product_id=i.goods_id
        JOIN catalog_memberships m ON m.id=(SELECT m2.id FROM catalog_memberships m2 WHERE m2.product_id=p.id
          AND m2.category_key=? ORDER BY m2.last_seen_at DESC,m2.id DESC LIMIT 1)
        JOIN product_snapshots s ON s.product_id=p.id AND s.job_id=?
        WHERE i.pool_version_id=? AND i.category_key=?
        ORDER BY m.current_rank ${direction},p.id ${direction}`).all(jobId,categoryKey,jobId,poolVersionId,categoryKey)
        .map(row=>normalizeProduct({ ...row,...evidenceByKey.get(`${row.platform}\u001f${row.goods_id}`) }));
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

    counts(jobId,{poolVersionId,categoryKey}={}) {
      assertPool(poolVersionId,categoryKey);
      const one = (sql,...parameters) => Number(db.prepare(sql).get(...parameters).count);
      return {
        activeProducts:one('SELECT COUNT(*) count FROM catalog_pool_version_items WHERE pool_version_id=? AND category_key=?',poolVersionId,categoryKey),
        jobProducts:one(`SELECT COUNT(*) count FROM catalog_pool_version_items i JOIN products p
          ON p.platform=i.platform AND p.external_product_id=i.goods_id JOIN product_snapshots s ON s.product_id=p.id AND s.job_id=?
          WHERE i.pool_version_id=? AND i.category_key=?`,jobId,poolVersionId,categoryKey),
        qualityChecks:one('SELECT COUNT(*) AS count FROM data_quality_checks WHERE job_id=?',jobId),
        jobs:one('SELECT COUNT(*) AS count FROM crawl_jobs'),
        completedLocalImages:one(`SELECT COUNT(DISTINCT p.id) count FROM catalog_pool_version_items i JOIN products p
          ON p.platform=i.platform AND p.external_product_id=i.goods_id JOIN product_images pi ON pi.product_id=p.id
          WHERE i.pool_version_id=? AND i.category_key=? AND pi.download_status='completed' AND pi.local_path IS NOT NULL`,poolVersionId,categoryKey)
      };
    }
  };
}

function normalizeProduct(row) {
  return {
    ...row,product_id:Number(row.product_id),goods_id:String(row.goods_id),rank:numberOrNull(row.rank),
    product_url:row.display_url ?? row.source_url ?? row.canonical_url,
    display_url:row.display_url ?? row.source_url ?? row.canonical_url,
    url_source:row.url_source ?? (row.source_url ? 'CURRENT_OBSERVATION' : row.canonical_url ? 'CANONICAL_FALLBACK' : 'MISSING'),
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
