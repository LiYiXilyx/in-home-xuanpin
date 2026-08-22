import { transaction } from '../client.mjs';

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
