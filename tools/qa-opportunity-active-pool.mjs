import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createOpportunityAnalysisService } from '../src/modules/opportunity/opportunity-analysis-service.mjs';
import { resolveEvidence } from '../src/modules/evidence/evidence-repair.mjs';
import { loadArtifactTool } from '../src/modules/analysis/artifact-runtime.mjs';

const snapshotId=process.argv[2] ?? 'opportunity_snapshot_7f5cf83a3b7b469f9f4a3f0d5ecbf972';
const config=await loadConfig('config.json');
const outDir=path.resolve('outputs/opportunity-analysis-active-pool-2135');
const workbookPath=path.join(outDir,'opportunity-analysis-active-pool-2135.xlsx');
const db=openDatabase(config.app.databasePath,{readOnly:true});
let result,evidence;
try { result=createOpportunityAnalysisService(db).getResult(snapshotId); evidence=new Map(resolveEvidence(db,result.items).map(x=>[String(x.goods_id),x])); }
finally { db.close(); }
const {FileBlob,SpreadsheetFile}=await loadArtifactTool();
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const expectedSheets=['01_口径说明','02_数据质量','03_场景总览','04_细分机会','05_细分商品明细','06_Top3风险','07_候选商品','08_物流拆分','09_复核清单','10_最终3-5机会产品'];
const detail=workbook.worksheets.getItem('05_细分商品明细');
const values=detail.getUsedRange(true)?.values ?? [];
const formulas=detail.getUsedRange(true)?.formulas ?? [];
const headers=values[0] ?? [];
const index=Object.fromEntries(['goods_id','source_url','canonical_url','URL来源','图片状态','当前 Pool Version','用户场景','产品类型'].map(h=>[h,headers.indexOf(h)]));
const rows=values.slice(1).filter(row=>String(row?.[index.goods_id]??'').trim());
const goodsId=row=>String(row[index.goods_id]).replace(/^'/,'');
const ids=rows.map(goodsId);
const draws=detail.images.items ?? [];
const imageRows=new Set(draws.map(x=>Number(x.anchor?.from?.row)).filter(Number.isInteger));
const imageFailures=rows.filter(row=>row[index['图片状态']]==='IMAGE_DOWNLOAD_FAILED');
const sourceFormulaRows=formulas.slice(1).filter(row=>String(row?.[index.source_url]??'').startsWith('=HYPERLINK('));
const canonicalFormulaRows=formulas.slice(1).filter(row=>String(row?.[index.canonical_url]??'').startsWith('=HYPERLINK('));
const sourceRows=rows.filter(row=>row[index['URL来源']]==='CURRENT_OBSERVATION');
const historicalRows=rows.filter(row=>row[index['URL来源']]==='HISTORICAL_OBSERVATION');
const canonicalFallbackRows=rows.filter(row=>row[index['URL来源']]==='CANONICAL_FALLBACK');
const missingUrlRows=rows.filter(row=>row[index['URL来源']]==='MISSING');
const formulaScan=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{useRegex:true,maxResults:300},summary:'Opportunity export formula error scan'});
const formulaErrorCount=(String(formulaScan.ndjson??'').match(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/g)??[]).length;
const segment=workbook.worksheets.getItem('04_细分机会');
const segmentValues=segment.getUsedRange(true)?.values??[]; const segmentHeaders=segmentValues[0]??[];
const si=Object.fromEntries(['用户场景','产品类型','SKU','明细商品数量','明细定位'].map(h=>[h,segmentHeaders.indexOf(h)]));
const segmentRows=segmentValues.slice(1).filter(row=>String(row?.[si['产品类型']]??'').trim());
const segmentCountsMatch=segmentRows.every(row=>{const n=rows.filter(d=>d[index['用户场景']]===row[si['用户场景']]&&d[index['产品类型']]===row[si['产品类型']]).length;return n===Number(row[si.SKU])&&n===Number(row[si['明细商品数量']]);});
const evidenceMismatches=rows.filter(row=>{const e=evidence.get(goodsId(row));return !e || String(row[index['当前 Pool Version']])!==result.snapshot.sourcePoolVersionId || String(row[index['URL来源']])!==String(e.url_source??'MISSING');});
const evidenceMatches=evidenceMismatches.length===0;
const checks={
  expectedSheets:expectedSheets.every((name,i)=>workbook.worksheets.items[i]?.name===name),
  activePool2135:result.snapshot.sourcePoolCount===2135 && rows.length===2135,
  uniqueGoodsIds:new Set(ids).size===2135,
  sourcePoolOnly:rows.every(row=>String(row[index['当前 Pool Version']])===result.snapshot.sourcePoolVersionId),
  detailHeaders:Object.values(index).every(n=>n>=0),
  imageCellsNonBlank:draws.length+imageFailures.length===2135 && imageFailures.every(row=>String(row[1])==='IMAGE_DOWNLOAD_FAILED'),
  imageAnchorsUnique:imageRows.size===draws.length && draws.length===2124,
  urlProvenanceMatchesEvidence:evidenceMatches,
  urlLinksPresent:sourceFormulaRows.length===2135 && canonicalFormulaRows.length===2135,
  segmentCountsMatch,filterEnabled:detail.tables.items.length===1,
  formulaErrors:formulaErrorCount===0
};
const report={pass:Object.values(checks).every(Boolean),snapshotId,workbookPath,checks,counts:{totalRows:rows.length,imageEmbedded:draws.length,imageMissing:imageFailures.length,currentUrl:sourceRows.length,historicalUrl:historicalRows.length,canonicalFallback:canonicalFallbackRows.length,bothUrlMissing:missingUrlRows.length,duplicateGoodsId:ids.length-new Set(ids).size,formulaErrorCount,segments:segmentRows.length},evidenceMismatchSamples:evidenceMismatches.slice(0,5).map(row=>({goodsId:goodsId(row),sheet:row[index['URL来源']],expected:evidence.get(goodsId(row))?.url_source}))};
await fs.writeFile(path.join(outDir,'opportunity-analysis-active-pool-2135-qa.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.pass)process.exitCode=1;
