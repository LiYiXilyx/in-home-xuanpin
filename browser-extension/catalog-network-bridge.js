'use strict';

(() => {
  const SOURCE='temu-network-interceptor',VERSION=1,MAX_PAYLOAD_BYTES=64_000,MAX_PRODUCTS_PER_MESSAGE=20;
  const TYPES=Object.freeze({READY:'TEMU_CATALOG_NETWORK_INTERCEPTOR_READY',DIAGNOSTIC:'TEMU_CATALOG_NETWORK_DIAGNOSTIC',CANDIDATE:'TEMU_CATALOG_NETWORK_CANDIDATE',PRODUCTS:'TEMU_CATALOG_NETWORK_PRODUCTS'});

  function handle(event){try{
    const cache=globalThis.TemuCatalogNetworkCache;
    if(event.source!==window||event.origin!==location.origin||location.protocol!=='https:'||location.hostname!=='www.temu.com')return false;
    const message=event.data;if(!message||typeof message!=='object'||Array.isArray(message)||message.source!==SOURCE)return false;
    if(message.version!==VERSION){cache?.noteBridgeReject?.('schema','version');return false;}
    if(typeof message.type!=='string'||typeof message.message_id!=='string'||typeof message.nonce!=='string'||!message.payload||typeof message.payload!=='object'||Array.isArray(message.payload)){cache?.noteBridgeReject?.('schema','envelope');return false;}
    if(message.type===TYPES.READY){cache?.markInterceptorReady?.(message.payload,message);return Boolean(cache);}
    cache?.noteNonceReceived?.(message.nonce);const expected=cache?.metrics?.bridgeNonceExpected;
    if(!expected||message.nonce!==expected){cache?.noteBridgeReject?.('nonce','nonce_mismatch');return false;}
    if(message.type===TYPES.DIAGNOSTIC)return Boolean(cache?.observeRequestMetadata?.(message.payload));
    if(message.type===TYPES.CANDIDATE)return Boolean(cache?.observeCandidate?.(message.payload));
    if(message.type!==TYPES.PRODUCTS){cache?.noteBridgeReject?.('unknown','unknown_type');return false;}
    const bytes=utf8Bytes(JSON.stringify(message));cache?.noteProductsMessage?.(message.payload,bytes);
    if(bytes>MAX_PAYLOAD_BYTES){cache?.noteBridgeReject?.('payload','payload_bytes');return false;}
    const payload=message.payload,products=payload.products;
    const endpointDiagnostic=diagnosePayloadEndpoint(payload.endpoint);
    if(endpointDiagnostic.normalized_endpoint!=='/api/poppy/v1/opt'){cache?.noteEndpointReject?.(endpointDiagnostic);cache?.noteBridgeReject?.('schema','endpoint');return false;}
    if(typeof payload.observed_at!=='string'){cache?.noteBridgeReject?.('schema','observed_at');return false;}
    if(!Array.isArray(products)||products.length<1||products.length>MAX_PRODUCTS_PER_MESSAGE){cache?.noteBridgeReject?.('schema','products_shape');return false;}
    const parser=globalThis.TemuCatalogNetworkParser;if(typeof parser?.analyzeProductRecords!=='function'){cache?.noteParseError?.({reason:'parser_unavailable',input_count:products.length});cache?.noteBridgeReject?.('schema','parser_unavailable');return false;}
    let analysis;try{analysis=parser.analyzeProductRecords(products,{endpoint:payload.endpoint,base:location.href});}catch{cache?.noteParseError?.({reason:'parser_exception',input_count:products.length});return false;}
    const normalized=analysis.records;if(analysis.invalid.length){cache?.noteParseError?.({reason:'invalid_goods_id',input_count:products.length,normalized_count:normalized.length,invalid:analysis.invalid});}
    if(normalized.length<1){cache?.noteBridgeReject?.('schema','goods_id');return false;}
    cache?.noteParseSuccess?.();
    cache.observe({endpoint:'/api/poppy/v1/opt',observedAt:payload.observed_at,products:normalized});return true;
  }catch{globalThis.TemuCatalogNetworkCache?.noteBridgeReject?.('schema','exception');return false;}}

  function normalizePayloadEndpoint(value){
    if(typeof value!=='string'||!value)return null;
    const raw=value.trim();if(!raw)return null;
    let url;
    try {
      if(/^\/(?!\/)/.test(raw))url=new URL(raw,'https://www.temu.com/');
      else {url=new URL(raw);if(url.protocol!=='https:'||url.hostname!=='www.temu.com')return null;}
    } catch {return null;}
    const path=String(url.pathname??'').replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/api\/)/i,'').replace(/\/+$/,'');
    return path||'/';
  }
  function diagnosePayloadEndpoint(value){const raw=typeof value==='string'?value:String(value??'');let url=null;try{url=new URL(raw,location.origin);}catch{}const safeSearch=url?redactedSearch(url.searchParams):'';const rawUrl=url?`${url.protocol}//${url.hostname}${url.pathname}${safeSearch}`:raw.slice(0,1000);return {raw_endpoint:safeEndpoint(raw),raw_url:rawUrl,hostname:url?.hostname??'',pathname:url?.pathname??'',search:safeSearch,normalized_endpoint:normalizePayloadEndpoint(value),expected_endpoint:'/api/poppy/v1/opt'};}
  function safeEndpoint(value){try{const url=new URL(value,location.origin);return `${url.pathname}${redactedSearch(url.searchParams)}`;}catch{return String(value??'').slice(0,1000);}}
  function redactedSearch(params){const keys=[...new Set([...params.keys()])].slice(0,50);return keys.length?`?${keys.map(key=>`${encodeURIComponent(key)}=<redacted>`).join('&')}`:'';}
  function utf8Bytes(value){return typeof TextEncoder==='function'?new TextEncoder().encode(value).byteLength:String(value).length;}

  window.addEventListener('message',handle,false);globalThis.TemuCatalogNetworkBridge=Object.freeze({handle,normalizePayloadEndpoint,diagnosePayloadEndpoint,TYPES,SOURCE,VERSION,MAX_PAYLOAD_BYTES,MAX_PRODUCTS_PER_MESSAGE});
})();
