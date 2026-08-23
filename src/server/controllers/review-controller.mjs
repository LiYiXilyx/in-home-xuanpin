import { spawn } from 'node:child_process';
import { AppError } from '../../shared/errors.mjs';
import { validateSessionRecovery } from '../../jobs/review-job-runner.mjs';
import { extractGoodsId } from '../../shared/ids.mjs';
import { parseReviewCard } from '../../modules/reviews/review-parser.mjs';

const ACTIVE_REVIEW_STATUSES=new Set(['pending','running','paused','paused_manual_recovery','interrupted']);

export function createReviewController({ config,db,repository,reviewRepository,service,projectDir,runProcess=defaultRunProcess }) {
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
      const currentJob=repository.listJobs({ limit:100 }).find(job => job.jobType === 'reviews' && ACTIVE_REVIEW_STATUSES.has(job.status))
        ?? repository.listJobs({ limit:100 }).find(job => job.jobType === 'reviews') ?? null;
      const coverage=currentJob ? db.prepare(`SELECT product_id AS productId,goods_id AS goodsId,cutoff_date AS cutoffDate,
        task_status AS taskStatus,reviews_captured AS reviewsCaptured,pages_scanned AS pagesScanned
        FROM review_capture_coverage WHERE job_id=? AND goods_id=? LIMIT 1`).get(currentJob.id,normalized):null;
      return {
        goodsId:normalized,matched:Boolean(coverage) && ACTIVE_REVIEW_STATUSES.has(currentJob?.status),jobId:currentJob?.id ?? null,jobStatus:currentJob?.status ?? null,
        cutoffDate:coverage?.cutoffDate ?? currentJob?.config?.cutoffDate ?? null,
        taskStatus:coverage?.taskStatus ?? null,reviewsCaptured:Number(coverage?.reviewsCaptured ?? 0),pagesScanned:Number(coverage?.pagesScanned ?? 0)
      };
    },
    captureExtensionPage(input={}) {
      const goodsId=normalizeGoodsId(input.goodsId);
      const context=this.extensionContext(goodsId);
      if (!context.jobId || !context.matched) throw new AppError('当前商品与运营台 Day9 评论任务不匹配。',{ code:'REVIEW_TASK_MISMATCH' });
      if (!ACTIVE_REVIEW_STATUSES.has(context.jobStatus)) throw new AppError('当前 Day9 评论任务已结束，不能接收页面评论。',{ code:'JOB_INVALID_TRANSITION' });
      const sourceUrl=validateTemuProductUrl(input.sourceUrl,goodsId);
      if (!Array.isArray(input.cards) || input.cards.length > 200) throw new AppError('评论页面数据格式无效或超过单页 200 条限制。',{ code:'INVALID_REVIEW_BATCH' });
      const coverage=db.prepare('SELECT product_id AS productId FROM review_capture_coverage WHERE job_id=? AND goods_id=?').get(context.jobId,goodsId);
      const parsed=input.cards.map(card => parseReviewCard(card,{ productId:coverage.productId,goodsId,sourceUrl }))
        .filter(result => result.valid && result.review.reviewDate >= context.cutoffDate);
      const invalidCount=input.cards.length-parsed.length;
      const saved=reviewRepository.saveReviews(context.jobId,parsed.map(result => result.review));
      const totals=db.prepare('SELECT COUNT(*) AS count,MIN(review_date) AS oldest,MAX(review_date) AS newest FROM reviews WHERE capture_job_id=? AND product_id=?')
        .get(context.jobId,coverage.productId);
      const pageIndex=Math.max(1,Number(input.pageIndex ?? context.pagesScanned+1));
      reviewRepository.savePage(context.jobId,coverage.productId,{ pageIndex,reviewsCaptured:Number(totals.count),
        newestReviewDate:totals.newest,oldestReviewDate:totals.oldest,checkpoint:{ source:'browser_extension',pageIndex,cutoffDate:context.cutoffDate } });
      repository.appendEvent(context.jobId,'browser_extension_page_saved','info','浏览器扩展已保存当前商品页评论。',{
        goodsId,pageIndex,received:input.cards.length,valid:parsed.length,invalid:invalidCount,inserted:saved.inserted,deduplicated:saved.deduplicated
      });
      return { goodsId,jobId:context.jobId,cutoffDate:context.cutoffDate,received:input.cards.length,valid:parsed.length,invalid:invalidCount,...saved };
    }
  };
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
