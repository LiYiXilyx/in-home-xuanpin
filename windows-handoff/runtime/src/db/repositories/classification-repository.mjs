import { transaction } from '../client.mjs';
import { AppError } from '../../shared/errors.mjs';

export function createClassificationRepository(db) {
  const activeProducts=db.prepare(`WITH active_membership AS (
      SELECT m.*,ROW_NUMBER() OVER(PARTITION BY m.product_id ORDER BY m.last_seen_at DESC,m.id DESC) AS row_number
      FROM catalog_memberships m WHERE m.active=1
    )
    SELECT p.id AS product_id,p.external_product_id AS goods_id,
    COALESCE(s.title,p.title) AS title,m.subcategory,m.current_rank,m.last_job_id
    FROM active_membership m JOIN products p ON p.id=m.product_id
    LEFT JOIN product_snapshots s ON s.id=(SELECT ps.id FROM product_snapshots ps
      WHERE ps.product_id=p.id ORDER BY ps.captured_at DESC,ps.id DESC LIMIT 1)
    WHERE m.row_number=1 ORDER BY m.current_rank,p.id`);
  const remove=db.prepare('DELETE FROM product_classifications WHERE product_id=? AND job_id IS ? AND taxonomy=?');
  const insert=db.prepare(`INSERT INTO product_classifications(product_id,job_id,taxonomy,category_key,category_label,
    confidence,rule_version,needs_review,evidence_json,created_at,level1,level2,level3,method,reasons_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  return {
    listActiveProducts() { return activeProducts.all(); },
    listPoolProducts({ poolVersionId,categoryKey }) {
      if (!poolVersionId || !categoryKey) throw new AppError('分类必须显式提供 pool_version_id 与 category_key。',{
        code:'CLASSIFICATION_SCOPE_REQUIRED'
      });
      const pool=db.prepare('SELECT category_key FROM catalog_pool_versions WHERE id=?').get(poolVersionId);
      if (!pool || pool.category_key!==categoryKey) throw new AppError('Pool 与 Category 不匹配。',{
        code:'POOL_CATEGORY_MISMATCH',details:{ poolVersionId,categoryKey,actualCategoryKey:pool?.category_key ?? null }
      });
      return db.prepare(`SELECT p.id product_id,p.external_product_id goods_id,COALESCE(s.title,p.title) title,
        m.subcategory,m.current_rank,m.last_job_id
        FROM catalog_pool_version_items i JOIN products p
          ON p.platform=i.platform AND p.external_product_id=i.goods_id
        LEFT JOIN catalog_memberships m ON m.id=(SELECT m2.id FROM catalog_memberships m2
          WHERE m2.product_id=p.id AND m2.category_key=? ORDER BY m2.last_seen_at DESC,m2.id DESC LIMIT 1)
        LEFT JOIN product_snapshots s ON s.id=(SELECT ps.id FROM product_snapshots ps
          WHERE ps.product_id=p.id ORDER BY ps.captured_at DESC,ps.id DESC LIMIT 1)
        WHERE i.pool_version_id=? AND i.category_key=? ORDER BY i.id`).all(categoryKey,poolVersionId,categoryKey);
    },
    resolvePoolJobId({ poolVersionId,categoryKey,requestedJobId=null }) {
      const products=this.listPoolProducts({ poolVersionId,categoryKey });
      const jobIds=[...new Set(products.map(row=>row.last_job_id).filter(Boolean).map(String))];
      if (requestedJobId) {
        if (!db.prepare('SELECT 1 FROM crawl_jobs WHERE id=?').get(requestedJobId)) throw new Error(`未找到任务：${requestedJobId}`);
        if (!jobIds.includes(String(requestedJobId))) throw new AppError('请求 job 不属于分类 Pool。',{
          code:'CLASSIFICATION_JOB_SCOPE_MISMATCH',details:{ poolVersionId,categoryKey,requestedJobId,jobIds }
        });
        return String(requestedJobId);
      }
      if (jobIds.length!==1) throw new AppError('分类 Pool 无法唯一解析 source job。',{
        code:'CLASSIFICATION_SCOPE_UNRESOLVED',details:{ poolVersionId,categoryKey,jobIds }
      });
      return jobIds[0];
    },
    resolveJobId(requestedJobId=null) {
      if (requestedJobId) {
        if (!db.prepare('SELECT 1 FROM crawl_jobs WHERE id=?').get(requestedJobId)) throw new Error(`未找到任务：${requestedJobId}`);
        return requestedJobId;
      }
      const row=db.prepare(`SELECT last_job_id AS job_id,COUNT(*) AS count FROM catalog_memberships
        WHERE active=1 GROUP BY last_job_id ORDER BY count DESC LIMIT 1`).get();
      if (!row?.job_id) throw new Error('当前商品池没有可关联的采集任务。');
      return String(row.job_id);
    },
    replaceAll(jobId,classifications,{ now=new Date().toISOString() }={}) {
      transaction(db,() => {
        for (const item of classifications) {
          remove.run(item.productId,jobId,item.taxonomy);
          const reasonsJson=JSON.stringify(item.reasons ?? []);const evidenceJson=JSON.stringify(item.evidence ?? item.reasons ?? []);
          insert.run(item.productId,jobId,item.taxonomy,item.categoryKey,item.categoryLabel,item.confidence,item.ruleVersion,
            item.needsReview ? 1 : 0,evidenceJson,now,item.level1,item.level2,item.level3,item.method,reasonsJson);
        }
        db.prepare(`INSERT INTO crawl_events(job_id,event_type,level,message,payload_json,created_at)
          VALUES(?,?,?,?,?,?)`).run(jobId,'classification_completed','info','当前商品池规则分类完成。',JSON.stringify({ count:classifications.length }),now);
      });
    },
    distribution(jobId,taxonomy) { return db.prepare(`SELECT category_label,COUNT(*) AS count,SUM(needs_review) AS needs_review
      FROM product_classifications WHERE job_id=? AND taxonomy=? GROUP BY category_label ORDER BY count DESC,category_label`).all(jobId,taxonomy); },
    count(jobId,taxonomy) { return db.prepare(`SELECT COUNT(*) AS count,SUM(needs_review) AS needs_review
      FROM product_classifications WHERE job_id=? AND taxonomy=?`).get(jobId,taxonomy); }
  };
}
