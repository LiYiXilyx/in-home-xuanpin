import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors.mjs';

export const CANDIDATE_HASH_VERSION='v1';
export const NORMALIZATION_VERSION='v1';
export const FIELD_SET_VERSION='initial-pool-activation-v1';

const V1_FIELDS=Object.freeze([
  'platform','goods_id','category_key','category_profile_version','title','source_url','canonical_url',
  'image_url','price_amount','currency','sales_count','rating','review_count','listing_rank',
  'electronic_screening_status','business_eligible','reviewable','quality_status','source_id','first_batch_id','raw'
]);
const NON_DETERMINISTIC_KEYS=new Set(['last_seen_at','first_seen_at','captured_at','observed_at','updated_at','created_at']);

export function buildInitialActivationPayload({campaign,source,batchId,product}) {
  return {
    platform:String(product.platform ?? 'temu'),goods_id:String(product.goodsId ?? product.goods_id),
    category_key:campaign.categoryKey,category_profile_version:campaign.categoryProfileVersion,
    title:product.title ?? null,source_url:product.sourceUrl ?? product.source_url ?? null,
    canonical_url:product.canonicalUrl ?? product.canonical_url ?? null,
    image_url:product.imageUrl ?? product.image_url ?? null,
    price_amount:numberOrNull(product.priceAmount ?? product.price_amount),currency:product.currency ?? null,
    sales_count:integerOrNull(product.salesCount ?? product.sales_count),rating:numberOrNull(product.rating),
    review_count:integerOrNull(product.reviewCount ?? product.review_count),
    listing_rank:integerOrNull(product.listingRank ?? product.listing_rank),
    electronic_screening_status:product.electronicScreeningStatus ?? product.electronic_screening_status ?? 'passed',
    business_eligible:booleanOrNull(product.businessEligible ?? product.business_eligible),
    reviewable:booleanOrNull(product.reviewable),quality_status:product.qualityStatus ?? product.quality_status ?? 'pending',
    source_id:source.id,first_batch_id:String(batchId),raw:sanitize(product.raw ?? {})
  };
}

export function hashInitialCandidate(items,{hashVersion=CANDIDATE_HASH_VERSION}={}) {
  if (hashVersion!==CANDIDATE_HASH_VERSION) throw new AppError('不支持的Candidate hash版本。',{
    code:'INITIAL_POOL_HASH_VERSION_UNSUPPORTED',details:{ hashVersion } });
  const rows=items.map(normalizeV1).sort((left,right) =>
    left.platform.localeCompare(right.platform) || left.goods_id.localeCompare(right.goods_id));
  const serialized=canonicalJson({ candidate_hash_version:CANDIDATE_HASH_VERSION,
    normalization_version:NORMALIZATION_VERSION,field_set_version:FIELD_SET_VERSION,items:rows });
  return { hash:createHash('sha256').update(serialized,'utf8').digest('hex'),count:rows.length,rows };
}

export function canonicalJson(value) { return JSON.stringify(stable(value)); }

function normalizeV1(item) {
  const result={};
  for (const field of V1_FIELDS) result[field]=field==='raw' ? sanitize(item[field] ?? {}):normalizeScalar(item[field]);
  return result;
}
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value!=='object') return normalizeScalar(value);
  return Object.fromEntries(Object.keys(value).filter(key=>!NON_DETERMINISTIC_KEYS.has(key)).sort()
    .map(key=>[key,sanitize(value[key])]));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function normalizeScalar(value) { return value===undefined ? null:value; }
function numberOrNull(value) { const number=Number(value);return value===null||value===undefined||!Number.isFinite(number)?null:number; }
function integerOrNull(value) { const number=numberOrNull(value);return number===null?null:Math.trunc(number); }
function booleanOrNull(value) { return value===null||value===undefined?null:Boolean(value); }
