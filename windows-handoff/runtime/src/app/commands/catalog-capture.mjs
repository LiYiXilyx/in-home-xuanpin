import { connectOperatorSession, closeBrowserSession } from '../../browser/cdp-session.mjs';
import { requireCurrentOperatorTemuPage } from '../../browser/operator-page.mjs';
import { openDatabase } from '../../db/client.mjs';
import { migrateDatabase } from '../../db/migrate.mjs';
import { createJobRepository } from '../../db/repositories/job-repository.mjs';
import { createJobControl } from '../../jobs/job-control.mjs';
import { createJobService } from '../../jobs/job-service.mjs';
import { AppError } from '../../shared/errors.mjs';
import { captureCurrentPage, printQualityPreview, sanitizeListingUrl, saveCaptureResult } from '../../modules/catalog/capture-current-page.mjs';
import { cacheProductImages } from '../../modules/products/image-cache.mjs';
import { createProductService } from '../../modules/products/product-service.mjs';

const MANUAL_GATE_CODES = new Set(['CAPTCHA_OR_LOGIN','ACCESS_RESTRICTED','NETWORK_ERROR','LOAD_MORE_MANUAL_REQUIRED']);

export async function runCatalogCaptureCommand(config, options = {}) {
  validateSingleJob(config);
  const targetCount = validTarget(options.targetCount ?? config.catalog.jobs[0].targetCount ?? config.catalog.targetCount);
  migrateDatabase({ databasePath: config.app.databasePath });
  const db = openDatabase(config.app.databasePath);
  const repository = createJobRepository(db);
  const service = createJobService(repository);
  const configuredJob = config.catalog.jobs[0];
  const job = service.create({
    jobType: 'catalog',mode: options.dryRun ? 'operator_current_page_dry_run' : 'operator_current_page',
    siteCountry: config.catalog.siteCountry,language: config.catalog.language,currency: config.catalog.currency,
    primaryCategory: configuredJob.primaryCategory,subcategory: configuredJob.subcategory,
    sourceUrl: configuredJob.url,sortOrder: configuredJob.sortOrder,targetCount,
    config: { dryRun: Boolean(options.dryRun),day: 4 }
  });
  try {
    return await executeCatalogJob(config,db,repository,service,job,{ ...options,targetCount,startMode: 'start' });
  } finally { db.close(); }
}

export async function runCatalogResumeCommand(config,jobId,{ retry = false } = {}) {
  if (!jobId) throw new AppError('resume/retry 必须提供 --job <JOB_ID>。',{ code: 'JOB_ID_REQUIRED' });
  validateSingleJob(config);
  migrateDatabase({ databasePath: config.app.databasePath });
  const db = openDatabase(config.app.databasePath);
  const repository = createJobRepository(db);
  const service = createJobService(repository);
  try {
    let job = service.get(jobId);
    if (!job || job.jobType !== 'catalog') throw new AppError(`catalog 任务不存在：${jobId}`,{ code: 'JOB_NOT_FOUND' });
    if (job.status === 'running') {
      service.interrupt(job.id,{ ...(job.checkpoint ?? {}),lastEvent: 'resume_detected_previous_process_exit' });
      job = service.get(job.id);
    }
    let startMode = job.status === 'pending' ? 'start' : retry || ['failed','completed_with_errors'].includes(job.status) ? 'retry' : 'resume';
    if (!retry && job.status === 'paused' && job.checkpoint?.manualGate) {
      service.resolveManualGate(job.id);
      job = service.get(job.id);
      startMode = 'started';
    }
    return await executeCatalogJob(config,db,repository,service,job,{ targetCount: job.targetCount,startMode });
  } finally { db.close(); }
}

async function executeCatalogJob(config,db,repository,service,job,options) {
  const control = createJobControl(repository);
  if (options.startMode === 'retry') service.retry(job.id);
  else if (options.startMode === 'resume') service.resume(job.id);
  else if (options.startMode !== 'started') service.start(job.id);
  let session;
  let latestCheckpoint = service.get(job.id).checkpoint ?? {};
  const interrupt = () => {
    try {
      if (service.get(job.id)?.status === 'running') service.interrupt(job.id,{ ...latestCheckpoint,lastEvent: 'process_signal' });
    } finally { process.exit(130); }
  };
  process.once('SIGINT',interrupt);
  process.once('SIGTERM',interrupt);
  const heartbeat = setInterval(() => {
    try {
      if (service.get(job.id)?.status === 'running') service.heartbeat(job.id,latestCheckpoint);
    } catch {}
  },Math.max(1000,Number(config.browser?.heartbeatIntervalMs ?? 5000)));
  heartbeat.unref();
  try {
    session = await connectOperatorSession(config);
    repository.appendEvent(job.id,'browser_connected','info','已连接独立采集 Chrome。');
    const page = await requireCurrentOperatorTemuPage(session.context);
    repository.updateSourceUrl(job.id,sanitizeListingUrl(page.url()));
    console.log('已连接人工操作的独立 Chrome；恢复会重新扫描当前页，并由唯一键保证幂等。');
    const result = await captureCurrentPage(page,config,{ ...config.catalog.jobs[0],targetCount: options.targetCount },{
      jobId: job.id,targetCount: options.targetCount,
      onValidated: validation => repository.appendEvent(job.id,'page_validated','success','当前 Temu 类目和 Top Sales 页面验证通过。',{
        productLinkCount:validation.productLinkCount,htmlLang:validation.htmlLang
      }),
      onRound: state => {
        latestCheckpoint = { phase: 'listing_scroll',...state,latestCheckpointAt: new Date().toISOString() };
        repository.updateCounts(job.id,{ discoveredCount: state.discovered });
        control.checkpointBoundary(job.id,latestCheckpoint);
        repository.appendEvent(job.id,'listing_round_completed','info',`第 ${state.round} 轮完成，已发现 ${state.discovered} 个商品。`,{
          round:state.round,discovered:state.discovered,targetCount:state.targetCount
        });
        repository.appendEvent(job.id,'checkpoint_saved','debug','采集检查点已保存。',{
          phase:'listing_scroll',round:state.round,currentCount:state.discovered
        });
      },
      onLoadMore: event => {
        const messages = {
          load_more_detected: `检测到底部加载按钮：${event.label ?? 'load more'}。`,
          load_more_clicked: `已点击底部加载按钮：${event.label ?? 'load more'}。`,
          load_more_completed: '底部扩展加载完成，继续扫描商品。',
          load_more_failed: '底部加载按钮点击失败，将在安全边界重试。'
        };
        repository.appendEvent(job.id,event.eventType,event.eventType === 'load_more_failed' ? 'warn' : 'info',
          messages[event.eventType] ?? '底部加载状态已更新。',{
            round:event.round,discovered:event.discovered,label:event.label ?? null,
            errorCode:event.errorCode ?? null
          });
      }
    });
    printQualityPreview(result);
    latestCheckpoint = { phase: 'listing_complete',scrollRound: result.rounds,
      discoveredGoodsIds: result.products.map(item => item.goods_id),currentCount: result.products.length,
      lastEvent: 'listing_capture_completed',latestCheckpointAt: new Date().toISOString() };
    control.checkpointBoundary(job.id,latestCheckpoint);
    let imageCache = { results: [],downloaded: 0,failed: 0,errors: [] };
    let persistence = null;
    if (!options.dryRun) {
      imageCache = await cacheProductImages(result.products,{
        cacheDir: config.export.imageCacheDir,minimumBytes: config.catalog.capture?.imageMinimumBytes ?? 1024,
        timeoutMs: config.catalog.capture?.imageTimeoutMs ?? 30_000,
        concurrency: config.catalog.capture?.imageConcurrency ?? 3
      });
      const currentJob = service.get(job.id);
      persistence = createProductService(db).persistCatalogBatch(currentJob,result.products,{
        images: imageCache.results,
        minSafeCount: Math.max(Number(config.catalog.capture?.minSafeCount ?? 1),Number(options.targetCount)),
        quality: config.catalog.quality
      });
    }
    const resultPath = await saveCaptureResult(result,config,job.id,{
      dry_run: Boolean(options.dryRun),accepted: true,image_cache: imageCache,persistence
    });
    const stored = options.dryRun ? 0 : persistence.products;
    service.updateCounts(job.id,{ totalItems: options.targetCount,processedItems: result.products.length,
      successItems: result.products.length,failedItems: 0,discoveredCount: result.quality.unique_goods_id_count,
      storedCount: stored,errorCount: imageCache.failed });
    repository.heartbeat(job.id,{ ...latestCheckpoint,phase: 'persisted',
      currentCount: options.dryRun ? result.products.length : stored,lastEvent: 'batch_persisted' });
    service.complete(job.id,{ failedItems: 0,captured: result.products.length,stored,imageErrors: imageCache.failed });
    const summary = { jobId: job.id,dryRun: Boolean(options.dryRun),products: result.products.length,
      quality: result.quality,imageCache,persistence,resultPath };
    console.log(JSON.stringify({ jobId: job.id,products: summary.products,stored,
      snapshotsInserted: persistence?.insertedSnapshots ?? 0,imageDownloaded: imageCache.downloaded,
      imageFailed: imageCache.failed,resultPath },null,2));
    return summary;
  } catch (error) {
    const current = service.get(job.id);
    if (current?.status === 'running' && MANUAL_GATE_CODES.has(error?.code)) {
      service.openManualGate(job.id,{ reason: error.code,message: error.message });
    } else if (current?.status === 'running' && !['JOB_PAUSED','JOB_CANCELLED'].includes(error?.code)) {
      service.fail(job.id,error);
    }
    error.jobId = job.id;
    throw error;
  } finally {
    clearInterval(heartbeat);
    process.removeListener('SIGINT',interrupt);
    process.removeListener('SIGTERM',interrupt);
    await closeBrowserSession(session,config);
  }
}

function validateSingleJob(config) {
  if (config.catalog.jobs.length !== 1) throw new AppError('当前页采集一次只允许配置一个类目。',{ code: 'CATALOG_JOB_COUNT_INVALID' });
}
function validTarget(value) {
  const target = Number(value);
  if (!Number.isInteger(target) || target < 1) throw new AppError('--target 必须是正整数。',{ code: 'TARGET_INVALID' });
  return target;
}
