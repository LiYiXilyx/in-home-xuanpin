import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../../db/client.mjs';
import { createAnalysisRepository } from '../../db/repositories/analysis-repository.mjs';
import { createId } from '../../shared/ids.mjs';
import { ANALYSIS_VERSION,analyzeCategories } from './category-analysis.mjs';
import { buildBusinessAlignment } from './business-screening.mjs';
import { buildFineAnalysis } from './fine-analysis.mjs';
import { assertFiniteTree } from './product-metrics.mjs';
import { loadArtifactTool } from './artifact-runtime.mjs';
import { buildMarketWorkbook } from './market-workbook.mjs';
import { runMarketAnalysisQa } from './market-analysis-qa.mjs';

export const DEFAULT_SOURCE_JOB_ID='job_f902639b70a5412daa74b73602fda888';
export const DEFAULT_MARKET_WORKBOOK='market-analysis.xlsx';

export async function runMarketAnalysis(config,options={}) {
  const expectedActiveCount=options.expectedActiveCount ?? 1000;
  const outputDir=path.resolve(path.dirname(config.configPath),options.outputDir ?? 'outputs/week2');
  const workbookPath=path.resolve(outputDir,options.output ?? DEFAULT_MARKET_WORKBOOK);
  const opportunityPath=path.join(outputDir,'category-opportunity.json');
  const businessAlignmentPath=path.join(outputDir,'business-alignment.json');
  const fineClassificationQueuePath=path.join(outputDir,'day9-fine-classification-queue.json');
  const qaDir=path.join(outputDir,'qa');
  await fs.mkdir(outputDir,{ recursive:true });
  const db=openDatabase(config.app.databasePath);
  const repository=createAnalysisRepository(db);
  let runId=null;
  try {
    const poolScope=options.poolVersionId && options.categoryKey ? { poolVersionId:options.poolVersionId,categoryKey:options.categoryKey }:null;
    const sourceCatalogJobId=poolScope ? repository.resolvePoolJobId({ ...poolScope,requestedJobId:options.jobId }):repository.resolveSourceJobId(options.jobId ?? DEFAULT_SOURCE_JOB_ID);
    const taxonomy=repository.resolveTaxonomy(sourceCatalogJobId,options.taxonomy);
    const counts=poolScope ? repository.inputPoolCounts(sourceCatalogJobId,taxonomy,poolScope):repository.inputCounts(sourceCatalogJobId,taxonomy);
    if (counts.activeMemberships !== expectedActiveCount || counts.activeProducts !== expectedActiveCount || counts.sourceJobClassifications !== expectedActiveCount) {
      throw new Error(`Day8输入不是恰好${expectedActiveCount}个Gate D active商品：${JSON.stringify(counts)}`);
    }
    const coreCountsBefore=repository.coreCounts();
    const products=poolScope ? repository.listPoolProducts(sourceCatalogJobId,taxonomy,poolScope):repository.listActiveProducts(sourceCatalogJobId,taxonomy);
    if (products.length !== expectedActiveCount) throw new Error(`Day8读取商品 ${products.length}，预期 ${expectedActiveCount}。`);
    if (new Set(products.map(item => item.goodsId)).size !== expectedActiveCount) throw new Error('Day8输入 goods_id 不唯一。');
    const analysis=analyzeCategories(products,{ analysisVersion:options.analysisVersion ?? ANALYSIS_VERSION });
    const business=buildBusinessAlignment(analysis);
    const fineClassification=options.fineContext ? buildFineAnalysis(analysis,business,options.fineContext) : null;
    const categoryBusinessByLabel=new Map(business.categoryAlignment.map(item => [item.categoryLabel,item]));
    analysis.categories=analysis.categories.map(metric => ({ ...metric,businessAlignment:categoryBusinessByLabel.get(metric.categoryLabel) }));
    analysis.products=business.products;
    analysis.fineClassification=fineClassification;
    assertFiniteTree({ analysis,business,fineClassification },'analysis');
    if (analysis.categories.reduce((sum,item) => sum+item.productCount,0) !== expectedActiveCount) throw new Error('类目商品数合计与active输入不一致。');
    runId=options.runId ?? createId('market');
    const createdAt=(options.now?.() ?? new Date()).toISOString();
    const runConfig={
      expectedActiveCount,highReviewThreshold:analysis.overall.highReviewThreshold,weights:analysis.categories[0]?.scoreComponents.weights,
      businessRuleVersion:business.ruleVersion,businessSummary:business.summary,fineClassificationSummary:fineClassification?.summary ?? null,
      coreCountsBefore,workbookPath
    };
    repository.createRun({ id:runId,sourceCatalogJobId,activeProductCount:products.length,taxonomy,
      analysisVersion:analysis.analysisVersion,config:runConfig,createdAt });
    repository.saveCategoryMetrics(runId,analysis.categories,{ createdAt });
    const model={ ...analysis,business,fineClassification,runId,sourceCatalogJobId,taxonomy };
    db.close();

    const prepared=await prepareImages(model.products,{ baseDir:path.dirname(config.configPath),cacheDir:path.join(outputDir,'.image-cache') });
    const artifact=await loadArtifactTool();
    const built=buildMarketWorkbook(artifact,model,{ imageDataByGoodsId:prepared.imageDataByGoodsId });
    await verifyAndRenderWorkbook(built.workbook,qaDir,model);
    const output=await artifact.SpreadsheetFile.exportXlsx(built.workbook);
    await output.save(workbookPath);
    await fs.writeFile(opportunityPath,JSON.stringify({
      runId,sourceCatalogJobId,taxonomy,analysisVersion:model.analysisVersion,overall:model.overall,fineClassification,
      marketRanking:business.marketRanking,businessEligibleRanking:business.businessRanking,businessSummary:business.summary,
      categories:model.categories.map(item => ({
        categoryLabel:item.categoryLabel,productCount:item.productCount,productShare:item.productShare,
        opportunityScore:item.opportunityScore,scoreComponents:item.scoreComponents,reasons:item.reasons,
        needsReviewCount:item.needsReviewCount,isOther:item.isOther,businessAlignment:item.businessAlignment
      }))
    },null,2),'utf8');
    await fs.writeFile(businessAlignmentPath,JSON.stringify({
      runId,ruleVersion:business.ruleVersion,summary:business.summary,categoryAlignment:business.categoryAlignment,
      marketRanking:business.marketRanking,businessEligibleRanking:business.businessRanking
    },jsonReplacer,2),'utf8');
    await fs.writeFile(fineClassificationQueuePath,JSON.stringify({
      runId,ruleVersion:business.ruleVersion,count:business.fineClassificationQueue.length,
      items:business.fineClassificationQueue.map(queueItem)
    },null,2),'utf8');
    const qa=await runMarketAnalysisQa(config,{ runId,workbookPath,expectedActiveCount,outputDir });
    const finishDb=openDatabase(config.app.databasePath);
    try {
      const finishRepository=createAnalysisRepository(finishDb);
      finishRepository.completeRun(runId,{ overall:model.overall,businessSummary:business.summary,qaPass:qa.pass,workbookPath,opportunityPath,
        businessAlignmentPath,fineClassificationQueuePath,
        embeddedImages:built.imageCount,imageFailures:prepared.failures.length },{ completedAt:new Date().toISOString() });
    } finally { finishDb.close(); }
    return {
      runId,sourceCatalogJobId,taxonomy,analysisVersion:model.analysisVersion,workbookPath,opportunityPath,businessAlignmentPath,fineClassificationQueuePath,
      activeProducts:products.length,categories:model.categories.length,overall:model.overall,fineClassification,
      businessSummary:business.summary,marketRanking:business.marketRanking,businessEligibleRanking:business.businessRanking,
      categoryAlignment:business.categoryAlignment,categoryMetrics:model.categories,embeddedImages:built.imageCount,imageFailures:prepared.failures,qa
    };
  } catch (error) {
    try {
      if (runId) {
        const failureDb=openDatabase(config.app.databasePath);
        try { createAnalysisRepository(failureDb).failRun(runId,error,{ completedAt:new Date().toISOString() }); }
        finally { failureDb.close(); }
      }
    } catch {}
    throw error;
  } finally {
    try { db.close(); } catch {}
  }
}

function queueItem(product) {
  return {
    goodsId:product.goodsId,rank:product.rank,title:product.title,productUrl:product.productUrl,
    currentCategory:product.categoryLabel,needsReview:product.needsReview,price:product.price,rating:product.rating,
    reviewCount:product.reviewCount,marketOpportunityScore:product.marketOpportunityScore,
    screeningWarning:product.screeningWarning,queueReason:'Week1分类为其他或needs_review，需在评论采集前细分类'
  };
}

function jsonReplacer(key,value) {
  if (key === 'marketMetric' || key === 'businessMetric') return undefined;
  return value;
}

async function prepareImages(products,{ baseDir,cacheDir }) {
  await fs.mkdir(cacheDir,{ recursive:true });
  const imageDataByGoodsId=new Map();
  const failures=[];
  for (const product of products) {
    if (!product.localImagePath) { failures.push({ goodsId:product.goodsId,error:'completed local image missing' });continue; }
    const sourcePath=path.isAbsolute(product.localImagePath) ? product.localImagePath : path.resolve(baseDir,product.localImagePath);
    const targetPath=path.join(cacheDir,`${product.goodsId}-${String(product.imageSha256 ?? 'unknown').slice(0,12)}.png`);
    try {
      let bytes=await fs.readFile(targetPath).catch(() => null);
      if (!bytes) {
        const temporaryPath=`${targetPath}.${process.pid}.tmp`;
        await sharp(sourcePath).rotate().resize({ width:160,height:160,fit:'inside',withoutEnlargement:true }).png().toFile(temporaryPath);
        await fs.rename(temporaryPath,targetPath);
        bytes=await fs.readFile(targetPath);
      }
      imageDataByGoodsId.set(String(product.goodsId),`data:image/png;base64,${bytes.toString('base64')}`);
    } catch (error) { failures.push({ goodsId:product.goodsId,error:error.code ?? error.message }); }
  }
  return { imageDataByGoodsId,failures };
}

async function verifyAndRenderWorkbook(workbook,qaDir,model) {
  await fs.mkdir(qaDir,{ recursive:true });
  const overview=await workbook.inspect({ kind:'table',sheetId:'市场总览',range:'A1:J50',include:'values,formulas',tableMaxRows:50,tableMaxCols:10,maxChars:12000 });
  const categories=await workbook.inspect({ kind:'table',sheetId:'类目分析',range:`A1:AJ${model.categories.length+1}`,include:'values,formulas',tableMaxRows:15,tableMaxCols:36,maxChars:16000 });
  const errors=await workbook.inspect({ kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{ useRegex:true,maxResults:300 },summary:'Day8 pre-export formula error scan' });
  if ((String(errors.ndjson ?? '').match(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/g) ?? []).length) throw new Error('Day8工作簿预导出公式检查失败。');
  await fs.writeFile(path.join(qaDir,'inspect-summary.ndjson'),`${overview.ndjson ?? ''}\n${categories.ndjson ?? ''}`,'utf8');
  const renders=[
    ['市场总览','A1:J50','market-overview.png'],['类目分析',`A1:AJ${model.categories.length+1}`,'category-analysis.png'],
    ['商品指标','A1:Z12','product-metrics-sample.png'],['字段说明',model.fineClassification ? 'A1:L18' : 'A1:L16','field-definitions.png']
  ];
  if (model.fineClassification) {
    renders.push(['细分类分析',`A1:S${model.fineClassification.metrics.length+1}`,'fine-classification-analysis.png']);
    renders.push(['人工复核队列',`A1:F${Math.min(model.fineClassification.manualReviewQueue.length+1,40)}`,'manual-review-queue.png']);
  }
  for (const [sheetName,range,fileName] of renders) {
    const blob=await workbook.render({ sheetName,range,scale:1,format:'png' });
    await fs.writeFile(path.join(qaDir,fileName),new Uint8Array(await blob.arrayBuffer()));
  }
}
