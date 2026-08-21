import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { connectOperatorSession,closeBrowserSession } from '../src/browser/cdp-session.mjs';

const config = await loadConfig(process.argv[2] ?? 'config.json');
const baseDir = path.dirname(config.configPath);
const outputDir = path.join(config.export.outputDir,'day4-5-image-repair','spot-check');
const ranges = [[1,10],[145,155],[291,300]];
const db = openDatabase(config.app.databasePath,{ readOnly:true });
let session;

try {
  const one = (sql,...parameters) => db.prepare(sql).get(...parameters);
  const all = (sql,...parameters) => db.prepare(sql).all(...parameters);
  const rows = all(`SELECT m.current_rank AS rank,p.external_product_id AS goods_id,
      COALESCE(s.title,p.title) AS title,s.image_url,pi.local_path,pi.content_type,
      pi.content_sha256,pi.byte_length,pi.fetch_strategy
    FROM catalog_memberships m
    JOIN products p ON p.id=m.product_id
    JOIN product_snapshots s ON s.id=(SELECT ps.id FROM product_snapshots ps
      WHERE ps.product_id=p.id ORDER BY ps.captured_at DESC,ps.id DESC LIMIT 1)
    LEFT JOIN product_images pi ON pi.product_id=p.id AND pi.image_kind='main'
      AND pi.source_url=s.image_url AND pi.download_status='completed'
    WHERE m.active=1 AND (
      m.current_rank BETWEEN 1 AND 10 OR
      m.current_rank BETWEEN 145 AND 155 OR
      m.current_rank BETWEEN 291 AND 300)
    ORDER BY m.current_rank`);

  const auditRows = [];
  for (const row of rows) {
    const absolutePath = row.local_path
      ? (path.isAbsolute(row.local_path) ? row.local_path : path.resolve(baseDir,row.local_path))
      : null;
    let fileExists = false;
    let dataUrl = null;
    if (absolutePath) {
      try {
        const body = await fs.readFile(absolutePath);
        fileExists = true;
        dataUrl = `data:${row.content_type};base64,${body.toString('base64')}`;
      } catch {}
    }
    auditRows.push({ ...row,fileExists,absolutePath,dataUrl });
  }

  const stats = {
    core: {
      products:Number(one('SELECT COUNT(*) AS count FROM products').count),
      activeMemberships:Number(one('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').count),
      snapshots:Number(one('SELECT COUNT(*) AS count FROM product_snapshots').count)
    },
    productImages: {
      rows:Number(one('SELECT COUNT(*) AS count FROM product_images').count),
      completed:Number(one("SELECT COUNT(*) AS count FROM product_images WHERE download_status='completed'").count),
      failed:Number(one("SELECT COUNT(*) AS count FROM product_images WHERE download_status='failed'").count),
      activeProductsWithCompleted:Number(one(`SELECT COUNT(DISTINCT m.product_id) AS count
        FROM catalog_memberships m JOIN product_images pi ON pi.product_id=m.product_id
        WHERE m.active=1 AND pi.download_status='completed'`).count),
      duplicates:Number(one(`SELECT COUNT(*) AS count FROM (
        SELECT product_id,image_kind,source_url FROM product_images
        GROUP BY product_id,image_kind,source_url HAVING COUNT(*)>1)`).count),
      completedMissingHash:Number(one(`SELECT COUNT(*) AS count FROM product_images
        WHERE download_status='completed' AND (content_sha256 IS NULL OR length(content_sha256)<>64)`).count),
      completedAbsolutePaths:Number(one(`SELECT COUNT(*) AS count FROM product_images
        WHERE download_status='completed' AND (local_path LIKE '/%' OR local_path GLOB '[A-Za-z]:*')`).count),
      byStatus:all('SELECT download_status AS status,COUNT(*) AS count FROM product_images GROUP BY download_status ORDER BY download_status'),
      byStrategy:all(`SELECT fetch_strategy AS strategy,COUNT(*) AS count FROM product_images
        WHERE download_status='completed' GROUP BY fetch_strategy ORDER BY fetch_strategy`)
    }
  };

  await fs.mkdir(outputDir,{ recursive:true });
  session = await connectOperatorSession(config);
  for (const [start,end] of ranges) {
    const page = await session.context.newPage();
    const items = auditRows.filter(row => row.rank >= start && row.rank <= end);
    await page.setViewportSize({ width:1500,height:1000 });
    await page.setContent(renderPage(start,end,items),{ waitUntil:'load' });
    const screenshotPath = path.join(outputDir,`ranks-${start}-${end}.png`);
    await page.screenshot({ path:screenshotPath,fullPage:true });
    await page.close();
  }
  const reportPath = path.join(outputDir,'audit.json');
  await fs.writeFile(reportPath,JSON.stringify({
    stats,
    sampled:auditRows.map(({ dataUrl,absolutePath,...row }) => ({ ...row,localFile:absolutePath }))
  },null,2),'utf8');
  console.log(JSON.stringify({ stats,sampled:auditRows.length,missingFiles:auditRows.filter(row => !row.fileExists).length,outputDir,reportPath },null,2));
} finally {
  await closeBrowserSession(session,config);
  db.close();
}

function renderPage(start,end,rows) {
  const cards = rows.map(row => `<article>
    <img src="${row.dataUrl ?? ''}" alt="rank ${row.rank}">
    <div class="rank">Rank ${row.rank}</div>
    <div class="goods">${escapeHtml(row.goods_id)}</div>
    <div class="title">${escapeHtml(row.title ?? '')}</div>
  </article>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{font:14px Arial,sans-serif;margin:20px;background:#f5f5f5;color:#111}
    h1{font-size:24px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
    article{background:white;border:1px solid #ddd;border-radius:8px;padding:10px;min-height:330px}
    img{display:block;width:100%;height:220px;object-fit:contain;background:#fafafa}
    .rank{font-weight:700;font-size:17px;margin-top:8px}.goods{font-family:monospace;color:#555;margin:4px 0}
    .title{line-height:1.35;max-height:57px;overflow:hidden}
  </style><h1>Day 4.5 image spot-check — ranks ${start}–${end}</h1><section class="grid">${cards}</section>`;
}

function escapeHtml(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
