import { AppError } from '../../shared/errors.mjs';
import { isValidIsoDate,parseReviewCard } from './review-parser.mjs';

export function createReviewScrollService({ db,repository,reviewRepository }) {
  return {
    saveBatch({ jobId,goodsId,sourceUrl,cards,pageIndex,cutoffDate,coverage,item }) {
      if (!Array.isArray(cards) || cards.length === 0 || cards.length > 200) throw new AppError('评论批次不能为空，且单批不能超过 200 条。',{ code:'INVALID_REVIEW_BATCH' });
      if (!isValidIsoDate(cutoffDate)) throw new AppError('评论 cutoff 日期无效。',{ code:'INVALID_CUTOFF_DATE' });
      const parsed=cards.map(card => parseReviewCard(card,{ productId:coverage.productId,goodsId,sourceUrl }));const valid=parsed.filter(result => result.valid);const eligible=valid.filter(result => result.review.reviewDate>=cutoffDate);const invalid=cards.length-valid.length;
      const observedDates=valid.map(result => result.review.reviewDate).filter(Boolean).sort();const oldestObservedReviewDate=observedDates[0] ?? null;const newestObservedReviewDate=observedDates.at(-1) ?? null;const cutoffReached=Boolean(oldestObservedReviewDate && oldestObservedReviewDate<cutoffDate);
      const saved=reviewRepository.saveReviews(jobId,eligible.map(result => result.review));const totals=db.prepare('SELECT COUNT(*) AS count,MIN(review_date) AS oldest,MAX(review_date) AS newest FROM reviews WHERE capture_job_id=? AND product_id=?').get(jobId,coverage.productId);
      const checkpoint={ source:'browser_extension_scroll',goodsId,pageIndex:Number(pageIndex),cutoffDate,oldestObservedReviewDate,newestObservedReviewDate,cutoffReached };
      reviewRepository.savePage(jobId,coverage.productId,{ pageIndex:Number(pageIndex),reviewsCaptured:Number(totals.count),newestReviewDate:totals.newest,oldestReviewDate:totals.oldest,checkpoint });
      if (item?.status==='running') repository.checkpointJobItem(jobId,item.itemKey,checkpoint);
      const job=repository.getJob(jobId);const storedCount=Number(db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE capture_job_id=?').get(jobId).count);
      repository.updateCounts(jobId,{ totalItems:Number(job.totalItems ?? job.targetCount ?? 0),processedItems:Number(job.processedItems ?? 0),successItems:Number(job.successItems ?? 0),failedItems:Number(job.failedItems ?? 0),discoveredCount:Number(job.discoveredCount ?? job.targetCount ?? 0),storedCount,errorCount:Number(job.errorCount ?? 0) });
      repository.appendEvent(jobId,'browser_extension_review_batch_saved','info','浏览器扩展已保存评论加载批次。',{ goodsId,pageIndex:Number(pageIndex),received:cards.length,valid:valid.length,eligible:eligible.length,invalid,inserted:saved.inserted,deduplicated:saved.deduplicated,oldestObservedReviewDate,cutoffReached,storedCount });
      return { goodsId,jobId,cutoffDate,received:cards.length,valid:valid.length,eligible:eligible.length,invalid,oldestObservedReviewDate,newestObservedReviewDate,cutoffReached,checkpoint,...saved };
    },
    finishScroll({ jobId,goodsId,cutoffDate,coverage,item,stopReason,cutoffReached,lastPageIndex }) {
      const normalizedReason=cutoffReached ? 'CUTOFF_REACHED':stopReason === 'NO_MORE_REVIEWS' ? 'NO_MORE_REVIEWS_BEFORE_CUTOFF':'MAX_ROUNDS_REACHED';
      const totals=db.prepare('SELECT COUNT(*) AS count,MIN(review_date) AS oldest,MAX(review_date) AS newest FROM reviews WHERE capture_job_id=? AND product_id=?').get(jobId,coverage.productId);
      const complete=normalizedReason === 'CUTOFF_REACHED';
      const checkpoint={ ...(coverage.checkpoint ?? {}),source:'browser_extension_scroll',goodsId,cutoffDate,pageIndex:Math.max(Number(coverage.pagesScanned ?? 0),Number(lastPageIndex ?? 0)),cutoffReached:complete,stopReason:normalizedReason };
      const result=reviewRepository.finishProduct(jobId,coverage.productId,{ taskStatus:complete ? 'completed':'completed_partial',crawlCompleteness:complete ? 'complete':'partial',stopReason:normalizedReason,reviewsCaptured:Number(totals.count),pagesScanned:checkpoint.pageIndex,newestCapturedReviewDate:totals.newest,oldestCapturedReviewDate:totals.oldest,checkpoint,errorCode:null,errorMessage:null });
      if (item?.status === 'running') repository.transitionJobItem(jobId,item.itemKey,'completed',{ checkpoint });
      repository.appendEvent(jobId,'browser_extension_review_scroll_completed',complete ? 'info':'warn',complete ? '浏览器扩展已到达评论 cutoff。':'Temu 评论弹层在到达 cutoff 前已无更多可加载评论。',{ goodsId,stopReason:normalizedReason,reviewsCaptured:Number(totals.count),pagesScanned:checkpoint.pageIndex });
      return { goodsId,jobId,cutoffDate,stopReason:normalizedReason,cutoffReached:complete,reviewsCaptured:Number(totals.count),pagesScanned:checkpoint.pageIndex,coverage:result };
    }
  };
}
