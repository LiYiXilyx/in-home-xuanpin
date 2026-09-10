import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { migrateDatabase } from '../src/db/migrate.mjs';
import { createOpportunityAnalysisService } from '../src/modules/opportunity/opportunity-analysis-service.mjs';
import { exportOpportunityWorkbook } from '../src/modules/opportunity/opportunity-workbook.mjs';
import { resolveEvidence } from '../src/modules/evidence/evidence-repair.mjs';
import { loadCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';

const {action,options}=args(process.argv.slice(2));const config=await loadConfig(options.config??'config.json');
migrateDatabase({databasePath:config.app.databasePath});const db=openDatabase(config.app.databasePath);
try{const service=createOpportunityAnalysisService(db);const exportResult=async result=>exportOpportunityWorkbook(result,{outputDir:path.resolve(options.output??'outputs/opportunity-analysis'),fileName:options.file??'opportunity-analysis.xlsx',evidenceByKey:new Map(resolveEvidence(db,result.items).map(x=>[`${x.platform}\u001f${x.goods_id}`,x]))});if(action==='freeze-analyze'){const result=service.freezeAndAnalyze(required(options.campaign,'campaign'));const qa=await exportResult(result);print({snapshot:result.snapshot,summary:result.summary,candidates:result.candidates,excel:qa});}else if(action==='analyze-active'){const profile=await loadCategoryProfile(path.resolve(required(options.profile,'profile')));const result=service.analyzeActivePool({profile,poolVersionId:required(options.pool,'pool')});const qa=await exportResult(result);print({snapshot:result.snapshot,summary:result.summary,candidates:result.candidates,excel:qa});}else if(action==='reanalyze'){const result=service.reanalyze(required(options.snapshot,'snapshot'));print({snapshot:result.snapshot,summary:result.summary,candidates:result.candidates});}else if(action==='status'){const result=service.getResult(required(options.snapshot,'snapshot'));print({snapshot:result.snapshot,summary:result.summary,candidates:result.candidates,coreCounts:result.coreCounts});}else if(action==='excel'){const result=service.getResult(required(options.snapshot,'snapshot'));print(await exportResult(result));}else throw new Error('未知操作：freeze-analyze/analyze-active/reanalyze/status/excel');}finally{db.close();}
function args(values){const [action,...rest]=values;if(!action)throw new Error('缺少操作');const options={};for(let i=0;i<rest.length;i+=2){const k=rest[i],v=rest[i+1];if(!k?.startsWith('--')||!v)throw new Error(`参数错误：${k??''}`);options[k.slice(2)]=v;}return{action,options};}
function required(v,n){if(!String(v??'').trim())throw new Error(`缺少 --${n}`);return String(v);}
function print(v){console.log(JSON.stringify(v,null,2));}
