import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../src/config/load.mjs';
import { openDatabase } from '../../src/db/client.mjs';

const label=process.argv[2]??'check';const output=process.argv[3]??`outputs/1688-sourcing-v1/safety-${label}.json`;
const config=await loadConfig('config.json');const db=openDatabase(config.app.databasePath,{readOnly:true});
try {
  const active=db.prepare("SELECT id,product_count FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get('motorcycle-accessories');
  const protectedTables=['products','catalog_memberships','product_classifications','fine_classification_attempts','product_snapshots','reviews',
    'catalog_capture_batches','catalog_campaign_product_observations','catalog_product_source_observations'];
  const counts=Object.fromEntries(protectedTables.map(table=>[table,Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)]));
  const report={label,checkedAt:new Date().toISOString(),databasePath:path.resolve(config.app.databasePath),activePool:{id:active?.id,count:Number(active?.product_count??0)},
    protectedTableCounts:counts,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check};
  if(report.activePool.count!==2135||report.integrity!=='ok')throw new Error(`安全检查失败：Active Pool=${report.activePool.count}, integrity=${report.integrity}`);
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {db.close();}
