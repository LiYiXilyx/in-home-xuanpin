import crypto from 'node:crypto';

export function fineClassificationInput(product) {
  return {
    goods_id:String(product.goodsId),title:String(product.title ?? ''),current_category:String(product.categoryLabel ?? ''),
    rule_evidence:product.ruleEvidence ?? [],image_metadata:product.imageSha256 ? { sha256:product.imageSha256 } : null
  };
}

export function hashFineClassificationInput(input) {
  return crypto.createHash('sha256').update(stableStringify(input)).digest('hex');
}

export function hashFineClassifierResponse(raw) {
  return crypto.createHash('sha256').update(typeof raw === 'string' ? raw : stableStringify(raw)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
