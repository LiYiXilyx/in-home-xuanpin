import { transaction } from '../client.mjs';

export function createLifecycleRepository(db) {
  return {
    coreCounts() {
      return {
        products:count(db,'products'),catalogMemberships:count(db,'catalog_memberships'),
        activeMemberships:Number(db.prepare('SELECT COUNT(*) count FROM catalog_memberships WHERE active=1').get().count),
        productSnapshots:count(db,'product_snapshots')
      };
    },
    resolveSourceCatalogJobId() {
      return db.prepare(`SELECT last_job_id job_id,COUNT(*) count FROM catalog_memberships
        WHERE active=1 GROUP BY last_job_id ORDER BY count DESC,last_seen_at DESC LIMIT 1`).get()?.job_id ?? null;
    },
    listActiveProducts() {
      return db.prepare(`WITH memberships AS (
          SELECT m.*,ROW_NUMBER() OVER(PARTITION BY product_id ORDER BY last_seen_at DESC,id DESC) row_number
          FROM catalog_memberships m WHERE active=1
        ), snapshots AS (
          SELECT s.*,ROW_NUMBER() OVER(PARTITION BY product_id ORDER BY captured_at DESC,id DESC) row_number,
            COUNT(*) OVER(PARTITION BY product_id) snapshot_count
          FROM product_snapshots s
        ), coverage AS (
          SELECT c.*,ROW_NUMBER() OVER(PARTITION BY product_id ORDER BY updated_at DESC,id DESC) row_number
          FROM review_capture_coverage c
        ), classification AS (
          SELECT pc.*,ROW_NUMBER() OVER(PARTITION BY product_id ORDER BY created_at DESC,id DESC) row_number
          FROM product_classifications pc
        )
        SELECT p.id product_id,p.external_product_id goods_id,COALESCE(s.title,p.title) title,
          COALESCE(p.source_url,p.canonical_url) product_url,m.current_rank rank,
          s.review_count snapshot_review_count,s.sales_count,s.rating,s.price_amount,s.captured_at latest_snapshot_at,
          COALESCE(s.snapshot_count,0) snapshot_count,c.crawl_completeness coverage_status,c.stop_reason coverage_stop_reason,
          pc.level3 category_label
        FROM memberships m JOIN products p ON p.id=m.product_id
        LEFT JOIN snapshots s ON s.product_id=p.id AND s.row_number=1
        LEFT JOIN coverage c ON c.product_id=p.id AND c.row_number=1
        LEFT JOIN classification pc ON pc.product_id=p.id AND pc.row_number=1
        WHERE m.row_number=1 ORDER BY m.current_rank,p.id`).all().map(row => ({
          productId:Number(row.product_id),goodsId:String(row.goods_id),title:row.title ?? '',productUrl:row.product_url,
          rank:numberOrNull(row.rank),categoryLabel:row.category_label ?? '',snapshotReviewCount:numberOrNull(row.snapshot_review_count),
          salesCount:numberOrNull(row.sales_count),rating:numberOrNull(row.rating),price:numberOrNull(row.price_amount),
          latestSnapshotAt:row.latest_snapshot_at,snapshotCount:Number(row.snapshot_count),coverageStatus:row.coverage_status,
          coverageStopReason:row.coverage_stop_reason
        }));
    },
    listReviewDates() {
      const map=new Map();
      for (const row of db.prepare(`SELECT r.product_id,r.review_date FROM reviews r
        JOIN catalog_memberships m ON m.product_id=r.product_id AND m.active=1 ORDER BY r.product_id,r.review_date`).all()) {
        const key=Number(row.product_id);if (!map.has(key)) map.set(key,[]);map.get(key).push(row.review_date);
      }
      return map;
    },
    createRun(run) {
      db.prepare(`INSERT INTO product_lifecycle_runs(id,source_catalog_job_id,analysis_as_of_date,rule_version,status,
        active_product_count,reviewed_product_count,config_json,created_at) VALUES(?,?,?,?,'running',?,?,?,?)`)
        .run(run.id,run.sourceCatalogJobId,run.analysisAsOfDate,run.ruleVersion,run.activeProductCount,
          run.reviewedProductCount,JSON.stringify(run.config ?? {}),run.createdAt);
    },
    saveMetrics(runId,metrics,{ createdAt }) {
      const insert=db.prepare(`INSERT INTO product_lifecycle_metrics(lifecycle_run_id,product_id,goods_id,first_review_date,
        recent_7d_reviews,recent_30d_reviews,prior_23d_reviews,review_velocity,prior_review_velocity,velocity_ratio,
        product_stage,data_status,stored_review_count,snapshot_review_count,snapshot_count,coverage_status,coverage_stop_reason,
        first_review_is_observed,reasons_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      transaction(db,() => {
        db.prepare('DELETE FROM product_lifecycle_metrics WHERE lifecycle_run_id=?').run(runId);
        for (const item of metrics) insert.run(runId,item.productId,item.goodsId,item.firstReviewDate,item.recent7dReviews,
          item.recent30dReviews,item.prior23dReviews,item.reviewVelocity,item.priorReviewVelocity,item.velocityRatio,
          item.productStage,item.dataStatus,item.storedReviewCount,item.snapshotReviewCount,item.snapshotCount,
          item.coverageStatus,item.coverageStopReason,1,JSON.stringify(item.reasons),createdAt);
      });
    },
    completeRun(runId,summary,{ completedAt }) {
      const result=db.prepare(`UPDATE product_lifecycle_runs SET status='completed',summary_json=?,completed_at=? WHERE id=? AND status='running'`)
        .run(JSON.stringify(summary),completedAt,runId);
      if (Number(result.changes) !== 1) throw new Error(`无法完成生命周期 run：${runId}`);
    },
    failRun(runId,error,{ completedAt }) {
      db.prepare(`UPDATE product_lifecycle_runs SET status='failed',summary_json=?,completed_at=? WHERE id=? AND status='running'`)
        .run(JSON.stringify({ error:error?.message ?? String(error) }),completedAt,runId);
    },
    getRun(runId=null) {
      const row=runId ? db.prepare('SELECT * FROM product_lifecycle_runs WHERE id=?').get(runId)
        : db.prepare("SELECT * FROM product_lifecycle_runs WHERE status='completed' ORDER BY created_at DESC,id DESC LIMIT 1").get();
      return row ? mapRun(row):null;
    },
    listMetrics(runId) {
      return db.prepare('SELECT * FROM product_lifecycle_metrics WHERE lifecycle_run_id=? ORDER BY id').all(runId).map(mapMetric);
    }
  };
}

function count(db,table) { return Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count); }
function numberOrNull(value) { return value === null || value === undefined ? null:Number(value); }
function parse(value,fallback) { try { return value ? JSON.parse(value):fallback; } catch { return fallback; } }
function mapRun(row) { return { id:row.id,sourceCatalogJobId:row.source_catalog_job_id,analysisAsOfDate:row.analysis_as_of_date,
  ruleVersion:row.rule_version,status:row.status,activeProductCount:Number(row.active_product_count),reviewedProductCount:Number(row.reviewed_product_count),
  config:parse(row.config_json,{}),summary:parse(row.summary_json,null),createdAt:row.created_at,completedAt:row.completed_at }; }
function mapMetric(row) { return { id:Number(row.id),lifecycleRunId:row.lifecycle_run_id,productId:Number(row.product_id),goodsId:row.goods_id,
  firstReviewDate:row.first_review_date,recent7dReviews:Number(row.recent_7d_reviews),recent30dReviews:Number(row.recent_30d_reviews),
  prior23dReviews:Number(row.prior_23d_reviews),reviewVelocity:Number(row.review_velocity),priorReviewVelocity:Number(row.prior_review_velocity),
  velocityRatio:numberOrNull(row.velocity_ratio),productStage:row.product_stage,dataStatus:row.data_status,storedReviewCount:Number(row.stored_review_count),
  snapshotReviewCount:numberOrNull(row.snapshot_review_count),snapshotCount:Number(row.snapshot_count),coverageStatus:row.coverage_status,
  coverageStopReason:row.coverage_stop_reason,firstReviewIsObserved:Boolean(row.first_review_is_observed),reasons:parse(row.reasons_json,[]) }; }
