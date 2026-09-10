export function calculateManualPriceAssessment(input={}) {
  const temuPrice=positive(input.temuPriceEur,'TEMU_PRICE_REQUIRED');
  const temuPack=positive(input.temuPackQuantity,'PACK_QUANTITY_REQUIRED');
  const supplierPrice=positive(input.supplierPriceCny,'SUPPLIER_PRICE_REQUIRED');
  const supplierPack=positive(input.supplierPackQuantity,'PACK_QUANTITY_REQUIRED');
  if(input.fx?.status!=='AVAILABLE'||!positiveOrNull(input.fx.cny_per_eur)) throw coded('FX_RATE_REQUIRED','需要有效的 CNY/EUR 汇率');
  const cnyPerEur=Number(input.fx.cny_per_eur),temuUnit=round(temuPrice/temuPack,6);
  const supplierUnitCny=round(supplierPrice/supplierPack,6),supplierUnitEur=round(supplierUnitCny/cnyPerEur,6);
  return {temu_price_eur:temuPrice,temu_pack_quantity:temuPack,temu_unit_price_eur:temuUnit,
    supplier_price_cny:supplierPrice,supplier_pack_quantity:supplierPack,supplier_unit_price_cny:supplierUnitCny,
    supplier_unit_price_eur:supplierUnitEur,moq:nonNegativeOrNull(input.moq),fx_cny_per_eur:cnyPerEur,
    fx_source:String(input.fx.source),fx_as_of:String(input.fx.as_of),price_ratio:round(temuUnit/supplierUnitEur,2),
    formula_version:'MANUAL_PRICE_RATIO_V1',status:'READY'};
}

function positive(value,code){const n=positiveOrNull(value);if(n===null)throw coded(code,'价格和包装数量必须为正数');return n;}
function positiveOrNull(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
function nonNegativeOrNull(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0)throw coded('MOQ_INVALID','MOQ 必须是非负数');return n;}
function round(value,digits){const factor=10**digits;return Math.round((value+Number.EPSILON)*factor)/factor;}
function coded(code,message){return Object.assign(new Error(message),{code});}
