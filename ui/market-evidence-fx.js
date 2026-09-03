const isPositiveFinite=value=>Number.isFinite(Number(value))&&Number(value)>0;
const round=(value,digits)=>Number(Number(value).toFixed(digits));

export function normalizeFxContext(rawFx) {
  if(!rawFx||rawFx.status!=='AVAILABLE') return {status:'MISSING',cnyPerEur:null,eurPerCny:null,source:null,asOf:null,originalPair:null,originalRate:null};
  const hasCny=rawFx.cny_per_eur!==null&&rawFx.cny_per_eur!==undefined;
  const hasEur=rawFx.eur_per_cny!==null&&rawFx.eur_per_cny!==undefined;
  const meta={source:rawFx.source??null,asOf:rawFx.as_of??null};
  if(hasCny&&!isPositiveFinite(rawFx.cny_per_eur)) return {status:'FX_INVALID',cnyPerEur:null,eurPerCny:null,...meta,originalPair:'CNY_PER_EUR',originalRate:rawFx.cny_per_eur};
  if(!hasCny&&hasEur&&!isPositiveFinite(rawFx.eur_per_cny)) return {status:'FX_INVALID',cnyPerEur:null,eurPerCny:null,...meta,originalPair:'EUR_PER_CNY',originalRate:rawFx.eur_per_cny};
  if(!hasCny&&!hasEur) return {status:'MISSING',cnyPerEur:null,eurPerCny:null,...meta,originalPair:null,originalRate:null};
  const cnyPerEur=hasCny?Number(rawFx.cny_per_eur):1/Number(rawFx.eur_per_cny);
  if(!isPositiveFinite(cnyPerEur)) return {status:'FX_INVALID',cnyPerEur:null,eurPerCny:null,...meta,originalPair:hasCny?'CNY_PER_EUR':'EUR_PER_CNY',originalRate:hasCny?rawFx.cny_per_eur:rawFx.eur_per_cny};
  return {status:'AVAILABLE',cnyPerEur,eurPerCny:hasEur?Number(rawFx.eur_per_cny):1/cnyPerEur,...meta,originalPair:hasCny?'CNY_PER_EUR':'EUR_PER_CNY',originalRate:hasCny?Number(rawFx.cny_per_eur):Number(rawFx.eur_per_cny)};
}

export function calculateMarketEvidenceRatio({fx,temuPriceEur,temuPackQuantity,supplierPriceCny,supplierPackQuantity}) {
  const unavailable={fx,supplierUnitPriceEur:null,priceRatio:null};
  if(fx?.status!=='AVAILABLE'||!isPositiveFinite(fx.cnyPerEur)||![temuPriceEur,temuPackQuantity,supplierPriceCny,supplierPackQuantity].every(isPositiveFinite)) return unavailable;
  const supplierUnitPriceEur=Number(supplierPriceCny)/Number(supplierPackQuantity)/fx.cnyPerEur;
  const priceRatio=(Number(temuPriceEur)/Number(temuPackQuantity))/supplierUnitPriceEur;
  return {fx,supplierUnitPriceEur:round(supplierUnitPriceEur,2),priceRatio:round(priceRatio,2)};
}

const displaySource=source=>source==='MANUAL_CONFIG'?'手工配置':source;
const formatRate=value=>Number(value.toFixed(4)).toString();

export function marketEvidenceFxDisplay(fx) {
  const common={source:`来源：${fx?.source?displaySource(fx.source):'未注明'}`,asOf:fx?.asOf?`更新日期：${fx.asOf}`:'日期：未记录'};
  if(fx?.status==='FX_INVALID') return {status:'FX_INVALID',rate:'汇率配置无效，请检查Sourcing配置。',...common};
  if(fx?.status!=='AVAILABLE') return {status:'MISSING',rate:'汇率未配置',...common};
  return {status:'AVAILABLE',rate:`当前汇率：1 EUR = ${formatRate(fx.cnyPerEur)} CNY`,...common};
}
