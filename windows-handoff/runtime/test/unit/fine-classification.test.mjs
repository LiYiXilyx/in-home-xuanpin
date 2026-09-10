import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBusinessAlignment,screenBusinessEligibility } from '../../src/modules/analysis/business-screening.mjs';
import { analyzeCategories } from '../../src/modules/analysis/category-analysis.mjs';
import { hashFineClassificationInput,parseFineAiOutput } from '../../src/modules/products/fine-classification-ai.mjs';
import { classifyFineProduct,compileFineTaxonomy,sampleSizeStatus,validateFineTaxonomyOutput } from '../../src/modules/products/fine-taxonomy.mjs';

const taxonomy=compileFineTaxonomy(JSON.parse(fs.readFileSync(new URL('../../config/fine-category-rules.v1.json',import.meta.url),'utf8')));

test('AI structured output parser accepts fixed schema and rejects malformed output',() => {
  const valid=parseFineAiOutput(JSON.stringify({ level2:'收纳与携带',level3:'油箱包',product_family:'油箱包',is_electronic:false,has_usb:false,battery_risk:false,certification_risk:false,confidence:0.9,reason:'title明确命中tank bag' }),taxonomy);
  assert.equal(valid.valid,true);assert.equal(valid.categoryKey,'tank-bag');
  assert.deepEqual(parseFineAiOutput('{bad',taxonomy).errors,['INVALID_JSON']);
});

test('taxonomy validator rejects unknown paths and invalid flags',() => {
  const checked=validateFineTaxonomyOutput({ level2:'未知',level3:'杜撰类目',confidence:2,reason:'',is_electronic:'no',has_usb:false,battery_risk:false,certification_risk:false },taxonomy);
  assert.equal(checked.valid,false);assert.ok(checked.errors.includes('UNKNOWN_TAXONOMY_PATH'));assert.ok(checked.errors.includes('INVALID_CONFIDENCE'));
});

test('confidence thresholds separate auto, review and manual states',() => {
  const auto=classifyFineProduct({ title:'Motorcycle tail bag rear seat bag' },taxonomy);assert.ok(auto.confidence >= 0.85);assert.equal(auto.needsReview,false);
  const review=classifyFineProduct({ title:'Motorcycle bracket accessory' },taxonomy);assert.ok(review.confidence >= 0.65 && review.confidence < 0.85);assert.equal(review.needsReview,true);assert.equal(review.manualReviewRequired,false);
  const manual=classifyFineProduct({ title:'Universal motorcycle accessory model ABC' },taxonomy);assert.ok(manual.confidence < 0.65);assert.equal(manual.manualReviewRequired,true);assert.ok(manual.unresolvedReason);
});

test('fine classification business signals trigger second exclusion',() => {
  const screened=screenBusinessEligibility({ title:'Wireless Type-C charging headset',categoryLabel:'电子通信设备',level2:'照明与电气',taxonomy:taxonomy.taxonomy,price:10,rating:4.8,reviewCount:20,businessSignals:{ isElectronic:true,hasUsb:true,batteryRisk:false,certificationRisk:true } });
  assert.equal(screened.businessEligible,false);assert.ok(screened.businessExclusionCodes.includes('ELECTRONIC_PRODUCT'));assert.ok(screened.businessExclusionCodes.includes('USB_PRODUCT'));assert.ok(screened.businessExclusionCodes.includes('CERTIFICATION_RISK'));
});

test('sample size guard follows usable/small/insufficient thresholds',() => {
  assert.equal(sampleSizeStatus(10),'usable');assert.equal(sampleSizeStatus(9),'small_sample');assert.equal(sampleSizeStatus(5),'small_sample');assert.equal(sampleSizeStatus(4),'insufficient_sample');
});

test('classification version and input hash are stable',() => {
  const result=classifyFineProduct({ title:'Motorcycle carburetor PWK racing carburetor' },taxonomy);assert.equal(result.taxonomy,'week2-motorcycle-fine-v1');assert.equal(result.ruleVersion,'week2-fine-rule-v1');
  const input={ goods_id:'1',title:'x',current_category:'其他',rule_evidence:[],image_metadata:null };assert.equal(hashFineClassificationInput(input),hashFineClassificationInput({ ...input }));
});

test('fine categories still reconcile all products through business tri-state',() => {
  const products=[{ goodsId:'1',title:'Tail bag',categoryLabel:'尾包与后座包',taxonomy:taxonomy.taxonomy,price:10,sales:10,rating:4.8,reviewCount:20,needsReview:false },{ goodsId:'2',title:'Unknown',categoryLabel:'其他',taxonomy:taxonomy.taxonomy,price:10,sales:5,rating:4.8,reviewCount:20,manualReviewRequired:true }];
  const aligned=buildBusinessAlignment(analyzeCategories(products));assert.equal(aligned.summary.eligibleCount+aligned.summary.excludedCount+aligned.summary.pendingFineClassificationCount,2);
});
