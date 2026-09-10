import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { createLifecycleRepository } from '../../db/repositories/lifecycle-repository.mjs';
import { createId } from '../../shared/ids.mjs';
import { calculateReviewActivity,classifyProductStage,LIFECYCLE_RULE_VERSION } from './growth-calculator.mjs';
import { loadArtifactTool } from './artifact-runtime.mjs';
import { buildLifecycleWorkbook } from './lifecycle-workbook.mjs';
import { runLifecycleQa } from './lifecycle-qa.mjs';

export const DEFAULT_LIFECYCLE_WORKBOOK='product-lifecycle-analysis.xlsx';

export async function runLifecycleAnalysis(config,options={}) {
  const expectedActiveCount=options.expectedActiveCount ?? 1000;
  const outputDir=path.resolve(path.dirname(config.configPath),options.outputDir ?? 'outputs/week2');
  const workbookPath=path.resolve(path.dirname(config.configPath),options.output ?? path.join(outputDir,DEFAULT_LIFECYCLE_WORKBOOK));
  const qaDir=path.join(outputDir,'qa','lifecycle');await fs.mkdir(path.dirname(workbookPath),{ recursive:true });
  const db=openDatabase(config.app.databasePath);const repository=createLifecycleRepository(db);let runId=null;
  try {
    const coreCountsBefore=repository.coreCounts();
    if (coreCountsBefore.activeMemberships !== expectedActiveCount) throw new Error(`Day10要求active商品数为${expectedActiveCount}，当前为${coreCountsBefore.activeMemberships}。`);
    const products=repository.listActiveProducts();
    if (products.length !== expectedActiveCount || new Set(products.map(item => item.goodsId)).size !== expectedActiveCount) throw new Error('Day10 active商品输入数量或goods_id唯一性不符合要求。');
    const reviewDates=repository.listReviewDates();const analysisAsOfDate=toDateOnly(options.asOfDate ?? options.now?.() ?? new Date());
    const metrics=products.map(product => {
      const dates=reviewDates.get(product.productId) ?? [];const activity=calculateReviewActivity(dates,{ asOfDate:analysisAsOfDate });
      const stage=classifyProductStage(activity,{ snapshotReviewCount:product.snapshotReviewCount,coverageStatus:product.coverageStatus });
      return { ...product,...activity,...stage,storedReviewCount:dates.length };
    });
    const reviewedProductCount=metrics.filter(item => item.storedReviewCount>0).length;
    const summary=summarize(metrics);
    runId=options.runId ?? createId('lifecycle');const createdAt=(options.now?.() ?? new Date()).toISOString();const sourceCatalogJobId=repository.resolveSourceCatalogJobId();
    repository.createRun({ id:runId,sourceCatalogJobId,analysisAsOfDate,ruleVersion:options.ruleVersion ?? LIFECYCLE_RULE_VERSION,
      activeProductCount:products.length,reviewedProductCount,config:{ expectedActiveCount,coreCountsBefore,workbookPath,metricDefinitions:{ firstReviewDate:'earliest stored review date',reviewVelocity:'recent_7d_reviews / 7' } },createdAt });
    repository.saveMetrics(runId,metrics,{ createdAt });db.close();

    const model={ runId,sourceCatalogJobId,analysisAsOfDate,ruleVersion:options.ruleVersion ?? LIFECYCLE_RULE_VERSION,metrics,summary };
    const artifact=await loadArtifactTool();const built=buildLifecycleWorkbook(artifact,model);
    await verifyWorkbook(built.workbook,metrics.length);
    if (options.render === true) await renderWorkbook(built.workbook,qaDir,metrics.length);
    const output=await artifact.SpreadsheetFile.exportXlsx(built.workbook);await output.save(workbookPath);
    const qa=await runLifecycleQa(config,{ runId,workbookPath,expectedActiveCount,outputDir });
    const finishDb=openDatabase(config.app.databasePath);try { createLifecycleRepository(finishDb).completeRun(runId,{ ...summary,qaPass:qa.pass,workbookPath },{ completedAt:new Date().toISOString() }); } finally { finishDb.close(); }
    return { runId,sourceCatalogJobId,analysisAsOfDate,ruleVersion:model.ruleVersion,workbookPath,summary,qa };
  } catch (error) {
    try { if (runId) { const failureDb=openDatabase(config.app.databasePath);try { createLifecycleRepository(failureDb).failRun(runId,error,{ completedAt:new Date().toISOString() }); } finally { failureDb.close(); } } } catch {}
    throw error;
  } finally { try { db.close(); } catch {} }
}

function summarize(metrics) {
  const stageCounts={ new:0,growth:0,mature:0,decline:0,insufficient:0 };
  for (const item of metrics) item.productStage ? stageCounts[item.productStage]+=1:stageCounts.insufficient+=1;
  return { activeProducts:metrics.length,reviewedProducts:metrics.filter(item => item.storedReviewCount>0).length,
    classifiableProducts:metrics.filter(item => item.productStage).length,dataInsufficient:stageCounts.insufficient,
    totalStoredReviews:metrics.reduce((sum,item) => sum+item.storedReviewCount,0),stageCounts };
}

async function verifyWorkbook(workbook,metricCount) {
  await workbook.inspect({ kind:'region',sheetId:'生命周期总览',range:'A1:H20',maxChars:8000 });
  await workbook.inspect({ kind:'region',sheetId:'生命周期明细',range:`A1:U${Math.min(metricCount+1,20)}`,maxChars:12000 });
  const errors=await workbook.inspect({ kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{ useRegex:true,maxResults:100 },summary:'Day10 pre-export formula scan' });
  if ((String(errors.ndjson ?? '').match(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/g) ?? []).length) throw new Error('生命周期工作簿存在公式错误。');
}

async function renderWorkbook(workbook,qaDir,metricCount) {
  await fs.mkdir(qaDir,{ recursive:true });const previewRanges={ '生命周期总览':'A1:H20','生命周期明细':`A1:U${Math.min(metricCount+1,25)}`,'字段说明':'A1:H12' };
  for (const sheetName of ['生命周期总览','生命周期明细','字段说明']) {
    const preview=await workbook.render({ sheetName,range:previewRanges[sheetName],scale:1,format:'png' });
    await fs.writeFile(path.join(qaDir,`${sheetName}.png`),new Uint8Array(await preview.arrayBuffer()));
  }
}

function toDateOnly(value) {
  const date=value instanceof Date ? value:new Date(value);if (Number.isNaN(date.getTime())) throw new Error(`无效分析日期：${value}`);return date.toISOString().slice(0,10);
}
