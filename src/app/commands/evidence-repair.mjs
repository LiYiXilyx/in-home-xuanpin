import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { auditEvidence,repairEvidence } from '../../modules/evidence/evidence-repair.mjs';

export async function runEvidenceRepairCommand(config,{ apply=false }={}) {
  const baseDir=path.dirname(config.configPath);const db=openDatabase(config.app.databasePath,{readOnly:!apply});
  try {
    const options={baseDir,minimumBytes:config.catalog.capture.imageMinimumBytes,cacheDir:config.export.imageCacheDir,
      timeoutMs:config.catalog.capture.imageTimeoutMs};
    const result=apply ? await repairEvidence(db,{...options,onProgress:item=>console.log(`[image] ${item.goods_id}: ${item.download_status}`)}) : { before:await auditEvidence(db,options) };
    const report={mode:apply?'apply':'audit',generated_at:new Date().toISOString(),...compact(result)};
    const reportPath=path.join(config.export.outputDir,apply?'evidence-repair-report.json':'evidence-audit-report.json');await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,reportPath},null,2));return {...result,reportPath};
  } finally { db.close(); }
}
function compact(result){const summarize=audit=>!audit?null:{total_rows:audit.total_rows,active_rows:audit.active_rows,opportunity_rows:audit.opportunity_rows,counts:audit.counts,lists:audit.lists};return {before:summarize(result.before),after:summarize(result.after),candidates:result.candidates,results:result.results};}
