import { createHash, randomUUID } from 'node:crypto';

export function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function stableId(prefix, ...parts) {
  const digest = createHash('sha256').update(parts.map(value => String(value ?? '')).join('\u001f')).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

export function extractGoodsId(value) {
  const text = String(value ?? '');
  try {
    const goodsId = new URL(text).searchParams.get('goods_id');
    if (goodsId) return goodsId.trim();
  } catch {}
  return text.match(/-g-(\d+)\.html/i)?.[1] ?? text.match(/\bgoods[_-]?id[=:](\d+)\b/i)?.[1] ?? null;
}

export function canonicalProductUrl(goodsId) {
  return `https://www.temu.com/goods.html?goods_id=${encodeURIComponent(String(goodsId))}`;
}
