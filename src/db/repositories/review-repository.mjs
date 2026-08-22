import { transaction } from '../client.mjs';

export function createReviewRepository(db,{ now=() => new Date().toISOString() }={}) {
  const findByReviewId=db.prepare("SELECT id FROM reviews WHERE goods_id=? AND review_id=? AND review_id<>''");
  const findByFallback=db.prepare(`SELECT id,review_id FROM reviews
    WHERE goods_id=? AND review_date=? AND rating=? AND content_fingerprint=? LIMIT 1`);
  const insert=db.prepare(`INSERT INTO reviews(capture_job_id,product_id,goods_id,review_id,rating,content,review_date,sku,country,
    has_image,image_urls_json,source_url,captured_at,content_fingerprint,dedupe_key,raw_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const refresh=db.prepare(`UPDATE reviews SET capture_job_id=?,review_id=COALESCE(review_id,?),sku=COALESCE(?,sku),country=COALESCE(?,country),
    has_image=MAX(has_image,?),image_urls_json=?,source_url=?,captured_at=?,raw_json=? WHERE id=?`);

  function initializeCoverage(jobId,items,cutoffDate) {
    const timestamp=now();
    transaction(db,() => {
      const statement=db.prepare(`INSERT INTO review_capture_coverage(job_id,product_id,goods_id,cutoff_date,task_status,created_at,updated_at)
        VALUES(?,?,?,?,'pending',?,?) ON CONFLICT(job_id,product_id) DO NOTHING`);
      for (const item of items) statement.run(jobId,item.productId,item.goodsId,cutoffDate,timestamp,timestamp);
    });
  }

  function startProduct(jobId,productId,{ retrying=false }={}) {
    const status=retrying ? 'retrying':'running';
    db.prepare(`UPDATE review_capture_coverage SET task_status=?,retry_count=retry_count+?,error_code=NULL,error_message=NULL,
      stop_reason=NULL,updated_at=?,finished_at=NULL WHERE job_id=? AND product_id=?`)
      .run(status,retrying ? 1:0,now(),jobId,productId);
    return getCoverage(jobId,productId);
  }

  function savePage(jobId,productId,{ pageIndex,reviewsCaptured,newestReviewDate,oldestReviewDate,checkpoint }) {
    db.prepare(`UPDATE review_capture_coverage SET pages_scanned=MAX(pages_scanned,?),reviews_captured=?,
      newest_captured_review_date=COALESCE(?,newest_captured_review_date),
      oldest_captured_review_date=COALESCE(?,oldest_captured_review_date),checkpoint_json=?,updated_at=?
      WHERE job_id=? AND product_id=?`).run(pageIndex,reviewsCaptured,newestReviewDate,oldestReviewDate,
        JSON.stringify(checkpoint ?? {}),now(),jobId,productId);
  }

  function saveReviews(jobId,reviews) {
    let inserted=0,deduplicated=0,updated=0;
    transaction(db,() => {
      for (const review of reviews) {
        let existing=review.reviewId ? findByReviewId.get(review.goodsId,review.reviewId):null;
        existing ??=findByFallback.get(review.goodsId,review.reviewDate,review.rating,review.contentFingerprint);
        if (existing) {
          refresh.run(jobId,review.reviewId,review.sku,review.country,review.hasImage ? 1:0,JSON.stringify(review.imageUrls),
            review.sourceUrl,review.capturedAt,JSON.stringify(review.raw ?? {}),existing.id);
          deduplicated+=1;updated+=1;continue;
        }
        insert.run(jobId,review.productId,review.goodsId,review.reviewId,review.rating,review.content,review.reviewDate,
          review.sku,review.country,review.hasImage ? 1:0,JSON.stringify(review.imageUrls),review.sourceUrl,review.capturedAt,
          review.contentFingerprint,review.dedupeKey,JSON.stringify(review.raw ?? {}));
        inserted+=1;
      }
    });
    return { inserted,deduplicated,updated,total:reviews.length };
  }

  function finishProduct(jobId,productId,result) {
    db.prepare(`UPDATE review_capture_coverage SET task_status=?,crawl_completeness=?,stop_reason=?,reviews_captured=?,pages_scanned=?,
      newest_captured_review_date=?,oldest_captured_review_date=?,checkpoint_json=?,error_code=?,error_message=?,updated_at=?,finished_at=?
      WHERE job_id=? AND product_id=?`).run(result.taskStatus,result.crawlCompleteness,result.stopReason,result.reviewsCaptured,
        result.pagesScanned,result.newestCapturedReviewDate,result.oldestCapturedReviewDate,JSON.stringify(result.checkpoint ?? {}),
        result.errorCode ?? null,result.errorMessage ?? null,now(),now(),jobId,productId);
    return getCoverage(jobId,productId);
  }

  function recordError({ jobId,productId,stage='reviews',errorCode,message,retriable=true,details }) {
    db.prepare(`INSERT INTO scrape_errors(job_id,product_id,stage,error_code,message,retriable,details_json,occurred_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(jobId,productId,stage,errorCode,message,retriable ? 1:0,JSON.stringify(details ?? {}),now());
  }

  function markSessionBlocked(jobId,{ stopReason='SESSION_UNHEALTHY',message='Temu列表页未通过页面健康检查。',productIds=null }={}) {
    const timestamp=now();
    const filter=Array.isArray(productIds) && productIds.length
      ? ` AND product_id IN (${productIds.map(() => '?').join(',')})`
      : " AND (task_status='pending' OR stop_reason='PRODUCT_NOT_FOUND')";
    const values=[stopReason,'SESSION_UNHEALTHY',message,timestamp,timestamp,jobId,...(productIds ?? [])];
    const result=db.prepare(`UPDATE review_capture_coverage SET task_status='blocked',crawl_completeness='blocked',
      stop_reason=?,error_code=?,error_message=?,updated_at=?,finished_at=? WHERE job_id=?${filter}`).run(...values);
    return Number(result.changes);
  }

  function getCoverage(jobId,productId) { return mapCoverage(db.prepare('SELECT * FROM review_capture_coverage WHERE job_id=? AND product_id=?').get(jobId,productId)); }
  function listCoverage(jobId) { return db.prepare('SELECT * FROM review_capture_coverage WHERE job_id=? ORDER BY id').all(jobId).map(mapCoverage); }
  function countReviews(jobId=null) { const row=jobId ? db.prepare('SELECT COUNT(*) count FROM reviews WHERE capture_job_id=?').get(jobId):db.prepare('SELECT COUNT(*) count FROM reviews').get();return Number(row.count); }
  function qa(jobId) {
    const scalar=sql => Number(db.prepare(sql).get(jobId).count);
    return {
      invalidRating:scalar('SELECT COUNT(*) count FROM reviews WHERE capture_job_id=? AND (rating<1 OR rating>5)'),
      invalidDate:scalar("SELECT COUNT(*) count FROM reviews WHERE capture_job_id=? AND review_date NOT GLOB '????-??-??'"),
      goodsMismatch:scalar('SELECT COUNT(*) count FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.capture_job_id=? AND r.goods_id<>p.external_product_id'),
      duplicateReviewId:scalar("SELECT COUNT(*) count FROM (SELECT goods_id,review_id FROM reviews WHERE capture_job_id=? AND review_id IS NOT NULL GROUP BY goods_id,review_id HAVING COUNT(*)>1)"),
      duplicateFingerprint:scalar('SELECT COUNT(*) count FROM (SELECT goods_id,review_date,rating,content_fingerprint FROM reviews WHERE capture_job_id=? GROUP BY goods_id,review_date,rating,content_fingerprint HAVING COUNT(*)>1)'),
      invalidComplete:scalar("SELECT COUNT(*) count FROM review_capture_coverage WHERE job_id=? AND crawl_completeness='complete' AND stop_reason NOT IN ('CUTOFF_REACHED','NO_MORE_REVIEWS')"),
      partialWithoutReason:scalar("SELECT COUNT(*) count FROM review_capture_coverage WHERE job_id=? AND crawl_completeness='partial' AND stop_reason IS NULL")
    };
  }
  return { initializeCoverage,startProduct,savePage,saveReviews,finishProduct,recordError,markSessionBlocked,getCoverage,listCoverage,countReviews,qa };
}

function mapCoverage(row) { return row ? {
  id:Number(row.id),jobId:row.job_id,productId:Number(row.product_id),goodsId:row.goods_id,cutoffDate:row.cutoff_date,
  newestCapturedReviewDate:row.newest_captured_review_date,oldestCapturedReviewDate:row.oldest_captured_review_date,
  reviewsCaptured:Number(row.reviews_captured),pagesScanned:Number(row.pages_scanned),crawlCompleteness:row.crawl_completeness,
  taskStatus:row.task_status,stopReason:row.stop_reason,checkpoint:parse(row.checkpoint_json),retryCount:Number(row.retry_count),
  errorCode:row.error_code,errorMessage:row.error_message,createdAt:row.created_at,updatedAt:row.updated_at,finishedAt:row.finished_at
}:null; }
function parse(value) { try { return value ? JSON.parse(value):{}; } catch { return {}; } }
