import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION_METHODS,findMatchingCard,resolveFreshNavigation,verifyFreshDetail } from '../../src/modules/reviews/fresh-navigation-resolver.mjs';

const goodsId='601099520926372';
const historical=`https://www.temu.com/de-en/old-context-g-${goodsId}.html?refer_page_name=goods`;
const fresh=`https://www.temu.com/de-en/fresh-card-g-${goodsId}.html?refer_page_name=category`;

test('historical sold-out context is rejected while matching fresh card detail is verified',() => {
  const stale=verifyFreshDetail({ goodsId,freshUrl:historical,detailUrl:historical,detailText:'This item is sold out.' });
  assert.deepEqual(stale,{ detailVerified:false,errorCode:'STALE_OR_CONTEXT_BOUND_URL',detailUrl:historical });
  const available=verifyFreshDetail({ goodsId,freshUrl:fresh,detailUrl:fresh,detailText:'Add to cart Customer reviews' });
  assert.equal(available.detailVerified,true);
  assert.equal(available.errorCode,'FRESH_DETAIL_VERIFIED');
});

test('current category card has priority and wrong cards are rejected',() => {
  assert.equal(findMatchingCard([`https://www.temu.com/de-en/wrong-g-999.html`],goodsId),null);
  const result=resolveFreshNavigation({ goodsId,currentCategoryCards:[
    { href:'https://www.temu.com/de-en/wrong-g-999.html' },{ href:fresh,sourcePageUrl:'https://www.temu.com/de-en/category.html' }
  ],siteSearchCards:[`https://www.temu.com/de-en/search-hit-g-${goodsId}.html`] });
  assert.equal(result.resolutionMethod,NAVIGATION_METHODS.CURRENT_CATEGORY_CARD);
  assert.equal(result.freshUrl,fresh);
});

test('site search is fallback and unresolved navigation does not promote historical URL',() => {
  const search=`https://www.temu.com/de-en/search-hit-g-${goodsId}.html`;
  const resolved=resolveFreshNavigation({ goodsId,currentCategoryCards:[],siteSearchCards:[search],historicalSourceUrl:historical });
  assert.equal(resolved.resolutionMethod,NAVIGATION_METHODS.SITE_SEARCH_CARD);
  assert.equal(resolved.freshUrl,search);
  const unresolved=resolveFreshNavigation({ goodsId,currentCategoryCards:[],siteSearchCards:[],historicalSourceUrl:historical });
  assert.equal(unresolved.freshUrl,null);
  assert.equal(unresolved.errorCode,'NAVIGATION_NOT_RESOLVED');
  const explicitFallback=resolveFreshNavigation({ goodsId,historicalSourceUrl:historical,allowFallback:true });
  assert.equal(explicitFallback.resolutionMethod,NAVIGATION_METHODS.HISTORICAL_SOURCE_FALLBACK);
});

test('wrong detail goods_id is a navigation context mismatch',() => {
  const result=verifyFreshDetail({ goodsId,freshUrl:fresh,detailUrl:'https://www.temu.com/de-en/wrong-g-123.html',detailText:'Add to cart' });
  assert.equal(result.detailVerified,false);
  assert.equal(result.errorCode,'NAVIGATION_CONTEXT_MISMATCH');
});
