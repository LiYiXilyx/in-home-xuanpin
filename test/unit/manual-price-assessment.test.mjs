import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateManualPriceAssessment} from '../../src/modules/sourcing/manual-price-assessment.mjs';

const fx={status:'AVAILABLE',cny_per_eur:8,eur_per_cny:0.125,source:'MANUAL_CONFIG',as_of:'2026-09-03'};

test('calculates explicit pack unit prices and price ratio',()=>{
  const result=calculateManualPriceAssessment({temuPriceEur:10,temuPackQuantity:2,supplierPriceCny:20,supplierPackQuantity:4,moq:100,fx});
  assert.deepEqual(result,{temu_price_eur:10,temu_pack_quantity:2,temu_unit_price_eur:5,supplier_price_cny:20,supplier_pack_quantity:4,supplier_unit_price_cny:5,supplier_unit_price_eur:0.625,moq:100,fx_cny_per_eur:8,fx_source:'MANUAL_CONFIG',fx_as_of:'2026-09-03',price_ratio:8,formula_version:'MANUAL_PRICE_RATIO_V1',status:'READY'});
});

test('MOQ never substitutes for supplier pack quantity',()=>{
  assert.throws(()=>calculateManualPriceAssessment({temuPriceEur:10,temuPackQuantity:1,supplierPriceCny:20,supplierPackQuantity:null,moq:20,fx}),error=>error.code==='PACK_QUANTITY_REQUIRED');
});

test('missing FX blocks assessment',()=>{
  assert.throws(()=>calculateManualPriceAssessment({temuPriceEur:10,temuPackQuantity:1,supplierPriceCny:20,supplierPackQuantity:1,fx:{status:'FX_RATE_REQUIRED'}}),error=>error.code==='FX_RATE_REQUIRED');
});
