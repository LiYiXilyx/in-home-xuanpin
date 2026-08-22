import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyFineAiFallback,classifyWithConfiguredModel } from '../../src/modules/products/fine-classification-ai.mjs';
import { resolveFineClassifierRuntime } from '../../src/modules/products/fine-classification-provider.mjs';
import { compileFineTaxonomy } from '../../src/modules/products/fine-taxonomy.mjs';
import { createLogger,redact } from '../../src/shared/logger.mjs';

const taxonomy=compileFineTaxonomy(JSON.parse(fs.readFileSync(new URL('../../config/fine-category-rules.v1.json',import.meta.url),'utf8')));
const product={ goodsId:'100',title:'Motorcycle tank bag',categoryLabel:'其他' };
const validOutput={ level2:'收纳与携带',level3:'油箱包',product_family:'油箱包',is_electronic:false,has_usb:false,battery_risk:false,certification_risk:false,confidence:0.91,reason:'title明确' };
const openAiConfig={ enabled:true,provider:'openai-compatible',model:'test-model',modelVersion:'test-v1',baseUrl:'https://model.invalid',timeoutMs:20 };

test('enabled without API key switches to rule-only and records ai_enabled=false',async () => {
  let called=false;
  const runtime=resolveFineClassifierRuntime(openAiConfig,{ TEMU_FINE_CLASSIFIER_ENABLED:'true' });
  const result=await classifyWithConfiguredModel(product,taxonomy,openAiConfig,{ runtime,fetchImpl:async () => { called=true; } });
  assert.equal(runtime.enabled,false);assert.equal(runtime.disabledReason,'MISSING_API_KEY');
  assert.equal(result.ai_enabled,false);assert.equal(result.aiEnabled,false);assert.equal(result.attempted,false);assert.equal(called,false);
});

test('the five documented environment variables configure runtime without storing the key in config',() => {
  const config={ enabled:false,provider:'',model:'',modelVersion:'v-env',baseUrl:'',timeoutMs:10 };
  const runtime=resolveFineClassifierRuntime(config,{
    TEMU_FINE_CLASSIFIER_ENABLED:'true',TEMU_FINE_CLASSIFIER_PROVIDER:'openai-compatible',
    TEMU_FINE_CLASSIFIER_MODEL:'env-model',TEMU_FINE_CLASSIFIER_API_KEY:'test-only-secret',
    TEMU_FINE_CLASSIFIER_BASE_URL:'https://model.invalid'
  });
  assert.equal(runtime.enabled,true);assert.equal(runtime.provider,'openai-compatible');assert.equal(runtime.model,'env-model');
  assert.equal(runtime.baseUrl,'https://model.invalid');assert.equal('apiKey' in config,false);
});

test('AI disabled never invokes provider',async () => {
  const result=await classifyWithConfiguredModel(product,taxonomy,{ ...openAiConfig,enabled:false },{ env:{} });
  assert.equal(result.aiEnabled,false);assert.equal(result.failureCode,'AI_DISABLED');
});

test('mock provider succeeds through schema, taxonomy and confidence gates',async () => {
  const config={ enabled:true,provider:'mock',model:'mock-v1',modelVersion:'mock-2026',baseUrl:'',timeoutMs:20 };
  const result=await classifyWithConfiguredModel(product,taxonomy,config,{ env:{},mockResponder:JSON.stringify(validOutput) });
  assert.equal(result.valid,true);assert.equal(result.accepted,true);assert.equal(result.validationStatus,'valid');
  assert.match(result.inputHash,/^[a-f0-9]{64}$/);assert.match(result.responseHash,/^[a-f0-9]{64}$/);
});

test('invalid JSON and schema errors are classified and fall back',async t => {
  const config={ enabled:true,provider:'mock',model:'mock-v1',baseUrl:'' };
  await t.test('invalid JSON',async () => {
    const result=await classifyWithConfiguredModel(product,taxonomy,config,{ env:{},mockResponder:'{bad' });
    assert.equal(result.validationStatus,'invalid_json');assert.equal(result.fallbackRequired,true);
  });
  await t.test('schema invalid',async () => {
    const result=await classifyWithConfiguredModel(product,taxonomy,config,{ env:{},mockResponder:JSON.stringify({ level2:'收纳与携带' }) });
    assert.equal(result.validationStatus,'schema_invalid');assert.equal(result.fallbackRequired,true);
  });
  await t.test('taxonomy invalid',async () => {
    const result=await classifyWithConfiguredModel(product,taxonomy,config,{ env:{},mockResponder:JSON.stringify({ ...validOutput,level2:'杜撰',level3:'杜撰',product_family:'杜撰' }) });
    assert.equal(result.validationStatus,'taxonomy_invalid');assert.equal(result.fallbackRequired,true);
  });
});

test('timeout and provider errors do not throw or block fallback',async t => {
  const config={ enabled:true,provider:'mock',model:'mock-v1',baseUrl:'' };
  await t.test('timeout',async () => {
    const result=await classifyWithConfiguredModel(product,taxonomy,config,{ env:{},mockResponder:() => { const error=new Error('slow');error.name='AbortError';throw error; } });
    assert.equal(result.validationStatus,'timeout');assert.equal(result.fallbackRequired,true);
  });
  await t.test('provider error',async () => {
    const result=await classifyWithConfiguredModel(product,taxonomy,config,{ env:{},mockResponder:() => { throw new Error('service down'); } });
    assert.equal(result.validationStatus,'provider_error');assert.equal(result.fallbackRequired,true);
  });
});

test('fallback retains rule/manual result after any AI failure',async () => {
  const rule={ method:'manual',manualReviewRequired:true,categoryKey:'other-unresolved' };
  const ai=await classifyWithConfiguredModel(product,taxonomy,{ enabled:true,provider:'mock',model:'mock-v1' },{ env:{},mockResponder:'not-json' });
  assert.equal(applyFineAiFallback(rule,ai,taxonomy),rule);
});

test('dry-run performs zero provider calls',async () => {
  let called=false;
  const result=await classifyWithConfiguredModel(product,taxonomy,{ enabled:true,provider:'mock',model:'mock-v1' },{ env:{},dryRun:true,mockResponder:() => { called=true; } });
  assert.equal(result.failureCode,'dry_run');assert.equal(result.attempted,false);assert.equal(called,false);
});

test('API key is redacted and never written to log output',t => {
  const secret='TEST_SECRET_VALUE_DO_NOT_LOG';
  assert.equal(redact({ apiKey:secret }).apiKey,'[REDACTED]');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-ai-log-'));t.after(() => fs.rmSync(directory,{ recursive:true,force:true }));
  const logger=createLogger({ logDir:directory,consoleOutput:false,now:() => new Date('2026-08-22T00:00:00Z') });
  logger.info('provider configured',{ TEMU_FINE_CLASSIFIER_API_KEY:secret,authorization:`Bearer ${secret}`,model:'mock' });
  const content=fs.readFileSync(path.join(directory,'2026-08-22.jsonl'),'utf8');
  assert.equal(content.includes(secret),false);assert.match(content,/\[REDACTED\]/);
});
