import { spawn } from 'node:child_process';
import { AppError } from '../../shared/errors.mjs';
import { validateSessionRecovery } from '../../jobs/review-job-runner.mjs';
import { extractGoodsId } from '../../shared/ids.mjs';
import { createReviewScrollService } from '../../modules/reviews/review-scroll-service.mjs';

const ACTIVE_REVIEW_STATUSES=new Set(['pending','running','paused','paused_manual_recovery','interrupted']);
const EXTENSION_CAPTURE_QUEUE_STATUSES=new Set(['waiting_operator','capturing']);
const RECOVERABLE_EXTENSION_CODES=new Set(['MANUAL_VERIFICATION_REQUIRED']);

export function createReviewController({ config,db,repository,reviewRepository,reviewQueueRepository,navigationResolutionRepository,service,projectDir,runProcess=defaultRunProcess }) {
  const scrollService=createReviewScrollService({ db,repository,reviewRepository });
  return {
    async validateSessionRecovery(jobId) {
      requireReviewGate(repository,jobId);
      return validateSessionRecovery(config,{ jobId });
    },
    resume(jobId) {
      const job=requireReviewGate(repository,jobId);
      if (!job.checkpoint?.manualGate?.validation?.passed) throw new AppError('请先点击“页面已恢复，重新验证”，并通过 2/3 Control Products 健康检查。',{ code:'SESSION_RECOVERY_NOT_VALIDATED' });
      runProcess({ projectDir,configPath:config.configPath,jobId,action:'review-capture',browserMode:config.browser.mode,browserProfileDir:config.browser.profileDir,browserDebugPort:config.browser.debugPort,browserCdpEndpoint:config.browser.cdpEndpoint });
      return service.get(jobId);
    },
    extensionContext(goodsId) {
      const normalized=normalizeGoodsId(goodsId);
      const queued=reviewQueueRepository?.current() ?? null;
      const currentJob=queued ? repository.getJob(queued.jobId):null;
      const coverage=queued ? db.prepare(`SELECT product_id AS productId,goods_id AS goodsId,cutoff_date AS cutoffDate,
        task_status AS taskStatus,reviews_captured AS reviewsCaptured,pages_scanned AS pagesScanned
        FROM review_capture_coverage WHERE job_id=? AND product_id=? AND goods_id=? LIMIT 1`)
        .get(queued.jobId,queued.productId,queued.goodsId):null;
      const navigationResolution=queued ? navigationResolutionRepository?.latest(queued.jobId,queued.goodsId):null;
      const navigationVerified=Boolean(navigationResolution?.detailVerified)
        && navigationResolution?.details?.queueId === queued?.id;
      const matched=Boolean(queued && coverage)
        && normalized === queued.goodsId
        && ACTIVE_REVIEW_STATUSES.has(currentJob?.status)
        && EXTENSION_CAPTURE_QUEUE_STATUSES.has(queued.status)
        && navigationVerified;
      return {
        matched,queueId:queued?.id ?? null,jobId:queued?.jobId ?? null,goodsId:queued?.goodsId ?? null,
        requestedGoodsId:normalized,jobStatus:currentJob?.status ?? null,
        cutoffDate:coverage?.cutoffDate ?? currentJob?.config?.cutoffDate ?? null,
        queueStatus:queued?.status ?? null,navigationVerified,
        navigationMethod:navigationResolution?.resolutionMethod ?? null,
        taskStatus:coverage?.taskStatus ?? null,reviewsCaptured:Number(coverage?.reviewsCaptured ?? 0),pagesScanned:Number(coverage?.pagesScanned ?? 0)
      };
    },
    captureExtensionPage(input={}) { return this.captureExtensionBatch(input); },
    captureExtensionBatch(input={}) {
      const goodsId=normalizeGoodsId(input.goodsId);
      const context=this.extensionContext(goodsId);
      if (!context.jobId || !context.matched) throw new AppError('当前商品与运营台 Day9 评论任务不匹配。',{ code:'REVIEW_TASK_MISMATCH' });
      if (!ACTIVE_REVIEW_STATUSES.has(context.jobStatus)) throw new AppError('当前 Day9 评论任务已结束，不能接收页面评论。',{ code:'JOB_INVALID_TRANSITION' });
      const sourceUrl=validateTemuProductUrl(input.sourceUrl,goodsId);
      let coverage=db.prepare('SELECT product_id AS productId,task_status AS taskStatus FROM review_capture_coverage WHERE job_id=? AND goods_id=?').get(context.jobId,goodsId);
      if (!coverage) throw new AppError('当前商品没有评论采集覆盖记录。',{ code:'REVIEW_TASK_MISMATCH' });
      const item=repository.listJobItems(context.jobId).find(candidate => Number(candidate.productId) === Number(coverage.productId));
      if (coverage.taskStatus === 'pending') coverage=reviewRepository.startProduct(context.jobId,coverage.productId);
      advanceQueueToCapturing(reviewQueueRepository,context.jobId,goodsId);
      if (item?.status === 'pending') repository.transitionJobItem(context.jobId,item.itemKey,'running',{ checkpoint:{ source:'browser_extension_scroll',goodsId } });
      const runningItem=item ? repository.listJobItems(context.jobId).find(candidate => candidate.itemKey === item.itemKey) : null;
      return scrollService.saveBatch({ jobId:context.jobId,goodsId,sourceUrl,cards:input.cards,pageIndex:Math.max(1,Number(input.pageIndex ?? context.pagesScanned+1)),cutoffDate:context.cutoffDate,coverage,item:runningItem });
    },
    finishExtensionScroll(input={}) {
      const goodsId=normalizeGoodsId(input.goodsId);const context=this.extensionContext(goodsId);
      if (!context.jobId || !context.matched) throw new AppError('当前商品与运营台 Day9 评论任务不匹配。',{ code:'REVIEW_TASK_MISMATCH' });
      validateTemuProductUrl(input.sourceUrl,goodsId);
      const coverage=reviewRepository.getCoverage(context.jobId,Number(db.prepare('SELECT product_id AS productId FROM review_capture_coverage WHERE job_id=? AND goods_id=?').get(context.jobId,goodsId)?.productId));
      if (!coverage) throw new AppError('当前商品没有评论采集覆盖记录。',{ code:'REVIEW_TASK_MISMATCH' });
      const item=repository.listJobItems(context.jobId).find(candidate => Number(candidate.productId) === Number(coverage.productId));
      const result=scrollService.finishScroll({ jobId:context.jobId,goodsId,cutoffDate:context.cutoffDate,coverage,item,stopReason:String(input.stopReason ?? ''),cutoffReached:input.cutoffReached === true,lastPageIndex:Number(input.lastPageIndex ?? coverage.pagesScanned) });
      const queued=reviewQueueRepository?.getForGoods(context.jobId,goodsId);
      if (queued?.status === 'capturing') reviewQueueRepository.transition(queued.id,'completed',{ checkpoint:{ stopReason:result.stopReason,reviewsCaptured:result.reviewsCaptured } });
      reconcileQueueJob({ repository,service,reviewQueueRepository,jobId:context.jobId });
      return result;
    },
    failExtensionCapture(input={}) {
      const goodsId=normalizeGoodsId(input.goodsId);const context=this.extensionContext(goodsId);
      if (!context.matched) return { goodsId,queueStatus:null,ignored:true };
      const queued=reviewQueueRepository?.get(context.queueId);
      if (!queued || queued.status === 'completed' || queued.status === 'failed') return { goodsId,queueStatus:queued?.status ?? null };
      const errorCode=String(input.errorCode ?? 'EXTENSION_CAPTURE_FAILED').slice(0,80);
      const errorMessage=String(input.errorMessage ?? '浏览器扩展评论采集失败。').slice(0,500);
      if (RECOVERABLE_EXTENSION_CODES.has(errorCode)) {
        repository.appendEvent(context.jobId,'review_queue_manual_verification_required','warn','Temu 安全验证需要人工完成，评论队列保持可恢复。',
          { goodsId,queueId:queued.id,errorCode });
        return { goodsId,queueStatus:queued.status,recoverable:true,errorCode };
      }
      const coverage=reviewRepository.getCoverage(context.jobId,queued.productId);
      if (coverage && !['completed','completed_partial','failed'].includes(coverage.taskStatus)) {
        reviewRepository.finishProduct(context.jobId,queued.productId,{ taskStatus:'failed',crawlCompleteness:'partial',stopReason:errorCode,
          reviewsCaptured:coverage.reviewsCaptured,pagesScanned:coverage.pagesScanned,newestCapturedReviewDate:coverage.newestCapturedReviewDate,
          oldestCapturedReviewDate:coverage.oldestCapturedReviewDate,checkpoint:{ ...coverage.checkpoint,source:'browser_extension_scroll',goodsId,failureStage:'extension_capture' },errorCode,errorMessage });
      }
      const jobItem=repository.listJobItems(context.jobId).find(candidate => Number(candidate.productId) === Number(queued.productId));
      if (jobItem?.status === 'pending') repository.transitionJobItem(context.jobId,jobItem.itemKey,'running',{ checkpoint:{ source:'browser_extension_scroll',goodsId } });
      const runningItem=repository.listJobItems(context.jobId).find(candidate => Number(candidate.productId) === Number(queued.productId));
      if (runningItem?.status === 'running') repository.transitionJobItem(context.jobId,runningItem.itemKey,'failed',{ errorCode,errorMessage,checkpoint:{ source:'browser_extension_scroll',goodsId,failureStage:'extension_capture' } });
      const failed=reviewQueueRepository.transition(queued.id,'failed',{ errorCode,errorMessage });
      repository.appendEvent(context.jobId,'review_queue_item_failed','warn','浏览器扩展采集失败，队列项已保留。',{ goodsId,queueId:failed.id,errorCode:failed.errorCode });
      reconcileQueueJob({ repository,service,reviewQueueRepository,jobId:context.jobId });
      return { goodsId,queueStatus:failed.status };
    }
  };
}

function reconcileQueueJob({ repository,service,reviewQueueRepository,jobId }) {
  const counts=reviewQueueRepository.counts(jobId);
  const completed=Number(counts.completed ?? 0),failed=Number(counts.failed ?? 0);
  const active=Number(counts.pending ?? 0)+Number(counts.opening ?? 0)+Number(counts.waiting_operator ?? 0)+Number(counts.capturing ?? 0);
  if (active > 0 || completed+failed === 0) return repository.getJob(jobId);
  let job=repository.getJob(jobId);
  service.updateCounts(jobId,{ totalItems:completed+failed,processedItems:completed+failed,successItems:completed,failedItems:failed,errorCount:failed });
  if (job.status === 'pending') job=service.start(jobId);
  if (job.status === 'running') return service.complete(jobId,{ totalItems:completed+failed,processedItems:completed+failed,successItems:completed,failedItems:failed,errorCount:failed });
  return repository.getJob(jobId);
}

function advanceQueueToCapturing(queueRepository,jobId,goodsId) {
  let item=queueRepository?.getForGoods(jobId,goodsId);
  if (!item || item.status === 'capturing' || item.status === 'completed') return item;
  if (item.status === 'pending' || item.status === 'opening') {
    throw new AppError('旧 URL 直开流程已停用；当前详情页尚未通过 Fresh Navigation 验证。',{ code:'NAVIGATION_NOT_RESOLVED' });
  }
  if (item.status === 'waiting_operator') item=queueRepository.transition(item.id,'capturing');
  return item;
}

function normalizeGoodsId(value) {
  const normalized=String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) throw new AppError('当前页面没有有效的 Temu goods_id。',{ code:'INVALID_GOODS_ID' });
  return normalized;
}
function validateTemuProductUrl(value,goodsId) {
  let url;
  try { url=new URL(String(value ?? '')); } catch { throw new AppError('当前页面 URL 无效。',{ code:'INVALID_PRODUCT_URL' }); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.temu.com' || extractGoodsId(url.href) !== goodsId) {
    throw new AppError('扩展只接受当前 www.temu.com 商品页，且 goods_id 必须一致。',{ code:'SOURCE_GOODS_ID_MISMATCH' });
  }
  return url.href;
}
function requireReviewGate(repository,jobId) {
  const job=repository.getJob(jobId);
  if (!job || job.jobType !== 'reviews') throw new AppError('找不到 Day9 评论任务。',{ code:'JOB_NOT_FOUND' });
  if (job.status !== 'paused_manual_recovery') throw new AppError('当前评论任务不在 Session Recovery Gate。',{ code:'JOB_INVALID_TRANSITION' });
  return job;
}
function defaultRunProcess({ projectDir,configPath,jobId,action,browserMode,browserProfileDir,browserDebugPort,browserCdpEndpoint }) {
  const child=spawn(process.execPath,['src/cli.mjs',action,'--config',configPath,'--job',jobId],{ cwd:projectDir,detached:true,stdio:'ignore',windowsHide:true,env:{ ...process.env,FORCE_COLOR:'0',TEMU_BROWSER_MODE:browserMode,TEMU_BROWSER_PROFILE_DIR:browserProfileDir,TEMU_BROWSER_DEBUG_PORT:String(browserDebugPort),TEMU_BROWSER_CDP_ENDPOINT:browserCdpEndpoint || '' } });
  child.unref();return child;
}
