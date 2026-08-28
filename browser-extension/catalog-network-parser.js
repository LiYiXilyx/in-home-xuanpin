'use strict';

(() => {
  const LIMITS=Object.freeze({maxDepth:6,maxArrayLength:300,maxObjects:2500});
  function parseNetworkResponse({url,body}) {
    if(!globalThis.TemuCatalogNetworkEndpoints?.isCatalogProductEndpoint(url))return [];
    const path=globalThis.TemuCatalogNetworkEndpoints.normalizeTemuApiPath(new URL(url).pathname).toLowerCase();let candidates=[];
    if(path.includes('/search'))candidates=pick(body,['result.data.goods_list','result.data.goodsList','data.goods_list','data.goodsList','goods_list','goodsList']);
    else if(path==='/api/poppy/v1/opt'||path.startsWith('/api/poppy/v1/opt/'))return parsePoppyOptResponse(body);
    else if(path.includes('/goods_list')||path.includes('/query_goods'))candidates=pick(body,['result.goods_list','result.goodsList','data.goods_list','data.goodsList','goods_list','goodsList']);
    else if(path.includes('/goods_detail'))candidates=pick(body,['result.goods','result.data.goods','data.goods','goods']);
    const records=[];for(const value of candidates)collectDirect(value,records);
    if(!records.length)boundedGenericExtractor(body,records,LIMITS);
    return [...new Map(records.map(record=>[record.goods_id,record])).values()];
  }
  function parsePoppyOptResponse(body){const list=body?.result?.data?.goods_list;if(!Array.isArray(list))return [];const records=[];collectDirect(list,records);return [...new Map(records.map(record=>[record.goods_id,record])).values()];}
  function normalizeProduct(value) {
    if(!plainObject(value))return null;const goodsId=text(value.goods_id??value.goodsId);if(!/^\d+$/.test(goodsId??''))return null;
    const price=number(first(value.price_amount,value.priceAmount,value.sale_price,value.salePrice,value.price?.amount,value.price?.value));
    return {goods_id:goodsId,title:text(first(value.title,value.goods_name,value.goodsName,value.name)),image_url:text(first(value.image_url,value.imageUrl,value.thumb_url,value.thumbUrl,value.image?.url)),
      price_amount:validNonNegative(price),currency:currency(first(value.currency,value.currency_code,value.currencyCode,value.price?.currency)),
      sales_count:validNonNegative(number(first(value.sales_count,value.salesCount,value.sold_count,value.soldCount,value.sales))),rating:rating(first(value.rating,value.star,value.score)),
      review_count:validNonNegative(number(first(value.review_count,value.reviewCount,value.comment_count,value.commentCount,value.rating_count,value.ratingCount))),
      raw_network:{original_price:first(value.original_price,value.originalPrice)??null,badge:first(value.badge,value.badges)??null,store:first(value.store,value.mall,value.shop)??null,tags:value.tags??null}};
  }
  function boundedGenericExtractor(root,out=[],limits=LIMITS){const seen=new Set(),stack=[{value:root,depth:0}];let objects=0;while(stack.length&&objects<limits.maxObjects){const {value,depth}=stack.pop();if(!value||typeof value!=='object'||seen.has(value)||depth>limits.maxDepth)continue;seen.add(value);objects++;const normalized=normalizeProduct(value);if(normalized)out.push(normalized);if(Array.isArray(value)){for(let i=Math.min(value.length,limits.maxArrayLength)-1;i>=0;i--)stack.push({value:value[i],depth:depth+1});}else for(const child of Object.values(value))if(child&&typeof child==='object')stack.push({value:child,depth:depth+1});}return out;}
  function pick(root,paths){const values=[];for(const path of paths){let value=root;for(const key of path.split('.'))value=value?.[key];if(value!==undefined&&value!==null)values.push(value);}return values;}
  function collectDirect(value,out){if(Array.isArray(value))for(const item of value){const normalized=normalizeProduct(item);if(normalized)out.push(normalized);}else{const normalized=normalizeProduct(value);if(normalized)out.push(normalized);}}
  function plainObject(v){return Boolean(v)&&typeof v==='object'&&!Array.isArray(v);}
  function first(...v){return v.find(x=>x!==undefined&&x!==null&&x!=='');}
  function text(v){const x=String(v??'').replace(/\s+/g,' ').trim();return x||null;}
  function number(v){if(v===null||v===undefined||v==='')return null;const n=Number(String(v).replace(/[^\d.-]/g,''));return Number.isFinite(n)?n:null;}
  function validNonNegative(v){return Number.isFinite(v)&&v>=0?v:null;}
  function rating(v){const n=number(v);return Number.isFinite(n)&&n>=0&&n<=5?n:null;}
  function currency(v){const x=text(v)?.toUpperCase();return x&&/^[A-Z]{3}$/.test(x)?x:null;}
  globalThis.TemuCatalogNetworkParser=Object.freeze({parseNetworkResponse,parsePoppyOptResponse,normalizeProduct,boundedGenericExtractor,LIMITS});
})();
