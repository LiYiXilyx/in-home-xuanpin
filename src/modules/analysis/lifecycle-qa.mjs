import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { createLifecycleRepository } from '../../db/repositories/lifecycle-repository.mjs';
import { loadArtifactTool } from './artifact-runtime.mjs';

export async function runLifecycleQa(config,{ runId=null,workbookPath=null,expectedActiveCount=1000,outputDir=null }={}) {
  const resolvedOutputDir=path.resolve(path.dirname(config.configPath),outputDir ?? 'outputs/week2');
  const db=openDatabase(config.app.databasePath,{ readOnly:true });
  let run,metrics,coreAfter,activeProducts;
  try {
    const repository=createLifecycleRepository(db);run=repository.getRun(runId);if (!run) throw new Error(runId ? `未找到生命周期run：${runId}`:'没有已完成的生命周期run。');
    metrics=repository.listMetrics(run.id);coreAfter=repository.coreCounts();activeProducts=repository.listActiveProducts();
  } finally { db.close(); }
  const resolvedWorkbook=workbookPath ?? run.config.workbookPath;
  const { FileBlob,SpreadsheetFile }=await loadArtifactTool();const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(resolvedWorkbook));
  const sheetNames=workbook.worksheets.items.map(sheet => sheet.name);const detail=workbook.worksheets.getItem('生命周期明细');
  const values=detail.getUsedRange(true)?.values ?? [];const headers=values[0] ?? [];const goodsIndex=headers.indexOf('goods_id');const stageIndex=headers.indexOf('product_stage');
  const rows=values.slice(1).filter(row => String(row?.[goodsIndex] ?? '').trim());const goodsIds=rows.map(row => String(row[goodsIndex]));
  const formulaErrors=await workbook.inspect({ kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{ useRegex:true,maxResults:100 },summary:'Day10 formula error scan' });
  const formulaErrorCount=(String(formulaErrors.ndjson ?? '').match(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/g) ?? []).length;
  const coreBefore=run.config.coreCountsBefore ?? {};
  const checks={
    activeCountExact:activeProducts.length === expectedActiveCount && coreAfter.activeMemberships === expectedActiveCount,
    metricRowsExact:metrics.length === expectedActiveCount && rows.length === expectedActiveCount,
    uniqueGoodsIds:new Set(metrics.map(item => item.goodsId)).size === expectedActiveCount && new Set(goodsIds).size === expectedActiveCount,
    requiredSheets:['生命周期总览','生命周期明细','字段说明'].every(name => sheetNames.includes(name)) && sheetNames.length === 3,
    requiredHeaders:['first_review_date','recent_7d_reviews','recent_30d_reviews','review_velocity','product_stage'].every(name => headers.includes(name)),
    validMetrics:metrics.every(item => item.recent7dReviews >= 0 && item.recent30dReviews >= item.recent7dReviews && item.reviewVelocity >= 0 && (item.velocityRatio === null || item.velocityRatio >= 0)),
    honestInsufficient:metrics.every(item => item.dataStatus === 'insufficient' ? item.productStage === null : item.productStage !== null),
    stageLabels:rows.every(row => ['新品','增长','成熟','衰退','数据不足'].includes(row[stageIndex])),
    formulaErrors:formulaErrorCount === 0,
    productsUnchanged:coreAfter.products === Number(coreBefore.products),
    membershipsUnchanged:coreAfter.catalogMemberships === Number(coreBefore.catalogMemberships),
    snapshotsUnchanged:coreAfter.productSnapshots === Number(coreBefore.productSnapshots),
    activePoolUnchanged:coreAfter.activeMemberships === Number(coreBefore.activeMemberships)
  };
  const report={ pass:Object.values(checks).every(Boolean),runId:run.id,workbookPath:resolvedWorkbook,checks,counts:{ activeProducts:activeProducts.length,metricRows:metrics.length,excelRows:rows.length,reviewedProducts:metrics.filter(item => item.storedReviewCount>0).length,classifiableProducts:metrics.filter(item => item.productStage).length,dataInsufficient:metrics.filter(item => item.dataStatus === 'insufficient').length,formulaErrorCount,coreBefore,coreAfter } };
  await fs.mkdir(resolvedOutputDir,{ recursive:true });const reportPath=path.join(resolvedOutputDir,'product-lifecycle-qa.json');await fs.writeFile(reportPath,JSON.stringify(report,null,2),'utf8');
  if (!report.pass) throw Object.assign(new Error(`lifecycle:qa 失败：${JSON.stringify(checks)}`),{ report,reportPath });
  return { ...report,reportPath };
}
