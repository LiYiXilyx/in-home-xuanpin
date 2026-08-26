import { AppError } from '../../shared/errors.mjs';
import { resolveFreshNavigation,verifyFreshDetail } from './fresh-navigation-resolver.mjs';
import { createReviewNavigationSafety } from './review-navigation-safety.mjs';

export function createReviewQueueService({ db,jobRepository,queueRepository,navigationRepository,config={},now }) {
  const safety=createReviewNavigationSafety({ jobRepository,config,now });
  function enqueue({ jobId,goodsIds }) {
    const job=requireReviewJob(jobRepository,jobId);
    const ids=[...new Set((goodsIds ?? []).map(value => String(value).trim()).filter(value => /^\d+$/.test(value)))];
    if (!ids.length || ids.length > 50) throw new AppError('评论队列每次必须加入 1–50 个有效 goods_id。',{ code:'INVALID_REVIEW_QUEUE_INPUT' });
    const placeholders=ids.map(() => '?').join(',');
    const rows=db.prepare(`SELECT p.id AS productId,p.external_product_id AS goodsId,
      COALESCE(NULLIF(p.source_url,''),p.canonical_url) AS sourceUrl
      FROM products p JOIN review_capture_coverage c ON c.product_id=p.id AND c.job_id=?
      WHERE p.platform='temu' AND p.external_product_id IN (${placeholders})`).all(jobId,...ids);
    if (rows.length !== ids.length) throw new AppError('部分商品不属于指定评论任务，未创建队列。',{ code:'REVIEW_QUEUE_PRODUCT_MISMATCH' });
    const items=queueRepository.enqueue(job.id,rows);
    jobRepository.appendEvent(job.id,'review_queue_created','info','已创建影刀评论商品队列。',{ count:rows.length,goodsIds:ids });
    return { jobId:job.id,items:items.map(publicQueueItem),counts:queueRepository.counts(job.id) };
  }

  function claimNext({ jobId }) {
    requireReviewJob(jobRepository,jobId);
    safety.beforeClaim(jobId);
    const item=queueRepository.claimNext(jobId);
    if (item) {
      safety.recordClaim(jobId,{ queueId:item.id,goodsId:item.goodsId });
      jobRepository.appendEvent(jobId,'review_queue_item_opening','info','影刀已领取下一件商品。',{ queueId:item.id,goodsId:item.goodsId });
    }
    return { jobId,item:claimItem(item),counts:queueRepository.counts(jobId) };
  }

  function resolveNavigation({ id,goodsId,sourcePageUrl,currentCategoryCards=[],siteSearchCards=[],allowFallback=false }) {
    const item=requireQueueItem(queueRepository,id,goodsId);
    if (!['opening','pending'].includes(item.status)) throw new AppError('当前队列项不在导航解析阶段。',{ code:'REVIEW_QUEUE_INVALID_TRANSITION' });
    safety.beforeNavigation(item.jobId,{ queueId:item.id,goodsId:item.goodsId,
      method:siteSearchCards.length ? 'SITE_SEARCH_CARD':'CURRENT_CATEGORY_CARD' });
    const product=db.prepare(`SELECT source_url AS historicalSourceUrl,canonical_url AS canonicalUrl
      FROM products WHERE id=? AND platform='temu'`).get(item.productId);
    const resolution=resolveFreshNavigation({ goodsId:item.goodsId,currentCategoryCards,siteSearchCards,
      historicalSourceUrl:product?.historicalSourceUrl,canonicalUrl:product?.canonicalUrl,sourcePageUrl,allowFallback });
    const recorded=navigationRepository.record({ goodsId:item.goodsId,jobId:item.jobId,historicalSourceUrl:product?.historicalSourceUrl,
      freshUrl:resolution.freshUrl,resolutionMethod:resolution.resolutionMethod,sourcePageUrl:resolution.sourcePageUrl,
      errorCode:resolution.errorCode,details:{ queueId:item.id,allowFallback:Boolean(allowFallback) } });
    jobRepository.appendEvent(item.jobId,resolution.freshUrl ? 'fresh_navigation_resolved':'fresh_navigation_unresolved',
      resolution.freshUrl ? 'info':'warn',resolution.freshUrl ? '已从 Temu 站内商品卡解析当前导航地址。':'当前站内来源尚未解析到目标商品卡。',
      { queueId:item.id,goodsId:item.goodsId,resolutionMethod:resolution.resolutionMethod,errorCode:resolution.errorCode });
    return { item:claimItem(queueRepository.get(item.id)),resolution:recorded };
  }

  function verifyNavigation({ id,goodsId,detailUrl,detailText='' }) {
    const item=requireQueueItem(queueRepository,id,goodsId);
    const resolution=navigationRepository.latest(item.jobId,item.goodsId);
    if (!resolution?.freshUrl) throw new AppError('请先通过站内商品卡解析 fresh URL。',{ code:'NAVIGATION_NOT_RESOLVED' });
    const verification=verifyFreshDetail({ goodsId:item.goodsId,freshUrl:resolution.freshUrl,detailUrl,detailText });
    const saved=navigationRepository.verify(resolution.id,{ detailVerified:verification.detailVerified,
      errorCode:verification.errorCode,details:{ ...resolution.details,queueId:item.id,detailUrl:verification.detailUrl } });
    if (!verification.detailVerified) {
      jobRepository.appendEvent(item.jobId,'fresh_navigation_verification_failed','warn','Fresh 详情页验证未通过，队列保持可恢复。',
        { queueId:item.id,goodsId:item.goodsId,errorCode:verification.errorCode });
      return { item:claimItem(item),resolution:saved };
    }
    const updated=queueRepository.transition(item.id,'waiting_operator',{ checkpoint:{ pageGoodsId:item.goodsId,pageMatched:true,
      navigationResolutionId:saved.id,resolutionMethod:saved.resolutionMethod } });
    jobRepository.appendEvent(item.jobId,'fresh_detail_verified','info','Fresh 详情页 goods_id 已验证，允许扩展采集。',
      { queueId:item.id,goodsId:item.goodsId,errorCode:'FRESH_DETAIL_VERIFIED',resolutionMethod:saved.resolutionMethod });
    return { item:publicQueueItem(updated),resolution:saved };
  }

  function markWaitingOperator({ id,goodsId }) {
    const item=requireQueueItem(queueRepository,id,goodsId);
    const resolution=navigationRepository.latest(item.jobId,item.goodsId);
    if (!resolution?.detailVerified) throw new AppError('旧 URL 直开流程已停用；请先完成 fresh navigation 和详情验证。',{ code:'NAVIGATION_NOT_RESOLVED' });
    const updated=queueRepository.transition(id,'waiting_operator',{ checkpoint:{ pageGoodsId:item.goodsId,pageMatched:true } });
    jobRepository.appendEvent(item.jobId,'review_queue_waiting_operator','info','商品页 goods_id 已匹配，等待扩展采集。',{ queueId:id,goodsId:item.goodsId });
    return updated;
  }

  function fail({ id,goodsId,errorCode='RPA_OPEN_FAILED',errorMessage='影刀未能完成商品页面操作。' }) {
    const item=requireQueueItem(queueRepository,id,goodsId);
    const updated=queueRepository.transition(id,'failed',{ errorCode:String(errorCode).slice(0,80),errorMessage:String(errorMessage).slice(0,500) });
    jobRepository.appendEvent(item.jobId,'review_queue_item_failed','warn','影刀评论队列项失败，可人工检查后重试。',{ queueId:id,goodsId:item.goodsId,errorCode:updated.errorCode });
    return updated;
  }

  function retry({ id }) {
    const item=queueRepository.get(id);
    if (!item) throw new AppError('评论队列项不存在。',{ code:'REVIEW_QUEUE_NOT_FOUND' });
    const updated=queueRepository.transition(id,'pending',{ checkpoint:{ retryRequested:true } });
    jobRepository.appendEvent(item.jobId,'review_queue_item_retried','info','评论队列项已返回待处理。',{ queueId:id,goodsId:item.goodsId });
    return updated;
  }

  function signalSafety({ id,goodsId,code,evidence }) {
    const item=requireQueueItem(queueRepository,id,goodsId);
    const result=safety.signal(item.jobId,{ queueId:item.id,goodsId:item.goodsId,code,evidence });
    queueRepository.transition(item.id,item.status,{ checkpoint:{ safetyGate:{ opened:true,reason:result.state.reason,
      openedAt:result.state.openedAt,cooldownUntil:result.state.cooldownUntil,manualRecoveryRequired:true } } });
    return { jobId:item.jobId,item:publicQueueItem(queueRepository.get(item.id)),...result };
  }

  function safetyStatus({ jobId }) { return { jobId,...safety.status(jobId) }; }
  function recoverSafety({ jobId,operatorConfirmed,health,overrideCooldown,overrideReason }) {
    const result=safety.recover(jobId,{ operatorConfirmed,health,overrideCooldown,overrideReason });
    for (const item of queueRepository.list(jobId)) {
      if (item.checkpoint?.safetyGate) queueRepository.transition(item.id,item.status,{ checkpoint:{ safetyGate:null } });
    }
    return { jobId,...result };
  }
  function current() {
    const item=queueRepository.current();
    return { item:publicQueueItem(item),safety:item ? safety.status(item.jobId):null };
  }

  function list({ jobId }) { requireReviewJob(jobRepository,jobId);return { jobId,items:queueRepository.list(jobId).map(publicQueueItem),counts:queueRepository.counts(jobId),navigationResolutions:navigationRepository.list(jobId) }; }
  function get({ id }) {
    const item=queueRepository.get(String(id ?? ''));
    if (!item) throw new AppError('评论队列项不存在。',{ code:'REVIEW_QUEUE_NOT_FOUND' });
    requireReviewJob(jobRepository,item.jobId);
    return { item:publicQueueItem(item),navigationResolution:navigationRepository.latest(item.jobId,item.goodsId),terminal:['completed','failed'].includes(item.status) };
  }
  return { enqueue,claimNext,resolveNavigation,verifyNavigation,markWaitingOperator,fail,retry,list,get,current,signalSafety,safetyStatus,recoverSafety };
}

function requireReviewJob(repository,jobId) {
  const job=repository.getJob(String(jobId ?? ''));
  if (!job || job.jobType !== 'reviews') throw new AppError('找不到指定评论任务。',{ code:'JOB_NOT_FOUND' });
  return job;
}
function requireQueueItem(repository,id,goodsId) {
  const item=repository.get(String(id ?? ''));
  if (!item) throw new AppError('评论队列项不存在。',{ code:'REVIEW_QUEUE_NOT_FOUND' });
  if (goodsId !== undefined && String(goodsId) !== item.goodsId) throw new AppError('影刀打开的商品 goods_id 与队列不一致。',{ code:'REVIEW_QUEUE_GOODS_MISMATCH' });
  return item;
}
function claimItem(item) {
  if (!item) return null;
  return { id:item.id,jobId:item.jobId,productId:item.productId,goodsId:item.goodsId,status:item.status,
    attemptCount:item.attemptCount,navigationRequired:true };
}
function publicQueueItem(item) {
  if (!item) return null;
  const { sourceUrl,...result }=item;
  return { ...result,historicalUrlAvailable:Boolean(sourceUrl),navigationRequired:!['capturing','completed'].includes(item.status) };
}
