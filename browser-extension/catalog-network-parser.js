'use strict';

(() => {
  const NETWORK_RUNTIME_VERSION='track-a-runtime-v2',IDENTITY_CONTRACT_VERSION='track-a-id-v2',PARSER_ENDPOINT_GATE_VERSION='track-a-parser-endpoint-v3';
  const GOODS_ID_MIN_LENGTH=1,GOODS_ID_MAX_LENGTH=16;
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
  function parseProductRecords(products,options={}){
    if(!endpointStage(options).allowed)return [];
    if(!Array.isArray(products)||products.length>LIMITS.maxArrayLength)throw new Error('NETWORK_PRODUCT_BATCH_LIMIT');
    const records=[];collectDirect(products,records);return records;
  }
  function analyzeProductRecords(products,options={}){
    const inputCount=Array.isArray(products)?products.length:0,endpoint=endpointStage(options);
    if(!endpoint.allowed)return analysisResult([],[],'endpoint_rejected','endpoint_gate',inputCount,endpoint,false);
    if(!Array.isArray(products)||products.length>LIMITS.maxArrayLength)throw new Error('NETWORK_PRODUCT_BATCH_LIMIT');
    const records=[];collectDirect(products,records);const invalid=[];for(let index=0;index<products.length;index++){const value=products[index],raw=value?.goods_id??value?.goodsId,id=normalizeGoodsId(raw);if(!id)invalid.push(identityDiagnostic(raw,index));}
    const status=records.length?'ok':invalid.length?'identity_rejected':'collection_empty',stage=records.length?'complete':invalid.length?'identity_normalization':'product_collection';return analysisResult(records,invalid,status,stage,inputCount,endpoint,true);
  }
  function normalizeProduct(value) {
    if(!plainObject(value))return null;const goodsId=normalizeGoodsId(value.goods_id??value.goodsId);if(!goodsId)return null;
    const price=number(first(value.price_amount,value.priceAmount,value.sale_price,value.salePrice,value.price?.amount,value.price?.value));
    return {goods_id:goodsId,title:stringValue(first(value.title,value.goods_name,value.goodsName,value.name)),image_url:stringValue(first(value.image_url,value.imageUrl,value.thumb_url,value.thumbUrl,value.image?.url)),
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
  function stringValue(v){return typeof v==='string'?text(v):null;}
  function number(v){if(v===null||v===undefined||v==='')return null;const raw=String(v).replace(/[^\d.-]/g,'');if(!/\d/.test(raw))return null;const n=Number(raw);return Number.isFinite(n)?n:null;}
  function validNonNegative(v){return Number.isFinite(v)&&v>=0?v:null;}
  function rating(v){const n=number(v);return Number.isFinite(n)&&n>=0&&n<=5?n:null;}
  function currency(v){const x=stringValue(v)?.toUpperCase();return x&&/^[A-Z]{3}$/.test(x)?x:null;}
  function normalizeGoodsId(value){if(value===null||value===undefined)return null;const id=String(value).trim();return id.length>=GOODS_ID_MIN_LENGTH&&id.length<=GOODS_ID_MAX_LENGTH&&/^\d+$/.test(id)?id:null;}
  function identityDiagnostic(value,index){const string=value===null||value===undefined?'':String(value),trimmed=string.trim();return {index,type:value===null?'null':typeof value,length:trimmed.length,digit_only:/^\d+$/.test(trimmed),prefix:trimmed.slice(0,4),suffix:trimmed.slice(-4)};}
  function endpointStage({endpoint='/api/poppy/v1/opt',base='https://www.temu.com/',bridgeEndpointNormalized=null}={}){const helper=globalThis.TemuCatalogNetworkEndpoints,available=typeof helper?.isCatalogProductEndpoint==='function',normalized=normalizeEndpoint(endpoint,base,helper),bridgeAllowed=bridgeEndpointNormalized==='/api/poppy/v1/opt'&&normalized==='/api/poppy/v1/opt',helperAllowed=available&&helper.isCatalogProductEndpoint(endpoint,base);return {raw:safeEndpoint(endpoint,base),type:typeof endpoint,base:safeBase(base),normalized,allowed:Boolean(bridgeAllowed||helperAllowed),helperAvailable:available,source:bridgeAllowed?'bridge':helperAllowed?'helper':'none'};}
  function normalizeEndpoint(value,base,helper){try{const url=new URL(String(value),String(base));if(url.protocol!=='https:'||url.hostname!=='www.temu.com')return null;const path=typeof helper?.normalizeTemuApiPath==='function'?helper.normalizeTemuApiPath(url.pathname):String(url.pathname).replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/api\/)/i,'');return path.replace(/\/+$/,'')||'/';}catch{return null;}}
  function safeEndpoint(value,base){try{const url=new URL(String(value),String(base));return `${url.pathname}${redactedSearch(url.searchParams)}`;}catch{return String(value??'').slice(0,300);}}
  function safeBase(value){try{const url=new URL(String(value));return `${url.protocol}//${url.hostname}${url.pathname}`;}catch{return '';}}
  function redactedSearch(params){const keys=[...new Set([...params.keys()])].slice(0,20);return keys.length?`?${keys.map(key=>`${encodeURIComponent(key)}=<redacted>`).join('&')}`:'';}
  function analysisResult(records,invalid,status,stage,inputCount,endpoint,collectAttempted){return {records,invalid,status,stage,diagnostics:{parser_endpoint_gate_version:PARSER_ENDPOINT_GATE_VERSION,parser_stage:stage,parser_status:status,parser_input_count:inputCount,parser_endpoint_raw:endpoint.raw,parser_endpoint_type:endpoint.type,parser_base:endpoint.base,parser_endpoint_normalized:endpoint.normalized,parser_endpoint_allowed:endpoint.allowed,parser_endpoint_helper_available:endpoint.helperAvailable,parser_endpoint_validation_source:endpoint.source,parser_collect_attempted:collectAttempted,parser_records_count:records.length,parser_invalid_identity_count:invalid.length}};}
  globalThis.TemuCatalogNetworkParser=Object.freeze({NETWORK_RUNTIME_VERSION,IDENTITY_CONTRACT_VERSION,PARSER_ENDPOINT_GATE_VERSION,GOODS_ID_MIN_LENGTH,GOODS_ID_MAX_LENGTH,parseNetworkResponse,parsePoppyOptResponse,parseProductRecords,analyzeProductRecords,normalizeProduct,normalizeGoodsId,identityDiagnostic,boundedGenericExtractor,LIMITS});
})();
