import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProductByRules,compileCategoryRules } from '../../src/modules/products/rule-classifier.mjs';

const rules=compileCategoryRules({ taxonomy:'test',ruleVersion:'v1',reviewThreshold:0.7,defaultLevel1:'摩托车配件',categories:[
  { categoryKey:'phone',level2:'安装',level3:'手机支架',priority:10,keywords:['phone mount','phone holder'] },
  { categoryKey:'light',level2:'电子',level3:'照明',priority:20,keywords:['led light','light'] }
],fallback:{ categoryKey:'other',level2:'其他',level3:'其他' } });

test('rule classifier stores explainable hierarchy and version',() => {
  const result=classifyProductByRules({ title:'Waterproof phone mount and phone holder' },rules);
  assert.equal(result.level1,'摩托车配件'); assert.equal(result.level3,'手机支架'); assert.equal(result.method,'rule');
  assert.equal(result.ruleVersion,'v1'); assert.equal(result.confidence,0.92); assert.equal(result.needsReview,false);
  assert.deepEqual(result.reasons[0].matchedKeywords,['phone mount','phone holder']);
});
test('priority resolves equal multi-category matches but keeps it for review',() => {
  const result=classifyProductByRules({ title:'Phone mount with light' },rules);
  assert.equal(result.categoryKey,'phone'); assert.equal(result.needsReview,true); assert.equal(result.confidence,0.55);
  assert.equal(result.reasons[1].code,'AMBIGUOUS_MATCH');
});
test('unmatched product becomes low-confidence other for human review',() => {
  const result=classifyProductByRules({ title:'Universal accessory' },rules);
  assert.equal(result.categoryLabel,'其他'); assert.equal(result.needsReview,true); assert.ok(result.confidence < 0.7);
});
test('short keyword uses word boundaries and does not classify clamp as lamp',() => {
  const result=classifyProductByRules({ title:'Fuel hose clamp kit' },rules);
  assert.equal(result.categoryLabel,'其他');
});
