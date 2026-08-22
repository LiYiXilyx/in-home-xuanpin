import crypto from 'node:crypto';
import { cleanTemuReviewText,parseRating,parseReviewDate } from '../../parsers.mjs';
import { extractGoodsId } from '../../shared/ids.mjs';

export function parseReviewCard(card,{ productId,goodsId,sourceUrl,capturedAt=new Date().toISOString(),now=new Date() }) {
  const reviewDate=parseReviewDate(card.dateText || card.rawText,now);
  const rating=parseRating(card.ratingText);
  const content=cleanTemuReviewText(card.contentText || card.rawText);
  const reviewId=normalizeReviewId(card.reviewId);
  const imageUrls=uniqueHttpUrls(card.imageUrls);
  const contentFingerprint=createContentFingerprint(content);
  const errors=[];
  if (!reviewDate) errors.push('INVALID_REVIEW_DATE');
  if (!(rating >= 1 && rating <= 5)) errors.push('INVALID_RATING');
  if (!content && !reviewId) errors.push('EMPTY_REVIEW_WITHOUT_ID');
  if (String(goodsId) !== extractGoodsId(sourceUrl)) errors.push('SOURCE_GOODS_ID_MISMATCH');
  if (errors.length) return { valid:false,errors,review:null };
  const fallback=`${reviewDate}|${rating}|${contentFingerprint}`;
  return { valid:true,errors:[],review:{
    reviewId,productId:Number(productId),goodsId:String(goodsId),rating,content,reviewDate,
    sku:String(card.sku ?? '').trim() || null,country:String(card.country ?? '').trim() || null,
    hasImage:imageUrls.length > 0,imageUrls,sourceUrl,capturedAt,contentFingerprint,
    dedupeKey:reviewId ? `id:${reviewId}`:`fp:${fallback}`,
    fallbackKey:fallback,raw:{ dateText:card.dateText ?? null,ratingText:card.ratingText ?? null,rawText:card.rawText ?? null }
  }};
}

export function createContentFingerprint(content) {
  const normalized=String(content ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function verifyProductIdentity({ expectedGoodsId,currentUrl,canonicalUrl }) {
  const candidates=[extractGoodsId(currentUrl),extractGoodsId(canonicalUrl)].filter(Boolean);
  const actualGoodsId=candidates[0] ?? null;
  return { valid:actualGoodsId === String(expectedGoodsId),expectedGoodsId:String(expectedGoodsId),actualGoodsId };
}

export function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}

function normalizeReviewId(value) { const text=String(value ?? '').trim();return text && !/^(?:review|comment)[-_]?item$/i.test(text) ? text:null; }
function uniqueHttpUrls(values=[]) { return [...new Set(values.filter(value => { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } }))]; }
