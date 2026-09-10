import { fineClassificationInput,hashFineClassificationInput,hashFineClassifierResponse } from './fine-classification-input.mjs';
import { buildFineClassificationPrompt } from './fine-classification-prompt.mjs';
import { createFineClassificationProvider,resolveFineClassifierRuntime } from './fine-classification-provider.mjs';
import { validateFineTaxonomyOutput } from './fine-taxonomy.mjs';

export { fineClassificationInput,hashFineClassificationInput } from './fine-classification-input.mjs';

export const FINE_AI_SCHEMA=Object.freeze({
  required:['level2','level3','product_family','is_electronic','has_usb','battery_risk','certification_risk','confidence','reason']
});

export function parseFineAiOutput(raw,taxonomy) {
  let value=raw;
  if (typeof raw === 'string') {
    const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    try { value=JSON.parse(cleaned); } catch { return invalid('invalid_json',['INVALID_JSON']); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('schema_invalid',['OUTPUT_NOT_OBJECT']);
  const schemaErrors=validateSchema(value);
  if (schemaErrors.length) return invalid('schema_invalid',schemaErrors);
  const output={
    level2:value.level2.trim(),level3:value.level3.trim(),product_family:value.product_family.trim(),
    is_electronic:value.is_electronic,has_usb:value.has_usb,battery_risk:value.battery_risk,
    certification_risk:value.certification_risk,confidence:value.confidence,reason:value.reason.trim()
  };
  const taxonomyValidation=validateFineTaxonomyOutput(output,taxonomy);
  const taxonomyErrors=[...taxonomyValidation.errors];
  if (output.product_family !== output.level3) taxonomyErrors.push('PRODUCT_FAMILY_LEVEL3_MISMATCH');
  if (taxonomyErrors.length) return { ...invalid('taxonomy_invalid',[...new Set(taxonomyErrors)]),output };
  return { valid:true,validationStatus:'valid',output,errors:[],categoryKey:taxonomyValidation.categoryKey };
}

export async function classifyWithConfiguredModel(product,taxonomy,aiConfig={},options={}) {
  const runtime=options.runtime ?? resolveFineClassifierRuntime(aiConfig,options.env ?? process.env);
  const base={
    ai_enabled:runtime.enabled,aiEnabled:runtime.enabled,requestedEnabled:runtime.requestedEnabled,provider:runtime.provider || null,
    model:runtime.model || null,modelVersion:runtime.modelVersion || null,promptVersion:taxonomy.promptVersion
  };
  if (!runtime.enabled) return { ...base,attempted:false,failureCode:runtime.disabledReason,validationStatus:'disabled',fallbackRequired:true };
  if (options.dryRun) return { ...base,attempted:false,failureCode:'dry_run',validationStatus:'disabled',fallbackRequired:true };

  const prompt=buildFineClassificationPrompt(product,taxonomy);
  const provider=options.provider ?? createFineClassificationProvider(runtime,{ fetchImpl:options.fetchImpl,mockResponder:options.mockResponder });
  const response=await provider.invoke(prompt);
  if (!response.ok) return {
    ...base,attempted:true,inputHash:prompt.inputHash,responseHash:null,valid:false,validationStatus:response.failureCode,
    failureCode:response.failureCode,errors:[response.failureCode],confidence:0,fallbackRequired:true
  };
  const responseHash=hashFineClassifierResponse(response.raw);
  const parsed=parseFineAiOutput(response.raw,taxonomy);
  const confidence=Number(parsed.output?.confidence ?? 0);
  const accepted=parsed.valid && confidence >= taxonomy.reviewAccept;
  return { ...base,attempted:true,inputHash:prompt.inputHash,responseHash,rawOutput:response.raw,...parsed,confidence,accepted,fallbackRequired:!accepted };
}

export function applyFineAiFallback(ruleResult,aiResult,taxonomy) {
  if (!aiResult?.accepted) return ruleResult;
  const output=aiResult.output;
  const category=taxonomy.categories.find(item => item.categoryKey === aiResult.categoryKey);
  return {
    taxonomy:taxonomy.taxonomy,categoryKey:aiResult.categoryKey,categoryLabel:output.level3,level1:category.level1,
    level2:output.level2,level3:output.level3,productFamily:output.product_family,method:'ai',ruleVersion:taxonomy.ruleVersion,
    confidence:output.confidence,needsReview:output.confidence < taxonomy.autoAccept,manualReviewRequired:false,unresolvedReason:null,
    reasons:[{ code:'AI_STRUCTURED_CLASSIFICATION',reason:output.reason }]
  };
}

function validateSchema(value) {
  const errors=FINE_AI_SCHEMA.required.filter(key => !(key in value)).map(key => `MISSING_${key.toUpperCase()}`);
  for (const field of ['level2','level3','product_family','reason']) if (field in value && (typeof value[field] !== 'string' || !value[field].trim())) errors.push(`INVALID_${field.toUpperCase()}`);
  for (const flag of ['is_electronic','has_usb','battery_risk','certification_risk']) if (flag in value && typeof value[flag] !== 'boolean') errors.push(`INVALID_${flag.toUpperCase()}`);
  if ('confidence' in value && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) errors.push('INVALID_CONFIDENCE');
  return [...new Set(errors)];
}

function invalid(validationStatus,errors) { return { valid:false,validationStatus,output:null,errors,categoryKey:null }; }
