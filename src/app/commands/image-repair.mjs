import fs from 'node:fs/promises';
import path from 'node:path';
import { connectOperatorSession,closeBrowserSession } from '../../browser/cdp-session.mjs';
import { requireCurrentOperatorTemuPage } from '../../browser/operator-page.mjs';
import { openDatabase,transaction } from '../../db/client.mjs';
import { migrateDatabase } from '../../db/migrate.mjs';
import { createImageRepository } from '../../db/repositories/image-repository.mjs';
import { cacheProductImages,createBrowserImageFetcher,validateLocalImage } from '../../modules/products/image-cache.mjs';

export async function runImageRepairCommand(config,options = {}) {
  migrateDatabase({ databasePath: config.app.databasePath });
  const db = openDatabase(config.app.databasePath);
  const baseDir = path.dirname(config.configPath);
  const limit = options.limit == null ? null : Number(options.limit);
  const dryRun = Boolean(options.dryRun);
  const cacheDir = dryRun
    ? path.join(config.export.outputDir,'day4-5-image-sample')
    : config.export.imageCacheDir;
  const before = coreCounts(db);
  let session;
  try {
    const candidates = listActiveImageCandidates(db,{ limit });
    session = await connectOperatorSession(config);
    const page = await requireCurrentOperatorTemuPage(session.context);
    const result = await cacheProductImages(candidates,{
      cacheDir,baseDir,browserFetch: createBrowserImageFetcher(page),
      minimumBytes: config.catalog.capture.imageMinimumBytes,
      timeoutMs: config.catalog.capture.imageTimeoutMs,
      concurrency: config.catalog.capture.imageConcurrency,
      attemptsPerStrategy: 2,
      onResult: item => console.log(`[${item.fetch_strategy}] ${item.goods_id}: ${item.download_status}`)
    });
    if (!dryRun) {
      const repository = createImageRepository(db);
      transaction(db,() => {
        for (const item of result.results) {
          const candidate = candidates.find(product => product.goods_id === item.goods_id);
          repository.upsert(candidate.product_id,item);
        }
      });
    }
    const coverage = await calculateUsableCoverage(db,{ baseDir,minimumBytes: config.catalog.capture.imageMinimumBytes });
    const after = coreCounts(db);
    const report = {
      dryRun,limit,cacheDir:path.relative(baseDir,cacheDir).replaceAll('\\','/'),
      candidates:candidates.length,downloaded:result.downloaded,failed:result.failed,
      strategies:{ cache:result.reused,browser:result.browser,node:result.node,failed:result.failed },
      results:result.results.map(item => ({ goods_id:item.goods_id,rank:candidates.find(product => product.goods_id === item.goods_id)?.rank,
        title:candidates.find(product => product.goods_id === item.goods_id)?.title,source_url:item.source_url,
        local_path:item.local_path,download_status:item.download_status,fetch_strategy:item.fetch_strategy,
        content_type:item.content_type,byte_length:item.byte_length,content_sha256:item.content_sha256,
        error_code:item.error_code,attempts:item.attempts })),
      coverage,before,after,coreCountsUnchanged: JSON.stringify(before) === JSON.stringify(after)
    };
    const reportDir = path.join(config.export.outputDir,'day4-5-image-repair');
    await fs.mkdir(reportDir,{ recursive: true });
    const reportPath = path.join(reportDir,dryRun ? 'sample-10.json' : 'active-300.json');
    await fs.writeFile(reportPath,JSON.stringify(report,null,2),'utf8');
    console.log(JSON.stringify({ ...report,results: undefined,reportPath },null,2));
    return { ...report,reportPath };
  } finally {
    await closeBrowserSession(session,config);
    db.close();
  }
}

export function listActiveImageCandidates(db,{ limit = null } = {}) {
  const sql = `SELECT p.id AS product_id,p.external_product_id AS goods_id,
    m.current_rank AS rank,COALESCE(s.title,p.title) AS title,s.image_url,
    (SELECT pi.local_path FROM product_images pi WHERE pi.product_id=p.id AND pi.download_status='completed'
      ORDER BY pi.updated_at DESC LIMIT 1) AS existing_local_path
    FROM catalog_memberships m
    JOIN products p ON p.id=m.product_id
    JOIN product_snapshots s ON s.id=(SELECT ps.id FROM product_snapshots ps WHERE ps.product_id=p.id
      ORDER BY ps.captured_at DESC,ps.id DESC LIMIT 1)
    WHERE m.active=1 ORDER BY m.current_rank${limit ? ' LIMIT ?' : ''}`;
  return (limit ? db.prepare(sql).all(limit) : db.prepare(sql).all()).map(row => ({
    product_id:Number(row.product_id),goods_id:String(row.goods_id),rank:Number(row.rank),title:row.title,
    image_url:row.image_url,existing_local_path:row.existing_local_path
  }));
}

export async function calculateUsableCoverage(db,{ baseDir,minimumBytes = 1024 } = {}) {
  const active = db.prepare(`SELECT p.id AS product_id FROM catalog_memberships m
    JOIN products p ON p.id=m.product_id WHERE m.active=1`).all();
  let usable = 0;
  for (const product of active) {
    const images = db.prepare(`SELECT local_path FROM product_images
      WHERE product_id=? AND download_status='completed' AND local_path IS NOT NULL ORDER BY updated_at DESC`).all(product.product_id);
    let valid = false;
    for (const image of images) {
      const absolutePath = path.isAbsolute(image.local_path) ? image.local_path : path.resolve(baseDir,image.local_path);
      if ((await validateLocalImage(absolutePath,{ minimumBytes })).valid) { valid = true; break; }
    }
    if (valid) usable += 1;
  }
  return { active:active.length,usable,missing:active.length - usable,coverage:active.length ? Number((usable / active.length).toFixed(6)) : 0 };
}

function coreCounts(db) {
  return {
    products:Number(db.prepare('SELECT COUNT(*) AS count FROM products').get().count),
    activeMemberships:Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').get().count),
    snapshots:Number(db.prepare('SELECT COUNT(*) AS count FROM product_snapshots').get().count)
  };
}
