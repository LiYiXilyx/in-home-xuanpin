import { AppError } from '../../shared/errors.mjs';
import { transaction } from '../../db/client.mjs';
import { createProductRepository } from '../../db/repositories/product-repository.mjs';
import { createCatalogRepository } from '../../db/repositories/catalog-repository.mjs';
import { createSnapshotRepository } from '../../db/repositories/snapshot-repository.mjs';
import { createImageRepository } from '../../db/repositories/image-repository.mjs';
import { checkCatalogQuality, saveQualityChecks } from './quality-checker.mjs';

export function createProductService(db, { now = () => new Date().toISOString() } = {}) {
  const products = createProductRepository(db, { now });
  const catalogs = createCatalogRepository(db);
  const snapshots = createSnapshotRepository(db);
  const images = createImageRepository(db, { now });

  function persistCatalogBatch(job, capturedProducts, options = {}) {
    const scope = scopeFromJob(job);
    const quality = checkCatalogQuality(capturedProducts, options.quality);
    const minSafeCount = Number(options.minSafeCount ?? job.targetCount ?? 1);
    const oldActiveCount = catalogs.activeCount(scope);
    const safeCountPassed = capturedProducts.length >= minSafeCount;
    const oldPoolPassed = oldActiveCount === 0 || capturedProducts.length >= oldActiveCount;
    const accepted = safeCountPassed && oldPoolPassed && quality.passed;
    if (!accepted) {
      transaction(db, () => saveQualityChecks(db, job.id, addSafetyMetrics(quality, {
        safeCountPassed,oldPoolPassed,minSafeCount,oldActiveCount,capturedCount: capturedProducts.length
      }), { now }));
      throw new AppError('本批商品未通过安全数量或数据质量门，当前 active 商品池保持不变。', {
        code: 'CATALOG_POOL_SAFETY_REJECTED', retriable: true,
        details: { capturedCount: capturedProducts.length,minSafeCount,oldActiveCount,safeCountPassed,oldPoolPassed,
          failedChecks: quality.metrics.filter(item => !item.passed).map(item => item.code) }
      });
    }
    const imageByGoodsId = new Map((options.images ?? []).map(item => [String(item.goods_id),item]));
    const result = transaction(db, () => {
      const productIds = [];
      let insertedSnapshots = 0;
      for (const product of capturedProducts) {
        const identity = products.upsert(product);
        productIds.push(identity.id);
        if (snapshots.insert(job.id,identity.id,product).inserted) insertedSnapshots += 1;
        catalogs.upsert(identity.id,scope,product,job.id);
        const image = imageByGoodsId.get(String(product.goods_id)) ?? (product.image_url ? {
          goods_id: product.goods_id,source_url: product.image_url,status: 'pending'
        } : null);
        if (image) images.upsert(identity.id,image);
        linkCompletedJobItem(db,job.id,identity.id,product,image);
      }
      const deactivated = catalogs.deactivateMissing(scope,productIds,job.id,now());
      const completeQuality = addSafetyMetrics(quality, {
        safeCountPassed,oldPoolPassed,minSafeCount,oldActiveCount,capturedCount: capturedProducts.length
      });
      saveQualityChecks(db,job.id,completeQuality,{ now });
      return { products: capturedProducts.length,insertedSnapshots,deactivated,oldActiveCount,
        activeCount: catalogs.activeCount(scope),quality: completeQuality };
    });
    return result;
  }

  return { persistCatalogBatch, products, catalogs, snapshots };
}

export function scopeFromJob(job) {
  return { siteCountry: job.siteCountry,language: job.language,currency: job.currency,
    primaryCategory: job.primaryCategory,subcategory: job.subcategory,sortOrder: job.sortOrder,
    sourcePageUrl: job.sourceUrl };
}

function linkCompletedJobItem(db,jobId,productId,product,image) {
  db.prepare(`INSERT INTO crawl_job_items(
    job_id,sequence_no,item_key,product_id,product_url,status,attempt_count,checkpoint_json,started_at,finished_at
  ) VALUES(?,?,?,?,?,'completed',1,?,?,?)
  ON CONFLICT(job_id,item_key) DO UPDATE SET
    sequence_no=excluded.sequence_no,product_id=excluded.product_id,product_url=excluded.product_url,
    status='completed',checkpoint_json=excluded.checkpoint_json,
    started_at=COALESCE(crawl_job_items.started_at,excluded.started_at),finished_at=excluded.finished_at,
    error_code=NULL,error_message=NULL`).run(jobId,product.listing_rank,String(product.goods_id),productId,
      product.source_url ?? product.canonical_url,JSON.stringify({ product,image }),product.captured_at,product.captured_at);
}

function addSafetyMetrics(report, values) {
  const safety = [
    { code: 'minimum_safe_count',actual: values.capturedCount,threshold: values.minSafeCount,unit: 'count',passed: values.safeCountPassed,samples: [] },
    { code: 'active_pool_non_decrease',actual: values.capturedCount,threshold: values.oldActiveCount,unit: 'count',passed: values.oldPoolPassed,samples: [] }
  ];
  return { ...report,metrics: [...report.metrics,...safety],passed: report.passed && values.safeCountPassed && values.oldPoolPassed };
}
