import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { createAnalysisRepository } from '../../db/repositories/analysis-repository.mjs';
import { assertFiniteTree } from './product-metrics.mjs';
import { loadArtifactTool } from './artifact-runtime.mjs';

export async function runMarketAnalysisQa(config,{ runId=null,workbookPath=null,expectedActiveCount=1000,outputDir:requestedOutputDir=null }={}) {
  const outputDir=path.resolve(path.dirname(config.configPath),requestedOutputDir ?? 'outputs/week2');
  const resolvedWorkbook=workbookPath ?? path.join(outputDir,'market-analysis.xlsx');
  const queuePath=path.join(outputDir,'day9-fine-classification-queue.json');
  const db=openDatabase(config.app.databasePath,{ readOnly:true });
  let run,metrics,products,counts,coreCounts;
  try { const repository=createAnalysisRepository(db);run=repository.getRun(runId);if (!run) throw new Error(runId ? `未找到市场分析run：${runId}` : '没有已完成的市场分析run。');metrics=repository.listCategoryMetrics(run.id);products=repository.listActiveProducts(run.sourceCatalogJobId,run.taxonomy);counts=repository.inputCounts(run.sourceCatalogJobId,run.taxonomy);coreCounts=repository.coreCounts(); }
  finally { db.close(); }
  assertFiniteTree({ metrics,products },'marketQa');
  const businessSummary=run.config?.businessSummary ?? {};
  const queue=JSON.parse(await fs.readFile(queuePath,'utf8'));
  const { FileBlob,SpreadsheetFile }=await loadArtifactTool();const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(resolvedWorkbook));
  const sheetNames=workbook.worksheets.items.map(sheet => sheet.name);
  const productSheet=workbook.worksheets.getItem('商品指标');const productValues=productSheet.getUsedRange(true)?.values ?? [];const productHeaders=productValues[0] ?? [];
  const indexes=Object.fromEntries(['goods_id','分类','业务准入状态','business_exclusion_code','screening_warning','needs_fine_classification','是否进入后续分析'].map(header => [header,productHeaders.indexOf(header)]));
  const productRows=productValues.slice(1).filter(row => String(row?.[indexes.goods_id] ?? '').trim());const goodsIds=productRows.map(row => String(row[indexes.goods_id]));
  const statusCount=status => productRows.filter(row => row[indexes['业务准入状态']] === status).length;
  const codeCount=code => productRows.filter(row => String(row[indexes.business_exclusion_code] ?? '').split('|').includes(code)).length;
  const excelBusiness={ eligibleCount:statusCount('可做'),excludedCount:statusCount('排除'),pendingFineClassificationCount:statusCount('待细分类'),electronicsCount:codeCount('ELECTRONIC_PRODUCT'),usbCount:codeCount('USB_PRODUCT'),batteryCount:codeCount('BATTERY_PRODUCT'),certificationRiskCodeCount:codeCount('CERTIFICATION_RISK'),priceBelow5Count:codeCount('PRICE_BELOW_5_EUR'),screeningWarningCount:productRows.filter(row => String(row[indexes.screening_warning] ?? '').trim()).length,needsFineClassificationCount:productRows.filter(row => row[indexes.needs_fine_classification] === '是').length };
  const categorySheet=workbook.worksheets.getItem('类目分析');const categoryValues=categorySheet.getUsedRange(true)?.values ?? [];const categoryHeaders=categoryValues[0] ?? [];
  const categoryIndexes=Object.fromEntries(['分类','原商品数','业务可做商品数','排除数','待细分类数','Market Opportunity Score','Business Eligible Opportunity Score'].map(header => [header,categoryHeaders.indexOf(header)]));
  const categoryRows=categoryValues.slice(1).filter(row => String(row?.[categoryIndexes['分类']] ?? '').trim());
  const sumColumn=header => categoryRows.reduce((sum,row) => sum+Number(row[categoryIndexes[header]] ?? 0),0);
  const excelCategoryCount=sumColumn('原商品数');const excelMatchesDatabase=categoryRows.every(row => metrics.find(metric => metric.category_label === String(row[categoryIndexes['分类']]))?.product_count === Number(row[categoryIndexes['原商品数']]));
  const formulaErrors=await workbook.inspect({ kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{ useRegex:true,maxResults:300 },summary:'Day8.1 formula error scan' });
  const formulaErrorCount=(String(formulaErrors.ndjson ?? '').match(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/g) ?? []).length;
  const coreBefore=run.config?.coreCountsBefore ?? {};const dbCategoryCount=metrics.reduce((sum,row) => sum+row.product_count,0);
  const scoreInRange=value => value === null || value === '' || value === undefined || (Number(value) >= 0 && Number(value) <= 100);
  const businessFieldsPresent=Object.values(indexes).every(index => index >= 0) && Object.values(categoryIndexes).every(index => index >= 0);
  const businessCountsMatch=Object.entries(excelBusiness).every(([key,value]) => key === 'certificationRiskCodeCount' || value === Number(businessSummary[key]));
  const expectedSheets=String(run.taxonomy).startsWith('week2-motorcycle-fine') ? ['市场总览','类目分析','商品指标','字段说明','细分类分析','人工复核队列'] : ['市场总览','类目分析','商品指标','字段说明'];
  const fineSheetCheck=!String(run.taxonomy).startsWith('week2-motorcycle-fine') || (workbook.worksheets.getItem('细分类分析').getUsedRange(true)?.values?.length > 1 && workbook.worksheets.getItem('人工复核队列').getUsedRange(true)?.values?.[0]?.includes('unresolved_reason'));
  const checks={
    expectedActiveProducts:counts.activeProducts === expectedActiveCount && products.length === expectedActiveCount,
    activeMembershipsExact:counts.activeMemberships === expectedActiveCount && counts.sourceJobClassifications === expectedActiveCount,
    uniqueGoodsIds:new Set(products.map(item => item.goodsId)).size === expectedActiveCount && new Set(goodsIds).size === expectedActiveCount,
    noInactiveProducts:products.length === counts.activeProducts,
    categoryDatabaseTotal:dbCategoryCount === expectedActiveCount,categoryExcelTotal:excelCategoryCount === expectedActiveCount,
    categorySummaryMatchesDetail:excelMatchesDatabase && categoryRows.length === metrics.length,
    businessFieldsPresent,businessCountsMatch,
    businessCategoryTotals:sumColumn('业务可做商品数') === Number(businessSummary.eligibleCount) && sumColumn('排除数') === Number(businessSummary.excludedCount) && sumColumn('待细分类数') === Number(businessSummary.pendingFineClassificationCount),
    businessTriStateTotal:excelBusiness.eligibleCount+excelBusiness.excludedCount+excelBusiness.pendingFineClassificationCount === expectedActiveCount,
    fineClassificationQueue:queue.runId === run.id && queue.count === queue.items.length && queue.count <= Number(businessSummary.needsFineClassificationCount) && queue.items.every(item => item.currentCategory === '其他' || item.needsReview === true),
    screeningWarningsNotHardExclusions:productRows.every(row => !String(row[indexes.screening_warning] ?? '').trim() || ['可做','排除','待细分类'].includes(row[indexes['业务准入状态']])),
    followUpMapping:productRows.every(row => ({ 可做:'是',排除:'否',待细分类:'先细分类' })[row[indexes['业务准入状态']]] === row[indexes['是否进入后续分析']]),
    scoresInRange:metrics.every(row => row.opportunity_score >= 0 && row.opportunity_score <= 100) && categoryRows.every(row => scoreInRange(row[categoryIndexes['Market Opportunity Score']]) && scoreInRange(row[categoryIndexes['Business Eligible Opportunity Score']])),
    noNonFiniteValues:true,expectedSheets:expectedSheets.every(name => sheetNames.includes(name)) && sheetNames.length === expectedSheets.length,fineSheetsValid:fineSheetCheck,
    excelProductRows:productRows.length === expectedActiveCount,productCategoriesPresent:productRows.every(row => String(row[indexes['分类']] ?? '').trim()),formulaErrors:formulaErrorCount === 0,
    productsUnchanged:coreCounts.products === Number(coreBefore.products),membershipsUnchanged:coreCounts.catalog_memberships === Number(coreBefore.catalog_memberships),snapshotsUnchanged:coreCounts.product_snapshots === Number(coreBefore.product_snapshots),activePoolUnchanged:coreCounts.activeMemberships === Number(coreBefore.activeMemberships)
  };
  const report={ pass:Object.values(checks).every(Boolean),runId:run.id,workbookPath:resolvedWorkbook,checks,counts:{ databaseActiveProducts:counts.activeProducts,databaseActiveMemberships:counts.activeMemberships,sourceJobMemberships:counts.sourceJobMemberships,sourceJobClassifications:counts.sourceJobClassifications,excelProductRows:productRows.length,uniqueGoodsIds:new Set(goodsIds).size,databaseCategoryTotal:dbCategoryCount,excelCategoryTotal:excelCategoryCount,categoryRows:categoryRows.length,formulaErrorCount,businessSummary,excelBusiness,fineClassificationQueueCount:queue.count,coreBefore,coreAfter:coreCounts,embeddedImages:productSheet.images.items.length } };
  const reportPath=path.join(outputDir,'market-analysis-qa.json');await fs.mkdir(outputDir,{ recursive:true });await fs.writeFile(reportPath,JSON.stringify(report,null,2),'utf8');
  if (!report.pass) throw Object.assign(new Error(`market:qa 失败：${JSON.stringify(checks)}`),{ report,reportPath });return { ...report,reportPath };
}
