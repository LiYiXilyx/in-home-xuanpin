import test from 'node:test';
import assert from 'node:assert/strict';

const fxModule=await import('../../ui/market-evidence-fx.js').catch(()=>({}));
const normalize=fxModule.normalizeFxContext??(()=>({}));
const calculate=fxModule.calculateMarketEvidenceRatio??(()=>({}));
const display=fxModule.marketEvidenceFxDisplay??(()=>({}));

test('valid CNY per EUR is the single object used by display and ratio',()=>{
  assert.equal(typeof fxModule.normalizeFxContext,'function');
  const fx=normalize({status:'AVAILABLE',cny_per_eur:8.3333,eur_per_cny:0.12,source:'MANUAL_CONFIG',as_of:'2026-08-28'});
  const result=calculate({fx,temuPriceEur:8.91,temuPackQuantity:1,supplierPriceCny:6.5,supplierPackQuantity:1});
  assert.equal(result.fx,fx);
  assert.equal(result.supplierUnitPriceEur,0.78);
  assert.equal(result.priceRatio,11.42);
  assert.deepEqual(display(fx),{status:'AVAILABLE',rate:'当前汇率：1 EUR = 8.3333 CNY',source:'来源：手工配置',asOf:'更新日期：2026-08-28'});
});

test('EUR per CNY alone is inverted once for both display and ratio',()=>{
  const fx=normalize({status:'AVAILABLE',eur_per_cny:0.125,source:'TEST',as_of:'2026-09-01'});
  assert.equal(fx.cnyPerEur,8);
  assert.equal(fx.eurPerCny,0.125);
  assert.equal(display(fx).rate,'当前汇率：1 EUR = 8 CNY');
  assert.equal(calculate({fx,temuPriceEur:10,temuPackQuantity:1,supplierPriceCny:5,supplierPackQuantity:1}).priceRatio,16);
});

test('missing FX renders configured absence and never calculates zero',()=>{
  const fx=normalize({status:'FX_RATE_REQUIRED',cny_per_eur:null,eur_per_cny:null});
  assert.equal(fx.status,'MISSING');
  assert.deepEqual(display(fx),{status:'MISSING',rate:'汇率未配置',source:'来源：未注明',asOf:'日期：未记录'});
  assert.deepEqual(calculate({fx,temuPriceEur:8.91,temuPackQuantity:1,supplierPriceCny:6.5,supplierPackQuantity:1}),{fx,supplierUnitPriceEur:null,priceRatio:null});
});

for(const invalid of [0,-1,NaN,Infinity])test(`invalid CNY per EUR ${String(invalid)} is fail-closed`,()=>{
  const fx=normalize({status:'AVAILABLE',cny_per_eur:invalid,source:'BAD'});
  assert.equal(fx.status,'FX_INVALID');
  assert.equal(display(fx).rate,'汇率配置无效，请检查Sourcing配置。');
  assert.equal(calculate({fx,temuPriceEur:8.91,temuPackQuantity:1,supplierPriceCny:6.5,supplierPackQuantity:1}).priceRatio,null);
});

test('valid rate never invents missing source or date',()=>{
  const fx=normalize({status:'AVAILABLE',cny_per_eur:7.5});
  assert.equal(display(fx).rate,'当前汇率：1 EUR = 7.5 CNY');
  assert.equal(display(fx).source,'来源：未注明');
  assert.equal(display(fx).asOf,'日期：未记录');
});

test('switching goods and runs derives only from the supplied detail context',()=>{
  const first=normalize({status:'AVAILABLE',cny_per_eur:8,source:'RUN_A',as_of:'2026-01-01'});
  const sameRun=normalize({status:'AVAILABLE',cny_per_eur:8,source:'RUN_A',as_of:'2026-01-01'});
  const nextRun=normalize({status:'AVAILABLE',cny_per_eur:7.2,source:'RUN_B',as_of:'2026-02-01'});
  assert.deepEqual(display(first),display(sameRun));
  assert.equal(display(nextRun).rate,'当前汇率：1 EUR = 7.2 CNY');
  assert.notEqual(display(nextRun).source,display(first).source);
});
