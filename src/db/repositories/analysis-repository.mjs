import { transaction } from '../client.mjs';

export function createAnalysisRepository(db) {
  return {
    resolveSourceJobId(requestedJobId=null) {
      if (requestedJobId) {
        const row=db.prepare("SELECT id,status,job_type FROM crawl_jobs WHERE id=?").get(requestedJobId);
        if (!row) throw new Error(`未找到市场分析来源任务：${requestedJobId}`);
        if (row.job_type !== 'catalog' || row.status !== 'completed') throw new Error(`来源任务 ${requestedJobId} 不是已完成 catalog 任务。`);
        return String(row.id);
      }
      const row=db.prepare(`SELECT last_job_id AS job_id,COUNT(*) AS count
        FROM catalog_memberships WHERE active=1 GROUP BY last_job_id ORDER BY count DESC LIMIT 1`).get();
      if (!row?.job_id) throw new Error('当前 active 商品池没有来源 catalog job。');
      return String(row.job_id);
    },

    resolveTaxonomy(sourceJobId,requestedTaxonomy=null) {
      if (requestedTaxonomy) return requestedTaxonomy;
      const row=db.prepare(`SELECT taxonomy,COUNT(*) AS count FROM product_classifications
        WHERE job_id=? GROUP BY taxonomy ORDER BY count DESC,MAX(created_at) DESC LIMIT 1`).get(sourceJobId);
      if (!row?.taxonomy) throw new Error(`来源任务 ${sourceJobId} 没有商品分类。`);
      return String(row.taxonomy);
    },

    inputCounts(sourceJobId,taxonomy=null) {
      return normalizeCountRow(db.prepare(`SELECT
        COUNT(*) AS active_memberships,
        COUNT(DISTINCT product_id) AS active_products,
        SUM(CASE WHEN last_job_id=@sourceJobId THEN 1 ELSE 0 END) AS source_job_memberships,
        COUNT(DISTINCT CASE WHEN EXISTS (
          SELECT 1 FROM product_classifications pc
          WHERE pc.product_id=catalog_memberships.product_id
            AND pc.job_id=@sourceJobId
            AND (@taxonomy IS NULL OR pc.taxonomy=@taxonomy)
        ) THEN product_id END) AS source_job_classifications
        FROM catalog_memberships WHERE active=1`).get({ sourceJobId,taxonomy }));
    },

    coreCounts() {
      const result={};
      for (const table of ['products','catalog_memberships','product_snapshots']) {
        result[table]=Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
      }
      result.activeMemberships=Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count);
      return result;
    },

    listActiveProducts(sourceJobId,taxonomy) {
      return db.prepare(`WITH active_membership AS (
          SELECT m.*,ROW_NUMBER() OVER(PARTITION BY m.product_id ORDER BY m.last_seen_at DESC,m.id DESC) AS row_number
          FROM catalog_memberships m WHERE m.active=1
        ), classifications AS (
          SELECT pc.*,ROW_NUMBER() OVER(PARTITION BY pc.product_id ORDER BY pc.created_at DESC,pc.id DESC) AS row_number
          FROM product_classifications pc WHERE pc.job_id=? AND pc.taxonomy=?
        )
        SELECT p.id AS product_id,p.external_product_id AS goods_id,
          COALESCE(s.title,p.title) AS title,COALESCE(p.source_url,p.canonical_url) AS product_url,
          p.canonical_url,m.current_rank AS rank,m.primary_category,m.subcategory,
          s.price_amount AS price,s.sales_count AS sales,s.rating,s.review_count,
          c.taxonomy,c.category_key,c.category_label,c.confidence AS classification_confidence,c.needs_review,
          c.rule_version,c.level1,c.level2,c.level3,c.method,c.reasons_json,c.evidence_json,
          (SELECT pi.local_path FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY pi.updated_at DESC,pi.id DESC LIMIT 1) AS local_image_path,
          (SELECT pi.content_sha256 FROM product_images pi WHERE pi.product_id=p.id
            AND pi.download_status='completed' AND pi.local_path IS NOT NULL
            ORDER BY pi.updated_at DESC,pi.id DESC LIMIT 1) AS image_sha256
        FROM active_membership m
        JOIN products p ON p.id=m.product_id
        JOIN product_snapshots s ON s.product_id=p.id AND s.job_id=m.last_job_id
        LEFT JOIN classifications c ON c.product_id=p.id AND c.row_number=1
        WHERE m.row_number=1
        ORDER BY m.current_rank,p.id`).all(sourceJobId,taxonomy).map(normalizeProduct);
    },

    createRun(run) {
      db.prepare(`INSERT INTO market_analysis_runs(id,source_catalog_job_id,active_product_count,taxonomy,
        analysis_version,status,config_json,created_at) VALUES(?,?,?,?,?,'running',?,?)`)
        .run(run.id,run.sourceCatalogJobId,run.activeProductCount,run.taxonomy,run.analysisVersion,
          JSON.stringify(run.config ?? {}),run.createdAt);
      return run;
    },

    saveCategoryMetrics(runId,categories,{ createdAt }) {
      const insert=db.prepare(`INSERT INTO category_metrics(
        analysis_run_id,category_label,product_count,product_share,
        avg_price,median_price,min_price,max_price,p25_price,p75_price,
        avg_sales,median_sales,p75_sales,p90_sales,total_sales,
        avg_rating,median_rating,rating_45_share,avg_review_count,median_review_count,high_review_share,
        top5_sales_share,top10_sales_share,opportunity_score,score_components_json,reasons_json,metrics_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      transaction(db,() => {
        db.prepare('DELETE FROM category_metrics WHERE analysis_run_id=?').run(runId);
        for (const metric of categories) {
          insert.run(
            runId,metric.categoryLabel,metric.productCount,metric.productShare,
            metric.price.avg,metric.price.median,metric.price.min,metric.price.max,metric.price.p25,metric.price.p75,
            metric.sales.avg,metric.sales.median,metric.sales.p75,metric.sales.p90,metric.sales.total,
            metric.rating.avg,metric.rating.median,metric.rating45Share,metric.reviews.avg,metric.reviews.median,metric.highReviewShare,
            metric.top5SalesShare,metric.top10SalesShare,metric.opportunityScore,JSON.stringify(metric.scoreComponents),
            JSON.stringify(metric.reasons),JSON.stringify(serializableMetric(metric)),createdAt
          );
        }
      });
    },

    completeRun(runId,summary,{ completedAt }) {
      const result=db.prepare(`UPDATE market_analysis_runs SET status='completed',summary_json=?,completed_at=?
        WHERE id=? AND status='running'`).run(JSON.stringify(summary),completedAt,runId);
      if (Number(result.changes) !== 1) throw new Error(`无法完成市场分析 run：${runId}`);
    },

    failRun(runId,error,{ completedAt }) {
      db.prepare(`UPDATE market_analysis_runs SET status='failed',summary_json=?,completed_at=?
        WHERE id=? AND status='running'`).run(JSON.stringify({ error:error?.message ?? String(error) }),completedAt,runId);
    },

    getRun(runId=null) {
      const row=runId
        ? db.prepare('SELECT * FROM market_analysis_runs WHERE id=?').get(runId)
        : db.prepare("SELECT * FROM market_analysis_runs WHERE status='completed' ORDER BY created_at DESC,id DESC LIMIT 1").get();
      return row ? normalizeRun(row) : null;
    },

    listCategoryMetrics(runId) {
      return db.prepare(`SELECT * FROM category_metrics WHERE analysis_run_id=?
        ORDER BY CASE WHEN category_label='其他' THEN 1 ELSE 0 END,opportunity_score DESC,product_count DESC`).all(runId)
        .map(normalizeStoredMetric);
    }
  };
}

function normalizeProduct(row) {
  return {
    productId:Number(row.product_id),goodsId:String(row.goods_id),title:row.title ?? '',productUrl:row.product_url,
    canonicalUrl:row.canonical_url,rank:numberOrNull(row.rank),primaryCategory:row.primary_category,
    subcategory:row.subcategory,price:numberOrNull(row.price),sales:numberOrNull(row.sales),rating:numberOrNull(row.rating),
    reviewCount:numberOrNull(row.review_count),categoryKey:row.category_key,categoryLabel:row.category_label ?? '未分类',
    classificationConfidence:numberOrNull(row.classification_confidence),needsReview:Boolean(row.needs_review ?? 1),
    taxonomy:row.taxonomy,ruleVersion:row.rule_version,level1:row.level1,level2:row.level2,level3:row.level3,classificationMethod:row.method,
    classificationReasons:parseJson(row.reasons_json,[]),classificationEvidence:parseJson(row.evidence_json,{}),
    businessSignals:parseJson(row.evidence_json,{})?.businessSignals ?? {},manualReviewRequired:parseJson(row.evidence_json,{})?.manualReviewRequired === true,
    unresolvedReason:parseJson(row.evidence_json,{})?.unresolvedReason ?? null,previousCategory:parseJson(row.evidence_json,{})?.previousCategory ?? null,
    localImagePath:row.local_image_path,imageSha256:row.image_sha256
  };
}

function normalizeCountRow(row) {
  return {
    activeMemberships:Number(row.active_memberships),activeProducts:Number(row.active_products),
    sourceJobMemberships:Number(row.source_job_memberships),
    sourceJobClassifications:Number(row.source_job_classifications)
  };
}

function normalizeRun(row) {
  return {
    id:row.id,sourceCatalogJobId:row.source_catalog_job_id,activeProductCount:Number(row.active_product_count),
    taxonomy:row.taxonomy,analysisVersion:row.analysis_version,status:row.status,
    config:parseJson(row.config_json,{}),summary:parseJson(row.summary_json,null),createdAt:row.created_at,completedAt:row.completed_at
  };
}

function normalizeStoredMetric(row) {
  return {
    ...row,id:Number(row.id),product_count:Number(row.product_count),product_share:Number(row.product_share),
    opportunity_score:Number(row.opportunity_score),score_components:parseJson(row.score_components_json,{}),
    reasons:parseJson(row.reasons_json,[]),metrics:parseJson(row.metrics_json,{})
  };
}

function serializableMetric(metric) {
  const { scoreComponents,reasons,...rest }=metric;
  return rest;
}

function numberOrNull(value) { return value === null || value === undefined ? null : Number(value); }
function parseJson(value,fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
