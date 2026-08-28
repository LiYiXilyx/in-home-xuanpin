import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createOpportunityAnalysisService } from '../src/modules/opportunity/opportunity-analysis-service.mjs';
import { resolveEvidence } from '../src/modules/evidence/evidence-repair.mjs';
import { exportOpportunityWorkbook } from '../src/modules/opportunity/opportunity-workbook.mjs';
import { createSourcingRepository } from '../src/db/repositories/sourcing-repository.mjs';

const outputDir=path.resolve(process.argv[2]??'outputs/catalog-grouping-2135-20260828');
const fileName=process.argv[3]??'catalog-active-pool-2135-grouped.xlsx';
const config=await loadConfig('config.json');
const db=openDatabase(config.app.databasePath,{readOnly:true});
let result,evidenceByKey,sourcingByGoodsId;
try {
  result=createOpportunityAnalysisService(db).getResult();
  evidenceByKey=new Map(resolveEvidence(db,result.items).map(x=>[`${x.platform}\u001f${x.goods_id}`,x]));
  sourcingByGoodsId=createSourcingRepository(db).formalSourcingState();
} finally { db.close(); }
const qa=await exportOpportunityWorkbook(result,{outputDir,fileName,evidenceByKey,sourcingByGoodsId});
console.log(JSON.stringify({snapshot:result.snapshot,groupingQa:result.groupingQa,qa},null,2));
