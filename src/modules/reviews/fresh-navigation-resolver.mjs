import { AppError } from '../../shared/errors.mjs';
import { extractGoodsId } from '../../shared/ids.mjs';

export const NAVIGATION_METHODS=Object.freeze({
  CURRENT_CATEGORY_CARD:'CURRENT_CATEGORY_CARD',
  SITE_SEARCH_CARD:'SITE_SEARCH_CARD',
  HISTORICAL_SOURCE_FALLBACK:'HISTORICAL_SOURCE_FALLBACK',
  CANONICAL_FALLBACK:'CANONICAL_FALLBACK'
});

export function resolveFreshNavigation({ goodsId,currentCategoryCards=[],siteSearchCards=[],historicalSourceUrl=null,
  canonicalUrl=null,sourcePageUrl=null,allowFallback=false }={}) {
  const target=normalizeGoodsId(goodsId);
  const sources=[
    [NAVIGATION_METHODS.CURRENT_CATEGORY_CARD,currentCategoryCards],
    [NAVIGATION_METHODS.SITE_SEARCH_CARD,siteSearchCards]
  ];
  for (const [method,cards] of sources) {
    const match=findMatchingCard(cards,target);
    if (match) return { goodsId:target,freshUrl:match.href,resolutionMethod:method,sourcePageUrl:match.sourcePageUrl ?? sourcePageUrl,errorCode:null };
  }
  if (allowFallback) {
    const fallbacks=[
      [NAVIGATION_METHODS.HISTORICAL_SOURCE_FALLBACK,historicalSourceUrl],
      [NAVIGATION_METHODS.CANONICAL_FALLBACK,canonicalUrl]
    ];
    for (const [method,href] of fallbacks) {
      if (isMatchingTemuUrl(href,target)) return { goodsId:target,freshUrl:new URL(href).href,resolutionMethod:method,sourcePageUrl,errorCode:null };
    }
  }
  return { goodsId:target,freshUrl:null,resolutionMethod:null,sourcePageUrl,errorCode:'NAVIGATION_NOT_RESOLVED' };
}

export function verifyFreshDetail({ goodsId,freshUrl,detailUrl,detailText='' }={}) {
  const target=normalizeGoodsId(goodsId);
  const resolved=normalizeTemuUrl(detailUrl ?? freshUrl);
  if (!resolved || extractGoodsId(resolved) !== target) return { detailVerified:false,errorCode:'NAVIGATION_CONTEXT_MISMATCH',detailUrl:resolved };
  if (/\bthis item is sold out\b|\boops!\s*the items are gone\b/i.test(String(detailText))) {
    return { detailVerified:false,errorCode:'STALE_OR_CONTEXT_BOUND_URL',detailUrl:resolved };
  }
  return { detailVerified:true,errorCode:'FRESH_DETAIL_VERIFIED',detailUrl:resolved };
}

export function findMatchingCard(cards,goodsId) {
  for (const card of Array.isArray(cards) ? cards:[]) {
    const href=typeof card === 'string' ? card:card?.href;
    if (!isMatchingTemuUrl(href,goodsId)) continue;
    return { href:new URL(href).href,sourcePageUrl:typeof card === 'object' ? card.sourcePageUrl ?? null:null };
  }
  return null;
}

function isMatchingTemuUrl(value,goodsId) {
  const url=normalizeTemuUrl(value);
  return Boolean(url) && extractGoodsId(url) === goodsId;
}
function normalizeTemuUrl(value) {
  try {
    const url=new URL(String(value ?? ''));
    return url.protocol === 'https:' && url.hostname === 'www.temu.com' ? url.href:null;
  } catch { return null; }
}
function normalizeGoodsId(value) {
  const result=String(value ?? '').trim();
  if (!/^\d+$/.test(result)) throw new AppError('Fresh Navigation Resolver 需要有效 goods_id。',{ code:'INVALID_GOODS_ID' });
  return result;
}
