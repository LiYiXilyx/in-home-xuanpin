import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { createAnalysisRepository } from '../../db/repositories/analysis-repository.mjs';
import { createClassificationRepository } from '../../db/repositories/classification-repository.mjs';
import { createFineClassificationRepository } from '../../db/repositories/fine-classification-repository.mjs';
import { analyzeCategories } from '../analysis/category-analysis.mjs';
import { buildBusinessAlignment } from '../analysis/business-screening.mjs';
import { runMarketAnalysis } from '../analysis/market-analysis-service.mjs';
import { applyFineAiFallback,classifyWithConfiguredModel,fineClassificationInput,hashFineClassificationInput,parseFineAiOutput } from './fine-classification-ai.mjs';
import { resolveFineClassifierRuntime } from './fine-classification-provider.mjs';
import { classifyFineProduct,compileFineTaxonomy } from './fine-taxonomy.mjs';
import { assertTaxonomyBinding,loadCategoryProfile,resolveTaxonomyBinding } from '../catalog-scale/category-profile.mjs';

export async function runFineClassification(config,options={}) {
  if (!options.poolVersionId || !options.profilePath) throw new Error('正式细分类必须显式提供 poolVersionId 与 profilePath。');
  const expectedActiveCount=Number(options.expectedActiveCount ?? 1000);
  const rulesPath=path.resolve(path.dirname(config.configPath),options.rulesPath ?? config.fineClassification?.rulesPath ?? 'config/fine-category-rules.v1.json');
  const taxonomy=compileFineTaxonomy(JSON.parse(await fs.readFile(rulesPath,'utf8')));
  const profile=await loadCategoryProfile(path.resolve(path.dirname(config.configPath),options.profilePath));
  assertTaxonomyBinding({ profile,pipeline:'fine_classify',taxonomyName:taxonomy.taxonomy,taxonomyVersion:null,ruleVersion:taxonomy.ruleVersion });
  const sourceBinding=resolveTaxonomyBinding(profile,'classify');
  const sourceTaxonomy=options.sourceTaxonomy ?? sourceBinding.taxonomyName;
  if (sourceTaxonomy!==sourceBinding.taxonomyName) throw Object.assign(new Error('细分类 source taxonomy 与 Category binding 不匹配。'),{ code:'TAXONOMY_BINDING_MISMATCH' });
  const poolScope={ poolVersionId:options.poolVersionId,categoryKey:profile.category_key };
  const aiConfig={ ...config.fineClassification?.ai,promptVersion:taxonomy.promptVersion };
  const aiRuntime=resolveFineClassifierRuntime(aiConfig,options.env ?? process.env);
  const outputDir=path.resolve(path.dirname(config.configPath),options.outputDir ?? 'outputs/week2');await fs.mkdir(outputDir,{ recursive:true });
  const db=openDatabase(config.app.databasePath);let sourceJobId,coreBefore,attempts=[],classifications=[],processedQueueCount=0,aiAttemptCount=0;
  try {
    const analysisRepository=createAnalysisRepository(db);const classificationRepository=createClassificationRepository(db);const auditRepository=createFineClassificationRepository(db);
    sourceJobId=analysisRepository.resolvePoolJobId({ ...poolScope,requestedJobId:options.jobId });coreBefore=analysisRepository.coreCounts();
    const week1Products=analysisRepository.listPoolProducts(sourceJobId,sourceTaxonomy,poolScope);
    const before=buildBusinessAlignment(analyzeCategories(week1Products));const queueIds=new Set(before.products.filter(item => item.businessEligible === null).map(item => item.goodsId));
    processedQueueCount=queueIds.size;if (processedQueueCount !== Number(options.expectedQueueCount ?? 394)) throw new Error(`Day8.2待细分类队列为${processedQueueCount}，预期${options.expectedQueueCount ?? 394}。`);
    const classifiedAt=(options.now?.() ?? new Date()).toISOString();
    for (const product of week1Products) {
      const isQueue=queueIds.has(product.goodsId);const ruleResult=classifyFineProduct({ ...product,currentCategory:product.categoryLabel },taxonomy);
      let chosen=ruleResult;const input=fineClassificationInput(product);const inputHash=hashFineClassificationInput(input);
      if (isQueue) attempts.push(makeAttempt(product,sourceJobId,taxonomy,ruleResult,inputHash,classifiedAt));
      if (isQueue && aiRuntime.enabled && ruleResult.confidence < taxonomy.autoAccept) {
        const ai=await classifyWithConfiguredModel(product,taxonomy,aiConfig,{ runtime:aiRuntime,...options.aiDependencies });aiAttemptCount+=ai.attempted ? 1 : 0;
        if (ai.attempted) {
          attempts.push({ productId:product.productId,jobId:sourceJobId,taxonomy:taxonomy.taxonomy,method:'ai',provider:ai.provider,model:ai.model,modelVersion:ai.modelVersion,promptVersion:ai.promptVersion,inputHash:ai.inputHash,responseHash:ai.responseHash,validationStatus:ai.validationStatus,structuredOutput:ai.output ?? {},validationResult:{ valid:ai.valid,errors:ai.errors ?? [ai.failureCode] },confidence:ai.confidence,unresolvedReason:ai.accepted ? null : `AI_FALLBACK:${ai.validationStatus}`,classifiedAt });
          chosen=applyFineAiFallback(ruleResult,ai,taxonomy);
        }
      }
      if (!isQueue && chosen.manualReviewRequired) chosen=carryWeek1(product,taxonomy);
      const signals=businessSignals(product.title,chosen.categoryKey,chosen.level2);
      classifications.push({ productId:product.productId,goodsId:product.goodsId,...chosen,evidence:{ businessSignals:signals,manualReviewRequired:chosen.manualReviewRequired,unresolvedReason:chosen.unresolvedReason,previousCategory:product.categoryLabel,inputHash },reasons:chosen.reasons });
    }
    classificationRepository.replaceAll(sourceJobId,classifications,{ now:classifiedAt });auditRepository.saveAttempts(attempts);
    const counts=classificationRepository.count(sourceJobId,taxonomy.taxonomy);if (Number(counts.count) !== expectedActiveCount) throw new Error(`Week2细分类状态不是${expectedActiveCount}条：${counts.count}`);
  } finally { db.close(); }
  const market=await runMarketAnalysis(config,{ jobId:sourceJobId,taxonomy:taxonomy.taxonomy,analysisVersion:'week2-business-fine-v2',expectedActiveCount,outputDir,
    poolVersionId:poolScope.poolVersionId,categoryKey:poolScope.categoryKey,
    fineContext:{ beforeOtherCount:options.beforeOtherCount ?? 540,processedQueueCount } });
  const fine=market.fineClassification;const result={ runId:market.runId,sourceJobId,taxonomy:taxonomy.taxonomy,ruleVersion:taxonomy.ruleVersion,promptVersion:taxonomy.promptVersion,
    ai:{ ai_enabled:aiRuntime.enabled,enabled:aiRuntime.enabled,requestedEnabled:aiRuntime.requestedEnabled,disabledReason:aiRuntime.disabledReason,provider:aiRuntime.enabled ? aiRuntime.provider : null,model:aiRuntime.enabled ? aiRuntime.model : null,modelVersion:aiRuntime.enabled ? aiRuntime.modelVersion : null,attemptCount:aiAttemptCount,status:aiRuntime.enabled ? 'configured' : 'rule_only_no_api_call' },
    processedQueueCount,attemptRecords:attempts.length,summary:fine.summary,businessSummary:market.businessSummary,mainRanking:fine.mainRanking,observationRanking:fine.observationRanking,candidates:fine.candidates,manualReviewQueue:fine.manualReviewQueue,metrics:fine.metrics,coreBefore,coreAfter:market.qa.counts.coreAfter,qa:market.qa,workbookPath:market.workbookPath };
  await fs.writeFile(path.join(outputDir,'fine-classification-result.json'),JSON.stringify(result,null,2),'utf8');
  await fs.writeFile(path.join(outputDir,'manual-review-required.json'),JSON.stringify({ runId:market.runId,count:fine.manualReviewQueue.length,items:fine.manualReviewQueue },null,2),'utf8');
  await fs.writeFile(path.join(outputDir,'day9-priority-research-categories.json'),JSON.stringify({ runId:market.runId,notice:'仅代表Day9评论与生命周期研究优先级，不是最终选品结论，也不表示其他业务可做商品永远不抓评论。',count:fine.candidates.length,items:fine.candidates },null,2),'utf8');
  return result;
}

function makeAttempt(product,jobId,taxonomy,result,inputHash,classifiedAt) {
  const output=structuredOutput(product.title,result);const validation=parseFineAiOutput(JSON.stringify(output),taxonomy);
  return { productId:product.productId,jobId,taxonomy:taxonomy.taxonomy,method:'rule',promptVersion:taxonomy.promptVersion,inputHash,responseHash:null,validationStatus:validation.validationStatus,structuredOutput:output,validationResult:{ valid:validation.valid,errors:validation.errors },confidence:result.confidence,unresolvedReason:result.unresolvedReason,classifiedAt };
}
function structuredOutput(title,result) { const flags=businessSignals(title,result.categoryKey,result.level2);return { level2:result.level2,level3:result.level3,product_family:result.level3,is_electronic:flags.isElectronic,has_usb:flags.hasUsb,battery_risk:flags.batteryRisk,certification_risk:flags.certificationRisk,confidence:result.confidence,reason:result.unresolvedReason || result.reasons.map(item => item.code).join('|') }; }
function businessSignals(title,categoryKey,level2) { const text=String(title ?? '');const isElectronic=level2 === '照明与电气' || categoryKey === 'ignition-cdi';const hasUsb=/(?:usb|type[-\s]?c)(?=$|[^a-z])/i.test(text);const batteryRisk=/\b(?:battery|batteries|rechargeable|lithium|li[-\s]?ion|power\s*bank)\b/i.test(text);const certificationRisk=isElectronic || /\b(?:bluetooth|headset|headphone|earphone|earbud|intercom|audio|speaker|charger|charging|microphone)\b/i.test(text);return { isElectronic,hasUsb,batteryRisk,certificationRisk }; }
function carryWeek1(product,taxonomy) { return { taxonomy:taxonomy.taxonomy,categoryKey:`carried-${product.categoryKey ?? 'other'}`,categoryLabel:product.categoryLabel,level1:'Motorcycle Accessories',level2:product.level2 ?? '已有业务分类',level3:product.categoryLabel,productFamily:product.categoryLabel,method:'rule',ruleVersion:taxonomy.ruleVersion,confidence:Number(product.classificationConfidence ?? 0.7),needsReview:false,manualReviewRequired:false,unresolvedReason:null,reasons:[{ code:'CARRIED_WEEK1_HIGH_CONFIDENCE',previousCategory:product.categoryLabel }] }; }
