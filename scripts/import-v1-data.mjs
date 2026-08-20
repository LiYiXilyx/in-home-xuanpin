import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase, transaction } from '../src/db/client.mjs';
import { migrateDatabase } from '../src/db/migrate.mjs';
import { canonicalProductUrl, extractGoodsId, stableId } from '../src/shared/ids.mjs';

export async function importV1Data({ configPath = 'config.json', legacyDatabasePath, databasePath, reportPath } = {}) {
  const config = await loadConfig(configPath);
  const sourcePath = path.resolve(legacyDatabasePath ?? config.app.legacyDatabasePath);
  const targetPath = path.resolve(databasePath ?? config.app.databasePath);
  const targetReport = path.resolve(reportPath ?? path.join(config.export.outputDir, 'import-v1-report.json'));
  const report = {
    sourcePath, targetPath, sourceReadOnly: true, reviewsImported: 0,
    sourceSha256Before: null, sourceSha256After: null,
    sourceRows: 0, productsImported: 0, membershipsImported: 0, snapshotsImported: 0, imagesImported: 0,
    productsUnmapped: 0, unmappedReasons: {}, unmappedRecords: [], missingFieldCounts: {}, skipped: []
  };
  if (!fs.existsSync(sourcePath)) {
    report.skipped.push({ reason: 'legacy_database_missing', path: sourcePath });
    writeReport(targetReport, report);
    return report;
  }

  report.sourceSha256Before = sha256File(sourcePath);
  migrateDatabase({ databasePath: targetPath });
  const source = openDatabase(sourcePath, { readOnly: true });
  const target = openDatabase(targetPath);
  try {
    const hasProducts = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products'").get();
    if (!hasProducts) {
      report.skipped.push({ reason: 'products_table_missing' });
    } else {
      const rows = source.prepare('SELECT * FROM products ORDER BY id').all();
      report.sourceRows = rows.length;
      const importHash = report.sourceSha256Before.slice(0, 24);
      const jobId = stableId('job_import_v1', importHash);
      const now = new Date().toISOString();
      transaction(target, () => {
        target.prepare(`INSERT OR IGNORE INTO crawl_jobs(
          id,job_type,status,target_count,config_json,discovered_count,stored_count,error_count,
          requested_at,started_at,finished_at,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          jobId, 'import-v1', 'completed', rows.length || null,
          JSON.stringify({ sourcePath, sourceSha256: report.sourceSha256Before }), rows.length, 0, 0,
          now, now, now, now, now
        );
        for (const row of rows) importRow(target, row, jobId, now, config, report);
        target.prepare('UPDATE crawl_jobs SET stored_count=?, error_count=?, updated_at=? WHERE id=?')
          .run(report.productsImported, report.productsUnmapped, now, jobId);
      });
    }
  } finally {
    source.close();
    target.close();
  }
  report.sourceSha256After = sha256File(sourcePath);
  if (report.sourceSha256After !== report.sourceSha256Before) throw new Error('旧数据库哈希发生变化，已停止。');
  writeReport(targetReport, report);
  return report;
}

function importRow(db, row, jobId, now, config, report) {
  const sourceUrl = String(row.product_url ?? row.url ?? '').trim();
  const goodsId = String(row.goods_id ?? extractGoodsId(sourceUrl) ?? '').trim();
  countMissingFields(row, report);
  if (!goodsId) {
    report.productsUnmapped += 1;
    report.unmappedReasons.missing_goods_id = (report.unmappedReasons.missing_goods_id ?? 0) + 1;
    report.unmappedRecords.push({ legacyProductId: row.id ?? null, sourceUrl, reason: 'missing_goods_id' });
    return;
  }
  const firstSeenAt = row.first_seen_at || now;
  const lastSeenAt = row.last_seen_at || firstSeenAt;
  db.prepare(`INSERT INTO products(goods_id,canonical_url,source_domain,title,first_seen_at,last_seen_at,raw_identity_json)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(goods_id) DO UPDATE SET
    canonical_url=excluded.canonical_url,title=COALESCE(excluded.title,products.title),
    first_seen_at=MIN(products.first_seen_at,excluded.first_seen_at),last_seen_at=MAX(products.last_seen_at,excluded.last_seen_at)`)
    .run(goodsId, canonicalProductUrl(goodsId), 'www.temu.com', row.title || null, firstSeenAt, lastSeenAt, JSON.stringify({ legacyProductId: row.id, sourceUrl }));
  const productId = Number(db.prepare('SELECT id FROM products WHERE goods_id=?').get(goodsId).id);
  const membershipKey = stableId('membership', row.site_country, row.primary_category, row.subcategory, row.sort_order);
  const membership = db.prepare(`INSERT OR IGNORE INTO catalog_memberships(
    job_id,product_id,membership_key,site_country,language,currency,primary_category,subcategory,sort_order,listing_rank,active,seen_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    jobId, productId, membershipKey, row.site_country || config.catalog.siteCountry,
    config.catalog.language, row.currency || config.catalog.currency, row.primary_category || 'Unmapped',
    row.subcategory || 'Unmapped', row.sort_order || 'Unknown', row.listing_rank ?? null,
    row.catalog_active === 0 ? 0 : 1, lastSeenAt
  );
  const snapshot = db.prepare(`INSERT OR IGNORE INTO product_snapshots(
    job_id,product_id,captured_at,source_url,title,price_amount,currency,sales_count,rating,review_count,listing_rank,availability,raw_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    jobId, productId, lastSeenAt, sourceUrl || canonicalProductUrl(goodsId), row.title || null,
    row.price_eur ?? row.price_amount ?? null, row.currency || config.catalog.currency,
    row.sales_count ?? null, row.rating ?? null, row.total_review_count ?? row.review_count ?? null,
    row.listing_rank ?? null, row.catalog_active === 0 ? 'inactive' : 'active', row.raw_json || null
  );
  let imageChanges = 0;
  if (String(row.image_url ?? '').trim()) {
    imageChanges = Number(db.prepare(`INSERT OR IGNORE INTO product_images(
      product_id,image_kind,source_url,status,created_at,updated_at
    ) VALUES(?, 'main', ?, 'pending', ?, ?)`).run(productId, String(row.image_url).trim(), now, now).changes);
  }
  report.productsImported += 1;
  report.membershipsImported += Number(membership.changes);
  report.snapshotsImported += Number(snapshot.changes);
  report.imagesImported += imageChanges;
}

function countMissingFields(row, report) {
  const fields = [
    'product_url', 'title', 'image_url', 'site_country', 'currency', 'primary_category',
    'subcategory', 'sort_order', 'price_eur', 'sales_count', 'rating', 'total_review_count'
  ];
  for (const field of fields) {
    if (row[field] === null || row[field] === undefined || String(row[field]).trim() === '') {
      report.missingFieldCounts[field] = (report.missingFieldCounts[field] ?? 0) + 1;
    }
  }
}

function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseArgs(argv) {
  const result = { configPath: 'config.json' };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--config') result.configPath = argv[++index];
    else if (argv[index] === '--legacy-db') result.legacyDatabasePath = argv[++index];
    else if (argv[index] === '--database') result.databasePath = argv[++index];
    else if (argv[index] === '--report') result.reportPath = argv[++index];
    else throw new Error(`未知参数：${argv[index]}`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  importV1Data(parseArgs(process.argv)).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(`IMPORT_V1_FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
