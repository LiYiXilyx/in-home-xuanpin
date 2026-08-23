import { closeBrowserSession,openBrowserSession } from '../browser/cdp-session.mjs';
import { openDatabase } from '../db/client.mjs';
import { createAnalysisRepository } from '../db/repositories/analysis-repository.mjs';
import { createJobRepository } from '../db/repositories/job-repository.mjs';
import { createReviewRepository } from '../db/repositories/review-repository.mjs';
import { createJobControl } from './job-control.mjs';
import { createJobService } from './job-service.mjs';
import { captureRecentReviews } from '../modules/reviews/review-capture.mjs';
import { buildDay9EligibleQueue,mapCaptureFailure,summarizeCoverage } from '../modules/reviews/review-service.mjs';
import { daysAgoIso } from '../parsers.mjs';
import { AppError } from '../shared/errors.mjs';
import { findCurrentOperatorTemuPage } from '../browser/operator-page.mjs';
import { inspectCurrentPageHealth } from '../modules/catalog/page-health.mjs';

const SESSION_HEALTH_CODES=new Set(['STALE_CATEGORY_PAGE','SEARCH_NO_RESULTS','LISTING_NOT_FOUND','NETWORK_ERROR','CAPTCHA_OR_LOGIN','ACCESS_RESTRICTED']);
export const SESSION_CIRCUIT_CODES=new Set(['DETAIL_AVAILABILITY_MISMATCH','DETAIL_AVAILABILITY_UNVERIFIED','SESSION_CONTEXT_PROBLEM']);

export async function prepareReviewCaptureJob(config,{ targetCount=10,jobId=null,now=() => new Date() }={}) {
  const db=openDatabase(config.app.databasePath);
  try {
    const jobs=createJobRepository(db);const reviews=createReviewRepository(db);
    if (jobId) {
      const job=jobs.getJob(jobId);if (!job || job.jobType !== 'reviews') throw new Error(`未找到Day9评论任务：${jobId}`);
      for (const item of jobs.listJobItems(jobId)) {
        const product=db.prepare('SELECT canonical_url FROM products WHERE id=?').get(item.productId);
        if (product?.canonical_url) jobs.upsertJobItem(jobId,{ ...item,sequenceNo:item.sequenceNo,itemKey:item.itemKey,productUrl:product.canonical_url,checkpoint:item.checkpoint });
      }
      return { job,created:false };
    }
    assertStageGate(db,targetCount);
    const analysis=createAnalysisRepository(db);const sourceJobId=analysis.resolveSourceJobId();
    const products=analysis.listActiveProducts(sourceJobId,'week2-motorcycle-fine-v1');
    const knownUnavailable=Number(targetCount) < 512 ? db.prepare(`SELECT DISTINCT goods_id FROM review_capture_coverage
      WHERE stop_reason='PRODUCT_NOT_FOUND'`).all().map(row => String(row.goods_id)):[];
    const queue=buildDay9EligibleQueue(products,{ targetCount,excludeGoodsIds:knownUnavailable });
    const runDate=now();const cutoffDate=daysAgoIso(30,runDate);const coreBefore=analysis.coreCounts();
    const job=jobs.createJob({ jobType:'reviews',mode:'recent_30d',siteCountry:config.catalog.siteCountry,language:config.catalog.language,
      currency:config.catalog.currency,targetCount:queue.selected.length,config:{ day:9,sourceJobId,taxonomy:'week2-motorcycle-fine-v1',eligibleCount:queue.eligible.length,
        manualReviewExcluded:queue.manualReviewExcluded,knownUnavailableExcluded:queue.knownUnavailableExcluded,priorityCounts:queue.priorityCounts,cutoffDate,runDate:runDate.toISOString(),coreBefore } });
    for (const [index,item] of queue.selected.entries()) jobs.upsertJobItem(job.id,{ sequenceNo:index+1,itemKey:item.goodsId,productId:item.productId,productUrl:item.canonicalUrl ?? item.productUrl,
      checkpoint:{ category:item.level3,reviewCount:item.reviewCount,cutoffDate } });
    reviews.initializeCoverage(job.id,queue.selected,cutoffDate);
    return { job:jobs.getJob(job.id),created:true,queue };
  } finally { db.close(); }
}

export async function runReviewCaptureJob(config,{ jobId,dependencies={} }={}) {
  const db=openDatabase(config.app.databasePath);let session=null,detailPage=null;
  const jobs=createJobRepository(db);const service=createJobService(jobs);const control=createJobControl(jobs);const reviews=createReviewRepository(db);
  try {
    let job=jobs.getJob(jobId);if (!job || job.jobType !== 'reviews') throw new Error(`无效Day9评论任务：${jobId}`);
    if (job.status === 'paused' && job.checkpoint?.manualGate) service.resolveManualGate(jobId);
    else if (job.status === 'paused_manual_recovery') {
      if (!job.checkpoint?.manualGate?.validation?.passed) throw new AppError('Session Recovery Validation 尚未通过。',{ code:'SESSION_RECOVERY_NOT_VALIDATED',retriable:true });
      service.resolveSessionRecoveryGate(jobId);
    }
    else if (['paused','interrupted','failed','completed_with_errors'].includes(job.status)) service.resume(jobId);
    else if (job.status === 'pending') service.start(jobId);
    else if (job.status !== 'running') throw new Error(`评论任务状态 ${job.status} 不能执行。`);
    job=jobs.getJob(jobId);
    try {
      session=await (dependencies.openBrowserSession ?? openBrowserSession)(config,dependencies);
      const health=await (dependencies.validateSessionHealth ?? validateReviewSessionHealth)(session,config);
      if (health.status !== 'READY') {
        const changed=reviews.markSessionBlocked(jobId,{ stopReason:health.code,message:`Day9采集前页面健康检查未通过：${health.code}` });
        jobs.appendEvent(jobId,'review_session_not_ready','warn','Day9已阻止采集：Temu列表页未达到READY。',{ code:health.code,changed,checks:health.checks });
        if (SESSION_CIRCUIT_CODES.has(health.code)) await openSessionRecoveryCircuit({ jobs,service,reviews,jobId,reason:health.code,blockedProductIds:[] });
        else service.openManualGate(jobId,{ reason:health.code,message:'Temu列表页异常。请从首页重新进入类目，商品卡片恢复且页面验证为READY后再继续。' });
        throw new AppError(`Temu页面未达到READY：${health.code}`,{ code:'JOB_PAUSED',retriable:true,details:{ healthCode:health.code } });
      }
      detailPage=await session.context.newPage();
    }
    catch (error) {
      if (error?.code === 'JOB_PAUSED') throw error;
      service.interrupt(jobId,{ ...(job.checkpoint ?? {}),phase:'connect_browser',errorCode:error.code ?? 'CDP_UNREACHABLE' });
      throw new AppError(error.message,{ code:'JOB_INTERRUPTED',retriable:true,cause:error });
    }

    const items=jobs.listJobItems(jobId);let processed=0,success=0,failed=0,totalInserted=0,totalDeduplicated=0;
    let sessionSignals=Array.isArray(job.checkpoint?.sessionSignals) ? job.checkpoint.sessionSignals : [];
    let sessionEpoch=reviews.startSessionEpoch(jobId,{ recoveryCount:reviews.latestSessionEpoch(jobId)?.recoveryCount ?? 0 });
    for (const item of items) {
      if (['completed','skipped'].includes(item.status)) { processed+=1;success+=1;continue; }
      const priorCoverage=reviews.getCoverage(jobId,item.productId);
      if (item.status === 'failed' && priorCoverage?.stopReason === 'PRODUCT_NOT_FOUND') { processed+=1;failed+=1;continue; }
      const retrying=item.status === 'failed';jobs.transitionJobItem(jobId,item.itemKey,'running',{ checkpoint:item.checkpoint });
      let coverage=reviews.startProduct(jobId,item.productId,{ retrying });
      const target={ productId:item.productId,goodsId:item.itemKey,productUrl:item.productUrl,reviewCount:item.checkpoint?.reviewCount,
        cutoffDate:coverage.cutoffDate,runDate:new Date(job.config.runDate) };
      try {
        const result=await (dependencies.captureRecentReviews ?? captureRecentReviews)(detailPage,target,config,{
          now:() => new Date().toISOString(),
          onReviews:batch => { const saved=reviews.saveReviews(jobId,batch);totalInserted+=saved.inserted;totalDeduplicated+=saved.deduplicated; },
          onCheckpoint:checkpoint => {
            reviews.savePage(jobId,item.productId,{ pageIndex:checkpoint.pageIndex,reviewsCaptured:checkpoint.reviewsCaptured,
              newestReviewDate:checkpoint.newestCapturedReviewDate,oldestReviewDate:checkpoint.oldestCapturedReviewDate,checkpoint });
            jobs.checkpointJobItem(jobId,item.itemKey,checkpoint);control.checkpointBoundary(jobId,{ phase:'reviews',itemKey:item.itemKey,...checkpoint });
          }
        });
        reviews.finishProduct(jobId,item.productId,result);
        if (['failed','completed_partial'].includes(result.taskStatus)) {
          jobs.transitionJobItem(jobId,item.itemKey,'failed',{ checkpoint:result.checkpoint,errorCode:result.stopReason,errorMessage:result.stopReason });failed+=1;
        } else { jobs.transitionJobItem(jobId,item.itemKey,'completed',{ checkpoint:result.checkpoint });success+=1; }
      } catch (error) {
        coverage=reviews.getCoverage(jobId,item.productId) ?? coverage;const mapped=mapCaptureFailure(error,coverage);
        if (error?.code === 'JOB_PAUSED') {
          reviews.finishProduct(jobId,item.productId,{ taskStatus:'paused',crawlCompleteness:null,stopReason:null,reviewsCaptured:coverage.reviewsCaptured,pagesScanned:coverage.pagesScanned,
            newestCapturedReviewDate:coverage.newestCapturedReviewDate,oldestCapturedReviewDate:coverage.oldestCapturedReviewDate,checkpoint:coverage.checkpoint });
          jobs.transitionJobItem(jobId,item.itemKey,'failed',{ checkpoint:coverage.checkpoint,errorCode:'JOB_PAUSED',errorMessage:error.message });throw error;
        }
        if (error?.code === 'JOB_CANCELLED') {
          reviews.finishProduct(jobId,item.productId,{ taskStatus:'cancelled',crawlCompleteness:null,stopReason:null,reviewsCaptured:coverage.reviewsCaptured,pagesScanned:coverage.pagesScanned,
            newestCapturedReviewDate:coverage.newestCapturedReviewDate,oldestCapturedReviewDate:coverage.oldestCapturedReviewDate,checkpoint:coverage.checkpoint });
          jobs.transitionJobItem(jobId,item.itemKey,'skipped',{ checkpoint:coverage.checkpoint,errorCode:'JOB_CANCELLED',errorMessage:error.message });throw error;
        }
        const sessionProblem=error?.code === 'PRODUCT_NOT_FOUND' || SESSION_CIRCUIT_CODES.has(error?.code);
        const aligned=sessionProblem ? { taskStatus:'blocked',crawlCompleteness:'blocked',stopReason:'SESSION_CONTEXT_PROBLEM',retriable:true } : mapped;
        const result={ ...aligned,reviewsCaptured:coverage.reviewsCaptured,pagesScanned:coverage.pagesScanned,
          newestCapturedReviewDate:coverage.newestCapturedReviewDate,oldestCapturedReviewDate:coverage.oldestCapturedReviewDate,
          checkpoint:coverage.checkpoint,errorCode:sessionProblem ? 'SESSION_CONTEXT_PROBLEM' : (error.code ?? mapped.stopReason),errorMessage:error.message };
        reviews.finishProduct(jobId,item.productId,result);reviews.recordError({ jobId,productId:item.productId,errorCode:result.errorCode,message:error.message,retriable:mapped.retriable,details:error.details });
        jobs.transitionJobItem(jobId,item.itemKey,'failed',{ checkpoint:coverage.checkpoint,errorCode:result.errorCode,errorMessage:error.message });failed+=1;
        if (['CAPTCHA','LOGIN_REQUIRED'].includes(result.stopReason)) { service.openManualGate(jobId,{ reason:result.stopReason,message:'Day9评论页需要人工完成登录或验证码。' });throw new AppError('评论任务已进入人工关卡。',{ code:'JOB_PAUSED',retriable:true }); }
        if (result.stopReason === 'BROWSER_CLOSED') { service.interrupt(jobId,{ phase:'reviews',itemKey:item.itemKey,...coverage.checkpoint });throw new AppError('浏览器关闭，评论任务已保存断点。',{ code:'JOB_INTERRUPTED',retriable:true }); }
        if (sessionProblem) {
          sessionSignals=appendSessionSignal(sessionSignals,{ productId:item.productId,goodsId:item.itemKey,code:result.stopReason,at:new Date().toISOString() });
          control.checkpointBoundary(jobId,{ ...(jobs.getJob(jobId).checkpoint ?? {}),sessionSignals,phase:'session_signal',itemKey:item.itemKey });
          if (sessionCircuitOpen(sessionSignals)) {
            reviews.markSessionUnhealthy(sessionEpoch.sessionEpochId,'SESSION_CONTEXT_PROBLEM');
            await openSessionRecoveryCircuit({ jobs,service,reviews,jobId,reason:'SESSION_CONTEXT_PROBLEM',blockedProductIds:[item.productId],epochId:sessionEpoch.sessionEpochId,signals:sessionSignals });
            throw new AppError('Day9会话熔断已触发，等待人工恢复。',{ code:'JOB_PAUSED',retriable:true });
          }
        } else {
          sessionSignals=[];reviews.markSessionHealthy(sessionEpoch.sessionEpochId);
        }
      }
      processed+=1;
      service.updateCounts(jobId,{ totalItems:items.length,processedItems:processed,successItems:success,failedItems:failed,
        discoveredCount:items.length,storedCount:reviews.countReviews(jobId),errorCount:failed });
      control.checkpointBoundary(jobId,{ phase:'product_complete',itemKey:item.itemKey,processed,total:items.length });
    }
    const coverage=reviews.listCoverage(jobId);const summary=summarizeCoverage(coverage);const qa=reviews.qa(jobId);
    service.updateCounts(jobId,{ totalItems:items.length,processedItems:processed,successItems:success,failedItems:failed,
      discoveredCount:items.length,storedCount:reviews.countReviews(jobId),errorCount:failed });
    service.complete(jobId,{ totalItems:items.length,processedItems:processed,successItems:success,failedItems:failed,
      discoveredCount:items.length,storedCount:reviews.countReviews(jobId),errorCount:failed });
    jobs.appendEvent(jobId,'review_capture_summary',failed ? 'warn':'success','Day9评论采集阶段完成。',{ summary,qa,totalInserted,totalDeduplicated });
    return { job:jobs.getJob(jobId),summary,qa,totalInserted,totalDeduplicated,coverage };
  } finally {
    if (detailPage && !detailPage.isClosed()) await detailPage.close().catch(() => {});
    await (dependencies.closeBrowserSession ?? closeBrowserSession)(session,config).catch(() => {});db.close();
  }
}

function appendSessionSignal(signals,signal) { return [...signals,signal].slice(-5); }
export function sessionCircuitOpen(signals) {
  const recent=signals.slice(-5);
  let tail=0;for (let i=recent.length-1;i>=0 && SESSION_CIRCUIT_CODES.has(recent[i].code);i-=1) tail+=1;
  return tail >= 2 || recent.filter(signal => SESSION_CIRCUIT_CODES.has(signal.code)).length >= 3;
}
async function openSessionRecoveryCircuit({ jobs,service,reviews,jobId,reason,blockedProductIds,epochId=null,signals=[] }) {
  const changed=reviews.markSessionBlocked(jobId,{ stopReason:'SESSION_CONTEXT_PROBLEM',errorCode:'SESSION_CONTEXT_PROBLEM',message:'External Chrome 商品上下文异常；不是商品真实下架。',productIds:blockedProductIds });
  jobs.appendEvent(jobId,'review_session_circuit_open','warn','会话熔断已打开，剩余商品保持 pending，不再访问。',{ reason,changed,blockedProductIds,signals,epochId });
  service.openSessionRecoveryGate(jobId,{ epochId, message:'External Chrome 当前商品上下文异常。请人工回 Temu 首页或目标类目，确认 Germany / English / EUR，重新进入 Motorcycle Accessories / Top Sales 并打开一个正常商品；如有验证码或登录请人工完成。' });
}

export async function validateSessionRecovery(config,{ jobId,dependencies={} }={}) {
  const db=openDatabase(config.app.databasePath);let session=null;
  const jobs=createJobRepository(db);const reviews=createReviewRepository(db);const service=createJobService(jobs);
  const required=Number(config.reviews?.sessionRecoveryMinimumAvailable ?? 2);
  try {
    const job=jobs.getJob(jobId);if (!job || job.jobType !== 'reviews') throw new Error(`无效Day9评论任务：${jobId}`);
    if (job.status !== 'paused_manual_recovery') throw new AppError('任务当前不在会话恢复关卡。',{ code:'MANUAL_GATE_NOT_WAITING' });
    session=await (dependencies.openBrowserSession ?? openBrowserSession)(config,dependencies);
    const listingPage=await findCurrentOperatorTemuPage(session.context);
    if (!listingPage) return recordRecoveryValidation(service,reviews,job,{ passed:false,availableCount:0,required,checks:{ TEMU_PAGE:false } });
    const listingHealth=await inspectCurrentPageHealth(listingPage,config,config.catalog.jobs?.[0]);
    if (listingHealth.status !== 'READY') return recordRecoveryValidation(service,reviews,job,{ passed:false,availableCount:0,required,checks:listingHealth.checks,code:listingHealth.code });
    const controls=selectControlProducts(jobs.listJobItems(jobId),config);
    const checks=await validateControlProducts(session.context,controls);
    const availableCount=checks.filter(check => check.status === 'available').length;
    const passed=availableCount >= required;
    const epochId=job.checkpoint?.manualGate?.epochId ?? reviews.latestSessionEpoch(jobId)?.sessionEpochId;
    if (epochId) {
      reviews.saveControlChecks(epochId,jobId,checks);
      if (passed) reviews.markSessionRecovered(epochId); else reviews.markSessionUnhealthy(epochId,'SESSION_CONTEXT_PROBLEM');
    }
    return recordRecoveryValidation(service,reviews,job,{ passed,availableCount,required:2,checks:listingHealth.checks,controlChecks:checks,epochId });
  } catch (error) {
    const job=jobs.getJob(jobId);
    if (job?.status === 'paused_manual_recovery') return recordRecoveryValidation(service,reviews,job,{ passed:false,availableCount:0,required,code:error.code ?? 'CDP_UNREACHABLE',checks:{} });
    throw error;
  } finally { await (dependencies.closeBrowserSession ?? closeBrowserSession)(session,config).catch(() => {});db.close(); }
}

function recordRecoveryValidation(service,reviews,job,validation) {
  const result={ ...validation,validatedAt:new Date().toISOString() };
  service.recordSessionRecoveryValidation(job.id,result);
  return result;
}
function selectControlProducts(items,config) {
  const configured=new Set((config.reviews?.sessionControlGoodsIds ?? []).map(String));
  const chosen=[];
  for (const item of items) if (configured.has(String(item.itemKey))) chosen.push(item);
  for (const item of items) if (!chosen.includes(item) && chosen.length<3) chosen.push(item);
  return chosen.slice(0,3).map(item => ({ productId:item.productId,goodsId:item.itemKey,sourceUrl:item.productUrl }));
}
export async function validateControlProducts(context,controls) {
  const results=[];
  for (const control of controls) {
    const page=await context.newPage();
    try {
      await page.goto(control.sourceUrl,{ waitUntil:'domcontentloaded',timeout:30_000 });
      await page.waitForTimeout?.(300);
      const detail=await page.evaluate(() => ({ body:document.body?.innerText ?? '',purchaseAction:[...document.querySelectorAll('button,[role="button"]')].some(node => /^(?:add to (?:cart|bag)|buy now)$/i.test((node.textContent ?? '').trim())) })).catch(() => ({ body:'',purchaseAction:false }));
      results.push({ ...control,status:classifyDetailAvailability(detail.body,{ purchaseAction:detail.purchaseAction }),details:{ purchaseAction:detail.purchaseAction } });
    } catch (error) { results.push({ ...control,status:'unknown',details:{ code:error?.code ?? 'PROVIDER_ERROR' } }); }
    finally { await page.close().catch(() => {}); }
  }
  return results;
}

export async function validateReviewSessionHealth(session,config) {
  const page=await findCurrentOperatorTemuPage(session.context);
  if (!page) return { status:'NOT_READY',code:'WRONG_PAGE',checks:{ TEMU_PAGE:false,PAGE_HEALTH:'WRONG_PAGE' } };
  const health=await inspectCurrentPageHealth(page,config,config.catalog.jobs?.[0]);
  if (SESSION_HEALTH_CODES.has(health.code) || health.status !== 'READY') return health;
  return validateListingDetailAvailability(page,session.context,config,health);
}

export async function validateListingDetailAvailability(listingPage,context,config,health) {
  const selector=config.catalog?.selectors?.productLinks ?? "a[href*='goods.html'], a[href*='-g-']";
  const urls=await listingPage.locator(selector).evaluateAll(nodes => [...new Set(nodes.map(node => node.href).filter(Boolean))].slice(0,3)).catch(() => []);
  const checked=[];
  for (const url of urls) {
    const page=await context.newPage();
    try {
      await page.goto(url,{ waitUntil:'domcontentloaded',timeout:30_000 });
      await page.waitForFunction(() => {
        const text=document.body?.innerText ?? '';
        const purchase=[...document.querySelectorAll('button,[role="button"]')].some(node =>
          /^(?:add to (?:cart|bag)|buy now)$/i.test((node.textContent ?? '').trim()));
        return /This item is sold out|items? (?:are|is) gone|currently unavailable|商品不存在|商品已下架|商品已售罄/i.test(text) || purchase;
      },null,{ timeout:12_000 }).catch(() => {});
      const detail=await page.evaluate(() => ({
        body:document.body?.innerText ?? '',
        purchaseAction:[...document.querySelectorAll('button,[role="button"]')].some(node =>
          /^(?:add to (?:cart|bag)|buy now)$/i.test((node.textContent ?? '').trim()))
      })).catch(() => ({ body:'',purchaseAction:false }));
      const availability=classifyDetailAvailability(detail.body,{ purchaseAction:detail.purchaseAction });checked.push(availability);
      if (availability === 'available') return { ...health,detailAvailability:{ status:'available',checked } };
    } finally { await page.close().catch(() => {}); }
  }
  const code=checked.length && checked.every(status => status === 'unavailable')
    ? 'DETAIL_AVAILABILITY_MISMATCH':'DETAIL_AVAILABILITY_UNVERIFIED';
  return { ...health,status:'NOT_READY',code,
    checks:{ ...health.checks,PRODUCT_LIST_VISIBLE:false,PAGE_HEALTH:code },
    detailAvailability:{ status:'unavailable',checked } };
}

export function classifyDetailAvailability(body,{ purchaseAction=false }={}) {
  const text=String(body ?? '');
  if (/This item is sold out|items? (?:are|is) gone|currently unavailable|商品不存在|商品已下架|商品已售罄/i.test(text)) return 'unavailable';
  if (purchaseAction) return 'available';
  return 'unknown';
}

export function reviewCaptureQa(config,jobId) {
  const db=openDatabase(config.app.databasePath,{ readOnly:true });
  try {
    const jobs=createJobRepository(db);const reviews=createReviewRepository(db);const analysis=createAnalysisRepository(db);const job=jobs.getJob(jobId);
    if (!job || job.jobType !== 'reviews') throw new Error(`无效Day9评论任务：${jobId}`);
    const coverage=reviews.listCoverage(jobId);const qa=reviews.qa(jobId);const coreAfter=analysis.coreCounts();const coreBefore=job.config.coreBefore;
    const coreUnchanged=JSON.stringify(coreBefore) === JSON.stringify(coreAfter);
    const captureFinished=['completed','completed_with_errors'].includes(job.status) && coverage.every(item => item.crawlCompleteness !== null);
    const actionableFailures=coverage.filter(item => ['failed','blocked'].includes(item.crawlCompleteness));
    return { job,summary:summarizeCoverage(coverage),qa,coreBefore,coreAfter,coreUnchanged,captureFinished,
      actionableFailures:actionableFailures.length,
      pass:captureFinished && actionableFailures.length === 0 && Object.values(qa).every(value => value === 0) && coreUnchanged,coverage };
  } finally { db.close(); }
}

export function approveReviewStage(config,jobId,{ manualCheckedGoodsIds=[] }={}) {
  if (manualCheckedGoodsIds.length < 3) throw new Error('阶段验收至少需要人工核对3个goods_id。');
  const result=reviewCaptureQa(config,jobId);if (!result.pass) throw new Error('Day9阶段QA未通过，不能批准扩量。');
  const db=openDatabase(config.app.databasePath);try { const jobs=createJobRepository(db);jobs.appendEvent(jobId,'day9_stage_passed','success','Day9阶段验收已批准。',{ targetCount:result.job.targetCount,manualCheckedGoodsIds }); } finally { db.close(); }
  return result;
}

function assertStageGate(db,targetCount) {
  const prerequisite=targetCount === 50 ? 10:targetCount === 100 ? 50:targetCount >= 512 ? 100:null;if (!prerequisite) return;
  const passed=db.prepare(`SELECT j.id FROM crawl_jobs j JOIN crawl_events e ON e.job_id=j.id AND e.event_type='day9_stage_passed'
    WHERE j.job_type='reviews' AND j.target_count=? ORDER BY e.created_at DESC LIMIT 1`).get(prerequisite);
  if (!passed) throw new Error(`Day9 ${prerequisite}商品阶段尚未PASS，禁止扩量到${targetCount}。`);
}
