import { DatabaseSync } from 'node:sqlite';

const databasePath = process.argv[2] ?? './data/temu_research_v2.db';
const latestJobId = process.argv[3] ?? null;
const db = new DatabaseSync(databasePath,{ readOnly:true });
const one = (sql,...parameters) => db.prepare(sql).get(...parameters);
const all = (sql,...parameters) => db.prepare(sql).all(...parameters);
try {
  const jobs = all(`SELECT j.id,j.status,j.resume_count AS resumeCount,j.target_count AS targetCount,
    j.success_items AS successItems,j.stored_count AS storedCount,
    (SELECT COUNT(*) FROM crawl_job_items i WHERE i.job_id=j.id) AS itemCount,
    (SELECT COUNT(*) FROM product_snapshots s WHERE s.job_id=j.id) AS snapshotCount
    FROM crawl_jobs j WHERE j.job_type='catalog' ORDER BY j.created_at`);
  const qualityJobId = latestJobId ?? jobs.at(-1)?.id ?? null;
  const report = {
    databasePath,
    counts: {
      products: one('SELECT COUNT(*) AS count FROM products').count,
      memberships: one('SELECT COUNT(*) AS count FROM catalog_memberships').count,
      activeMemberships: one('SELECT COUNT(*) AS count FROM catalog_memberships WHERE active=1').count,
      snapshots: one('SELECT COUNT(*) AS count FROM product_snapshots').count,
      images: one('SELECT COUNT(*) AS count FROM product_images').count,
      qualityChecks: one('SELECT COUNT(*) AS count FROM data_quality_checks').count,
      jobItems: one('SELECT COUNT(*) AS count FROM crawl_job_items').count
    },
    duplicates: {
      products: one(`SELECT COUNT(*) AS count FROM (
        SELECT platform,external_product_id FROM products GROUP BY platform,external_product_id HAVING COUNT(*)>1
      )`).count,
      memberships: one(`SELECT COUNT(*) AS count FROM (
        SELECT product_id,site_country,language,currency,primary_category,subcategory,sort_order
        FROM catalog_memberships GROUP BY product_id,site_country,language,currency,primary_category,subcategory,sort_order
        HAVING COUNT(*)>1
      )`).count,
      snapshots: one(`SELECT COUNT(*) AS count FROM (
        SELECT job_id,product_id FROM product_snapshots GROUP BY job_id,product_id HAVING COUNT(*)>1
      )`).count,
      jobItems: one(`SELECT COUNT(*) AS count FROM (
        SELECT job_id,item_key FROM crawl_job_items GROUP BY job_id,item_key HAVING COUNT(*)>1
      )`).count
    },
    rank: one(`SELECT COUNT(*) AS count,COUNT(DISTINCT current_rank) AS distinctCount,
      MIN(current_rank) AS minRank,MAX(current_rank) AS maxRank
      FROM catalog_memberships WHERE active=1`),
    jobs,
    imageStatus: all('SELECT status,COUNT(*) AS count FROM product_images GROUP BY status'),
    latestQuality: qualityJobId ? all(`SELECT check_code AS code,metric_value AS actual,
      threshold_value AS threshold,passed FROM data_quality_checks WHERE job_id=? ORDER BY check_code`,qualityJobId) : []
  };
  console.log(JSON.stringify(report,null,2));
} finally {
  db.close();
}
