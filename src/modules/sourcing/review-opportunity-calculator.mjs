import {normalizeUnitPrice} from './unit-price-normalizer.mjs';

export function resolveReviewFx(config) {
  const value=config?.fx??config;
  const rate=Number(value?.rate);
  if(value?.pair!=='CNY/EUR'||!(rate>0)||!value?.source||!/^\d{4}-\d{2}-\d{2}/.test(String(value?.observedAt??value?.as_of??''))) {
    return {status:'FX_RATE_REQUIRED',cny_per_eur:null,eur_per_cny:null,source:null,as_of:null};
  }
  return {status:'AVAILABLE',cny_per_eur:round(1/rate,6),eur_per_cny:rate,source:String(value.source),as_of:String(value.observedAt??value.as_of)};
}

export function normalizeSupplierCandidate(candidate,fx) {
  const low=positive(candidate.price_min_rmb),high=positive(candidate.price_max_rmb),single=positive(candidate.price_rmb??candidate.supplier_price_rmb);
  let effective=single,basis='LISTED_SINGLE_VALUE',tierAmbiguous=false;
  if(low!==null&&high!==null&&high!==low) { effective=high;basis='RANGE_HIGH_CONSERVATIVE'; }
  else if(effective===null&&low!==null&&high===null) { effective=low;basis='MINIMUM_TIER_PROVISIONAL';tierAmbiguous=true; }
  else if(effective===null&&low!==null) effective=high??low;
  const normalized=normalizeUnitPrice({listedPrice:effective,currency:'CNY',title:candidate['1688_title']??candidate.supplier_title,priceBasis:basis});
  const unitCny=normalized.unit_price;
  const unitEur=fx?.status==='AVAILABLE'&&unitCny!==null?round(unitCny*fx.eur_per_cny,6):null;
  return {
    ...candidate,supplier_listed_price_cny:single??effective,supplier_price_low_cny:low,
    supplier_price_high_cny:high,supplier_effective_price_cny:effective,
    supplier_pack_quantity:normalized.pack_quantity,supplier_unit_price_cny:unitCny,
    supplier_unit_price_eur:unitEur,supplier_quantity_source:normalized.quantity_source,
    supplier_quantity_confidence:normalized.quantity_confidence,supplier_price_basis:basis,
    supplier_normalization_status:normalized.normalization_status,supplier_quantity_evidence:normalized.evidence,
    supplier_price_tier_ambiguous:tierAmbiguous,
  };
}

export function calculateOpportunity({group,candidate,fx}={}) {
  const groupMin=positive(group?.metrics?.group_min_unit_price_eur),supplier=positive(candidate?.supplier_unit_price_eur);
  const ratio=groupMin!==null&&supplier!==null?round(groupMin/supplier,2):null;
  let band=null,reasons=[];
  if(fx?.status!=='AVAILABLE') [band,reasons]=['FX_RATE_REQUIRED',['FX_RATE_REQUIRED']];
  else if(groupMin===null) [band,reasons]=['TEMU_UNIT_PRICE_REQUIRED',['TEMU_UNIT_PRICE_REQUIRED']];
  else if(candidate?.supplier_price_basis==='MINIMUM_TIER_PROVISIONAL'||candidate?.supplier_price_tier_ambiguous) [band,reasons]=['PRICE_TIER_REVIEW_REQUIRED',['PRICE_TIER_REVIEW_REQUIRED']];
  else if(candidate?.supplier_quantity_confidence==='LOW') [band,reasons]=['UNIT_REVIEW_REQUIRED',['SUPPLIER_UNIT_ASSUMED']];
  else if(group?.group_confidence==='LOW') [band,reasons]=['GROUP_REVIEW_REQUIRED',['GROUP_CONFIDENCE_LOW']];
  else if(ratio>30) band='REVIEW_REQUIRED';
  else if(ratio>=10) band='HIGH';
  else if(ratio>=5) band='MEDIUM';
  else band='LOW';
  return {opportunity_ratio:fx?.status==='AVAILABLE'?ratio:null,opportunity_band:band,opportunity_reasons:reasons};
}

function positive(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
function round(value,digits){const factor=10**digits;return Math.round((value+Number.EPSILON)*factor)/factor;}
