'use strict';

(() => {
  const SOURCE='temu-network-interceptor',VERSION=1,MARK='__temuCatalogNetworkInterceptorV1';
  const TYPES=Object.freeze({READY:'TEMU_CATALOG_NETWORK_INTERCEPTOR_READY',DIAGNOSTIC:'TEMU_CATALOG_NETWORK_DIAGNOSTIC',CANDIDATE:'TEMU_CATALOG_NETWORK_CANDIDATE',PRODUCTS:'TEMU_CATALOG_NETWORK_PRODUCTS'});
  const MAX_CANDIDATE_BYTES=1_000_000,MAX_PRODUCTS_PER_MESSAGE=50,PRODUCT_CHUNK_SIZE=20,MAX_BRIDGE_PAYLOAD_BYTES=64_000;
  let nonce=null,messageSequence=0,mainProductsMessageSent=0,mainProductsSentCount=0;

  function install(target=globalThis.window) {
    if(!target||target[MARK])return false;
    const matcher=target.TemuCatalogNetworkEndpoints?.isCatalogProductEndpoint;
    if(typeof matcher!=='function')return false;
    nonce=createNonce(target);Object.defineProperty(target,MARK,{value:true,configurable:false});
    const timing={installedAt:Number(target.performance?.now?.()??0),documentReadyState:String(target.document?.readyState??'unknown'),timeOrigin:Number(target.performance?.timeOrigin??0),networkRuntimeVersion:String(target.TemuCatalogNetworkEndpoints?.NETWORK_RUNTIME_VERSION??''),identityContractVersion:String(target.TemuCatalogNetworkEndpoints?.IDENTITY_CONTRACT_VERSION??'')};
    Object.defineProperty(target,'__TEMU_INTERCEPTOR_INSTALLED_AT__',{value:timing.installedAt,configurable:false});
    const originalFetch=target.fetch;
    if(typeof originalFetch==='function')target.fetch=function(...args){const result=originalFetch.apply(this,args);Promise.resolve(result).then(response=>observeFetch(target,response,args[0],args[1],matcher)).catch(()=>{});return result;};
    const XHR=target.XMLHttpRequest;
    if(XHR?.prototype){const originalOpen=XHR.prototype.open,originalSend=XHR.prototype.send;
      XHR.prototype.open=function(method,url,...rest){this.__temuCatalogObservedUrl=safeUrl(url,target.location?.href);this.__temuCatalogObservedMethod=String(method??'GET').toUpperCase();return originalOpen.call(this,method,url,...rest);};
      XHR.prototype.send=function(...args){this.addEventListener('loadend',()=>observeXhr(target,this,matcher),{once:true});return originalSend.apply(this,args);};
    }
    target.setTimeout?.(()=>sendEnvelope(target,TYPES.READY,timing),0);
    return true;
  }

  async function observeFetch(target,response,input,init,matcher){
    const url=safeUrl(response?.url||requestUrl(input),target.location?.href),contentType=String(response?.headers?.get?.('content-type')??''),allowlistMatched=matcher(url,target.location?.href),mode=target.TemuCatalogNetworkEndpoints?.captureMode?.(url,target.location?.href);
    postDiagnostic(target,{transport:'FETCH',method:requestMethod(input,init),url,status:Number(response?.status??0),contentType,allowlistMatched});
    if(!allowlistMatched||!/json/i.test(contentType)||!mode)return;
    const inspected=await readCandidateFetch(response);if(!inspected)return;
    postCandidate(target,url,Number(response.status),contentType,inspected);
    sendProducts(target,{endpoint:target.TemuCatalogNetworkEndpoints.normalizeTemuApiPath(new URL(url).pathname),observedAt:new Date().toISOString(),products:parseAllowedProducts(target,url,inspected.body)});
  }

  function observeXhr(target,xhr,matcher){try{
    const url=safeUrl(xhr.responseURL||xhr.__temuCatalogObservedUrl,target.location?.href),contentType=String(xhr.getResponseHeader?.('content-type')??''),allowlistMatched=matcher(url,target.location?.href),mode=target.TemuCatalogNetworkEndpoints?.captureMode?.(url,target.location?.href);
    postDiagnostic(target,{transport:'XHR',method:xhr.__temuCatalogObservedMethod??'GET',url,status:Number(xhr.status??0),contentType,allowlistMatched});
    if(!allowlistMatched||(!/json/i.test(contentType)&&xhr.responseType!=='json')||!mode)return;
    const text=xhr.responseType==='json'?JSON.stringify(xhr.response):String(xhr.responseText??'');if(text.length>MAX_CANDIDATE_BYTES)return;
    const body=xhr.responseType==='json'?xhr.response:JSON.parse(text);postCandidate(target,url,Number(xhr.status),contentType,{body,size:text.length});
    sendProducts(target,{endpoint:target.TemuCatalogNetworkEndpoints.normalizeTemuApiPath(new URL(url).pathname),observedAt:new Date().toISOString(),products:parseAllowedProducts(target,url,body)});
  }catch{}}

  function sendProducts(target,{endpoint='/api/poppy/v1/opt',observedAt=new Date().toISOString(),products=[],synthetic=false}={}){
    const rows=projectProducts(products).slice(0,MAX_PRODUCTS_PER_MESSAGE),messages=[];
    for(let offset=0;offset<rows.length;offset+=PRODUCT_CHUNK_SIZE){
      const chunk=rows.slice(offset,offset+PRODUCT_CHUNK_SIZE);mainProductsMessageSent++;mainProductsSentCount+=chunk.length;
      const payload={endpoint:String(endpoint),observed_at:String(observedAt),products:chunk,synthetic:Boolean(synthetic),batch_index:Math.floor(offset/PRODUCT_CHUNK_SIZE),batch_count:Math.ceil(rows.length/PRODUCT_CHUNK_SIZE),main_products_message_sent:mainProductsMessageSent,main_products_sent_count:mainProductsSentCount};
      messages.push(sendEnvelope(target,TYPES.PRODUCTS,payload));
    }
    return messages;
  }

  function sendEnvelope(target,type,payload){
    const plain=safePlain({source:SOURCE,type,version:VERSION,message_id:`msg_${Date.now()}_${++messageSequence}`,nonce,payload});
    const bytes=utf8Bytes(JSON.stringify(plain));if(bytes>MAX_BRIDGE_PAYLOAD_BYTES)return {sent:false,reason:'PAYLOAD_TOO_LARGE',bytes};
    target.postMessage(plain,target.location?.origin??'*');return {sent:true,bytes,message_id:plain.message_id};
  }

  function postDiagnostic(target,{transport,method,url,status,contentType,allowlistMatched}){try{const parsed=new URL(url,target.location?.href),origin=String(target.location?.origin??'');sendEnvelope(target,TYPES.DIAGNOSTIC,{transport,method:String(method??'GET').slice(0,16),pathname:parsed.pathname,status:Number.isInteger(status)?status:0,content_type:String(contentType??'').slice(0,160),timestamp:new Date().toISOString(),same_origin:parsed.origin===origin,temu_domain:parsed.hostname==='temu.com'||parsed.hostname.endsWith('.temu.com'),allowlist_matched:Boolean(allowlistMatched)});}catch{}}
  function postCandidate(target,url,status,contentType,{body,size}){try{const summary=summarizeCandidate(body),parsed=new URL(url,target.location?.href);sendEnvelope(target,TYPES.CANDIDATE,{pathname:parsed.pathname,status,content_type:String(contentType).slice(0,160),response_size:Number(size),top_level_keys:summary.topLevelKeys,candidate_arrays:summary.candidateArrays,candidate_paths:summary.candidatePaths,goods_id_field_names:summary.goodsIdFieldNames,goods_id_fields_detected:summary.goodsIdFields,estimated_product_records:summary.productRecords,object_count:summary.objectCount,array_count:summary.arrayCount,sample_records:summary.sampleRecords,timestamp:new Date().toISOString()});}catch{}}
  async function readCandidateFetch(response){const reader=response?.clone?.().body?.getReader?.();if(!reader)return null;const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_CANDIDATE_BYTES){await reader.cancel();return null;}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return {body:JSON.parse(new TextDecoder().decode(bytes)),size};}catch{return null;}}
  function summarizeCandidate(root){const topLevelKeys=root&&typeof root==='object'&&!Array.isArray(root)?Object.keys(root).slice(0,25):[],stack=[{value:root,depth:0,path:'$'}],seen=new Set(),candidateArrays=[],candidatePaths=[],goodsIdFieldNames=new Set(),sampleRecords=[];let objects=0,arrays=0,goodsIdFields=0,productRecords=0;while(stack.length&&objects<2500){const {value,depth,path}=stack.pop();if(!value||typeof value!=='object'||seen.has(value)||depth>6)continue;seen.add(value);objects++;if(Array.isArray(value)){arrays++;if(value.some(item=>item&&typeof item==='object'&&/^\d+$/.test(String(item.goods_id??item.goodsId??''))))candidateArrays.push({path,length:value.length});for(let i=Math.min(value.length,300)-1;i>=0;i--)stack.push({value:value[i],depth:depth+1,path:`${path}[${i}]`});continue;}const idEntry=Object.entries(value).find(([key,val])=>/goods_?id/i.test(key)&&/^\d+$/.test(String(val??'')));if(idEntry){goodsIdFields++;productRecords++;goodsIdFieldNames.add(idEntry[0]);candidatePaths.push(path);if(sampleRecords.length<10)sampleRecords.push(projectProduct(value));}for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')stack.push({value:child,depth:depth+1,path:`${path}.${key}`});}return {topLevelKeys,candidateArrays:candidateArrays.slice(0,20),candidatePaths:candidatePaths.slice(0,20),goodsIdFieldNames:[...goodsIdFieldNames].slice(0,10),goodsIdFields,productRecords,objectCount:objects,arrayCount:arrays,sampleRecords};}
  function minimalPoppyProducts(body){const list=body?.result?.data?.goods_list;return Array.isArray(list)?projectProducts(list).slice(0,MAX_PRODUCTS_PER_MESSAGE):[];}
  function parseAllowedProducts(target,url,body){const parser=target.TemuCatalogNetworkParser?.parseNetworkResponse;if(typeof parser==='function')return parser({url,body}).slice(0,MAX_PRODUCTS_PER_MESSAGE);return minimalPoppyProducts(body);}
  function projectProducts(products){return Array.isArray(products)?products.map(projectProduct).filter(row=>row.goods_id):[];}
  function projectProduct(value){const normalizeId=globalThis.TemuCatalogNetworkEndpoints?.normalizeGoodsId,id=normalizeId?.(value?.goods_id??value?.goodsId),allowed=['title','goods_name','goodsName','name','image_url','imageUrl','thumb_url','thumbUrl','price_amount','priceAmount','sale_price','salePrice','currency','currency_code','currencyCode','sales_count','salesCount','sold_count','soldCount','rating','star','review_count','reviewCount','comment_count','commentCount'];const raw={};if(id)raw.goods_id=id;for(const key of allowed)if(value?.[key]!==undefined&&value[key]!==null&&typeof value[key]!=='object')raw[key]=String(value[key]).slice(0,300);return raw;}
  function safePlain(value){return JSON.parse(JSON.stringify(value));}
  function createNonce(target){try{return String(target.crypto?.randomUUID?.()??`nonce_${Date.now()}_${Math.random().toString(36).slice(2)}`);}catch{return `nonce_${Date.now()}`;}}
  function utf8Bytes(value){return typeof TextEncoder==='function'?new TextEncoder().encode(value).byteLength:String(value).length;}
  function requestUrl(input){return typeof input==='string'?input:input?.url;}
  function requestMethod(input,init){return String(init?.method??input?.method??'GET').toUpperCase();}
  function safeUrl(value,base){try{return new URL(String(value??''),base??'https://www.temu.com/').href;}catch{return '';}}

  globalThis.TemuCatalogNetworkInterceptor=Object.freeze({install,observeFetch,observeXhr,sendProducts,sendEnvelope,postDiagnostic,summarizeCandidate,minimalPoppyProducts,parseAllowedProducts,projectProduct,safePlain,TYPES,SOURCE,VERSION,MAX_PRODUCTS_PER_MESSAGE,PRODUCT_CHUNK_SIZE,MAX_BRIDGE_PAYLOAD_BYTES,getNonce:()=>nonce});install();
})();
