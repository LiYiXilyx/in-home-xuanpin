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

const MANUAL_GATE_CODES = new Set(['CAPTCHA_OR_LOGIN', 'ACCESS_RESTRICTED', 'NETWORK_ERROR']);

export async function runCatalogCaptureCommand(config, options = {}) {
  if (config.catalog.jobs.length !== 1) {
    throw new AppError('当前页采集一次只允许配置一个类目。', { code: 'CATALOG_JOB_COUNT_INVALID' });
  }
  const targetCount = Number(options.targetCount ?? config.catalog.jobs[0].targetCount ?? config.catalog.targetCount);
  if (!Number.isInteger(targetCount) || targetCount < 1) throw new AppError('--target 必须是正整数。', { code: 'TARGET_INVALID' });
  migrateDatabase({ databasePath: config.app.databasePath });
  const db = openDatabase(config.app.databasePath);
  const repository = createJobRepository(db);
  const service = createJobService(repository);
  const control = createJobControl(repository);
  const configuredJob = config.catalog.jobs[0];
  const job = service.create({
    jobType: 'catalog', mode: options.dryRun ? 'operator_current_page_dry_run' : 'operator_current_page',
    siteCountry: config.catalog.siteCountry, language: config.catalog.language, currency: config.catalog.currency,
    primaryCategory: configuredJob.primaryCategory, subcategory: configuredJob.subcategory,
    sourceUrl: configuredJob.url, sortOrder: configuredJob.sortOrder, targetCount,
    config: { dryRun: Boolean(options.dryRun), day: 3 }
  });
  let session;
  try {
    service.start(job.id);
    session = await connectOperatorSession(config);
    const page = await requireCurrentOperatorTemuPage(session.context);
    repository.updateSourceUrl(job.id, sanitizeListingUrl(page.url()));
    console.log('已连接人工操作的独立 Chrome；程序只读取当前页面，不导航、不切换类目、不改变排序。');
    const result = await captureCurrentPage(page, config, { ...configuredJob, targetCount }, {
      jobId: job.id, targetCount,
      onRound: state => control.checkpointBoundary(job.id, { phase: 'listing_scroll', ...state })
    });
    printQualityPreview(result);
    service.updateCounts(job.id, {
      totalItems: targetCount, processedItems: 0, successItems: 0, failedItems: 0,
      discoveredCount: result.quality.unique_goods_id_count, storedCount: 0, errorCount: 0
    });
    if (result.products.length < targetCount) {
      await saveCaptureResult(result, config, job.id, { dry_run: Boolean(options.dryRun), accepted: false });
      throw new AppError(`只累计到 ${result.products.length} 个唯一商品，未达到目标 ${targetCount}；未持久化任务项。`, {
        code: 'CATALOG_TARGET_NOT_REACHED', retriable: true
      });
    }
    if (result.quality.completeness_percent.goods_id !== 100 || result.quality.completeness_percent.canonical_url !== 100) {
      await saveCaptureResult(result, config, job.id, { dry_run: Boolean(options.dryRun), accepted: false });
      throw new AppError('goods_id 或 canonical_url 完整率未达到 100%；未持久化任务项。', { code: 'CATALOG_IDENTITY_QUALITY_FAILED' });
    }
    let images = { results: [], downloaded: 0, failed: 0, errors: [] };
    if (!options.dryRun) {
      images = await cacheProductImages(result.products, {
        cacheDir: config.export.imageCacheDir, minimumBytes: config.catalog.capture?.imageMinimumBytes ?? 1024,
        timeoutMs: config.catalog.capture?.imageTimeoutMs ?? 30_000,
        concurrency: config.catalog.capture?.imageConcurrency ?? 3
      });
      for (const product of result.products) {
        const image = images.results.find(item => item.goods_id === product.goods_id) ?? null;
        repository.upsertJobItem(job.id, {
          sequenceNo: product.listing_rank, itemKey: product.goods_id, productUrl: product.canonical_url,
          checkpoint: { product, image }
        });
        repository.transitionJobItem(job.id, product.goods_id, 'running');
        repository.transitionJobItem(job.id, product.goods_id, 'completed', { checkpoint: { product, image } });
      }
      for (const imageError of images.errors) {
        repository.appendEvent(job.id, 'image_cache_failed', 'warn', `商品 ${imageError.goods_id} 主图缓存失败。`, {
          goodsId: imageError.goods_id, errorCode: imageError.error_code, message: imageError.error_message
        });
      }
    }
    const resultPath = await saveCaptureResult(result, config, job.id, {
      dry_run: Boolean(options.dryRun), accepted: true, image_cache: images
    });
    const stored = options.dryRun ? 0 : result.products.length;
    service.updateCounts(job.id, {
      totalItems: targetCount, processedItems: result.products.length, successItems: result.products.length,
      failedItems: 0, discoveredCount: result.quality.unique_goods_id_count, storedCount: stored, errorCount: images.failed
    });
    service.complete(job.id, { failedItems: 0, captured: result.products.length, stored, imageErrors: images.failed });
    const summary = { jobId: job.id, dryRun: Boolean(options.dryRun), products: result.products.length,
      quality: result.quality, images, resultPath };
    console.log(JSON.stringify({ jobId: summary.jobId, dryRun: summary.dryRun, products: summary.products,
      imageDownloaded: images.downloaded, imageFailed: images.failed, resultPath }, null, 2));
    return summary;
  } catch (error) {
    const current = service.get(job.id);
    if (current?.status === 'running' && MANUAL_GATE_CODES.has(error?.code)) {
      service.openManualGate(job.id, { reason: error.code, message: error.message });
    } else if (current?.status === 'running' && !['JOB_PAUSED', 'JOB_CANCELLED'].includes(error?.code)) {
      service.fail(job.id, error);
    }
    error.jobId = job.id;
    throw error;
  } finally {
    await closeBrowserSession(session, config);
    db.close();
  }
}
