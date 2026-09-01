import test from 'node:test';import assert from 'node:assert/strict';
import {calculateOpportunity,normalizeSupplierCandidate,resolveReviewFx} from '../../src/modules/sourcing/review-opportunity-calculator.mjs';

const fx=resolveReviewFx({fx:{pair:'CNY/EUR',rate:0.12,source:'MANUAL_CONFIG',observedAt:'2026-08-28'}});

test('versioned CNY/EUR config exposes both directions without Catalog inference',()=>{
  assert.equal(fx.status,'AVAILABLE');assert.equal(fx.eur_per_cny,0.12);assert.equal(fx.cny_per_eur,8.333333);
  assert.equal(resolveReviewFx({}).status,'FX_RATE_REQUIRED');
});

for(const [groupMin,supplierEur,ratio,band] of [[1.2,.1,12,'HIGH'],[1.2,.2,6,'MEDIUM'],[1.2,.4,3,'LOW'],[3.6,.1,36,'REVIEW_REQUIRED']]) {
  test(`ratio ${ratio} yields ${band}`,()=>assert.deepEqual(calculateOpportunity({
    group:group(groupMin),candidate:candidate(supplierEur),fx,
  }),{opportunity_ratio:ratio,opportunity_band:band,opportunity_reasons:[]}));
}

test('missing FX, group unit, low supplier unit and low group override ordinary bands',()=>{
  assert.equal(calculateOpportunity({group:group(1.2),candidate:candidate(.1),fx:{status:'FX_RATE_REQUIRED'}}).opportunity_band,'FX_RATE_REQUIRED');
  assert.equal(calculateOpportunity({group:group(null),candidate:candidate(.1),fx}).opportunity_band,'TEMU_UNIT_PRICE_REQUIRED');
  assert.equal(calculateOpportunity({group:group(1.2),candidate:{...candidate(.1),supplier_quantity_confidence:'LOW'},fx}).opportunity_band,'UNIT_REVIEW_REQUIRED');
  assert.equal(calculateOpportunity({group:{...group(1.2),group_confidence:'LOW'},candidate:candidate(.1),fx}).opportunity_band,'GROUP_REVIEW_REQUIRED');
});

test('supplier range uses high price, minimum-only tier is provisional, and MOQ is separate',()=>{
  const ranged=normalizeSupplierCandidate({supplier_title:'10pcs clips',price_min_rmb:8,price_max_rmb:12,moq:100},fx);
  assert.equal(ranged.supplier_effective_price_cny,12);assert.equal(ranged.supplier_pack_quantity,10);
  assert.equal(ranged.supplier_unit_price_cny,1.2);assert.equal(ranged.supplier_price_basis,'RANGE_HIGH_CONSERVATIVE');
  const minimum=normalizeSupplierCandidate({supplier_title:'single clip',price_min_rmb:8,price_max_rmb:null,moq:10},fx);
  assert.equal(minimum.supplier_pack_quantity,1);assert.equal(minimum.supplier_price_basis,'MINIMUM_TIER_PROVISIONAL');
  assert.equal(calculateOpportunity({group:group(1.2),candidate:minimum,fx}).opportunity_band,'PRICE_TIER_REVIEW_REQUIRED');
});

function group(min){return {metrics:{group_min_unit_price_eur:min},group_confidence:'HIGH'};}
function candidate(eur){return {supplier_unit_price_eur:eur,supplier_quantity_confidence:'HIGH',supplier_price_basis:'LISTED_SINGLE_VALUE'};}
