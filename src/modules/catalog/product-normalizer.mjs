import { canonicalProductUrl, extractGoodsId } from '../../shared/ids.mjs';
import { normalizeSpace, parseCompactNumber, parseRating } from '../../parsers.mjs';

const CURRENCY_SYMBOLS = {
  EUR: ['€', 'EUR'], USD: ['$', 'USD'], GBP: ['£', 'GBP'], CAD: ['CA$', 'CAD'], AUD: ['AU$', 'AUD']
};

export function canonicalizeProductUrl(value) {
  const goodsId = extractGoodsId(value);
  return goodsId ? canonicalProductUrl(goodsId) : null;
}

export function parsePriceAmount(value, currency = 'EUR') {
  const text = normalizeSpace(value);
  if (!text) return null;
  const tokens = CURRENCY_SYMBOLS[String(currency).toUpperCase()] ?? [String(currency)];
  const tokenPattern = tokens.map(escapeRegex).join('|');
  const before = text.match(new RegExp(`(?:${tokenPattern})\\s*(\\d{1,7}(?:[.,]\\d{1,2})?)`, 'i'));
  const after = text.match(new RegExp(`(\\d{1,7}(?:[.,]\\d{1,2})?)\\s*(?:${tokenPattern})`, 'i'));
  const raw = before?.[1] ?? after?.[1];
  if (!raw) return null;
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

export function parseSalesCount(value) {
  const text = normalizeSpace(value);
  const match = text.match(/\d+(?:[.,]\d+)?\s*[kKmM]?\+?\s*(?:sold|sales|sold out)(?![A-Za-z])/i);
  return match ? parseCompactNumber(match[0]) : null;
}

export function parseReviewCount(value) {
  const text = normalizeSpace(value);
  const match = text.match(/\(?\s*(\d+(?:[.,]\d+)?\s*[kKmM]?)\s*\)?\s*(?:reviews?|ratings?)(?![A-Za-z])/i)
    ?? text.match(/(?:reviews?|ratings?)\s*[:：]?\s*\(?\s*(\d+(?:[.,]\d+)?\s*[kKmM]?)\s*\)?/i);
  return match ? parseCompactNumber(match[1]) : null;
}

export function normalizeProduct(raw, context = {}) {
  const goodsId = extractGoodsId(raw.href) ?? extractGoodsId(raw.goodsIdCandidate);
  if (!goodsId) return null;
  const cardText = normalizeSpace(raw.cardText);
  const labels = normalizeSpace((raw.visibleLabels ?? []).join(' '));
  const combined = `${cardText} ${labels}`.trim();
  const title = firstUsefulTitle(raw.titleCandidates, goodsId);
  const imageUrl = firstHttpUrl(raw.imageCandidates?.map(item => typeof item === 'string' ? item : item?.url));
  const priceAmount = parsePriceAmount(raw.priceText || combined, context.currency);
  const salesCount = parseSalesCount(raw.salesText || combined);
  const rating = parseRating(findRatingText(raw.ratingText || '') || findRatingText(combined));
  const reviewCount = parseReviewCount(raw.reviewText || combined);
  const product = {
    goods_id: String(goodsId),
    external_product_id: String(goodsId),
    source_url: sourceProductUrl(raw.href,goodsId),
    canonical_url: canonicalProductUrl(goodsId),
    title,
    image_url: imageUrl,
    price_amount: priceAmount,
    sales_count: salesCount,
    rating,
    review_count: reviewCount,
    listing_rank: context.listingRank ?? null,
    site_country: context.siteCountry ?? null,
    language: context.language ?? null,
    currency: context.currency ?? null,
    primary_category: context.primaryCategory ?? null,
    subcategory: context.subcategory ?? null,
    sort_order: context.sortOrder ?? null,
    captured_at: context.capturedAt ?? new Date().toISOString(),
    extraction_quality: null,
    raw: { href: raw.href ?? null, card_text: cardText || null, visible_labels: raw.visibleLabels ?? [] }
  };
  product.extraction_quality = extractionQuality(product);
  return product;
}

function sourceProductUrl(value,goodsId) {
  try {
    const url=new URL(value);
    if (!['http:','https:'].includes(url.protocol) || !/(^|\.)temu\.com$/i.test(url.hostname)) return null;
    return extractGoodsId(url.toString()) === String(goodsId) ? url.toString():null;
  } catch { return null; }
}

export function extractionQuality(product) {
  const core = ['goods_id', 'canonical_url', 'title', 'image_url', 'price_amount', 'sales_count', 'rating', 'review_count'];
  const present = core.filter(field => product[field] !== null && product[field] !== '').length;
  return Number((present / core.length).toFixed(3));
}

function firstUsefulTitle(candidates = [], goodsId) {
  for (const candidate of candidates ?? []) {
    const title = normalizeSpace(candidate)
      .replace(/^item picture\s*/i, '')
      .replace(/^(?:quick look\s*)?(?:top pick\s*)?/i, '')
      .replace(/\s*open in new tab\.?\s*$/i, '');
    if (title && title !== goodsId && !/^(?:€|EUR|\$|USD)\s*\d/i.test(title)) return title;
  }
  return null;
}
function firstHttpUrl(values = []) {
  for (const value of values ?? []) {
    try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol)) return url.toString(); } catch {}
  }
  return null;
}
function findRatingText(text) {
  return text.match(/[1-5](?:[.,]\d)?\s*(?:out of (?:5|five)(?: stars?)?|stars?|rating)(?![A-Za-z])/i)?.[0]
    ?? text.match(/(?:rating|rated)\s*[:：]?\s*[1-5](?:[.,]\d)?/i)?.[0] ?? '';
}
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
