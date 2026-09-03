'use strict';

(() => {
  const MAX_CARDS_PER_BATCH=300;
  const FULL_REFRESH_MODE='FULL_REFRESH_EXTENSION_AUTO';
  const MANUAL_CAPTURE_MODES=new Set(['MANUAL_BIND_PASSIVE_CAPTURE','MANUAL_NAVIGATION_PASSIVE_CAPTURE']);
  function error(code,message) { const value=new Error(message);value.code=code;return value; }
  function send(message) { return new Promise((resolve,reject) => chrome.runtime.sendMessage(message,response => { const runtimeError=chrome.runtime.lastError;if (runtimeError) reject(new Error(runtimeError.message));else resolve(response); })); }

  function inspectContext(apiContext) {
    const parser=globalThis.TemuCatalogParser;
    if (!parser) throw error('CATALOG_PARSER_NOT_READY','Catalog商品卡解析器未就绪。');
    const profile=apiContext?.profile;
    if (!profile) throw error('CATALOG_CONTEXT_MISMATCH','本地API未返回Category Profile。');
    const pageUrl=new URL(location.href);
    if (pageUrl.protocol!=='https:' || pageUrl.hostname!=='www.temu.com') throw error('CATALOG_CONTEXT_MISMATCH','当前页面不是Temu。');
    const text=String(document.body?.innerText ?? '').replace(/\s+/g,' ');
    const lower=text.toLowerCase();
    const language=String(document.documentElement.lang ?? '').toLowerCase();
    const germany=pageUrl.pathname.toLowerCase().includes('/de-en/') || lower.includes('germany');
    const english=language.startsWith('en') || pageUrl.pathname.toLowerCase().includes('/de-en/');
    const eur=/€|\bEUR\b/i.test(text);
    if (profile.site_country!=='DE' || !germany || profile.language!=='en' || !english || profile.currency!=='EUR' || !eur) throw error('CATALOG_CONTEXT_MISMATCH','页面国家、语言或币种不符合DE / English / EUR。');
    const categoryTokens=String(profile.category_key).split('-').filter(token => token.length>3);
    if (!categoryTokens.every(token => lower.includes(token))) throw error('CATEGORY_MISMATCH','页面Category与当前Profile不匹配。');
    if (!lower.includes(String(profile.sort_order).toLowerCase())) throw error('SORT_ORDER_MISMATCH','页面没有确认当前排序方式。');
    const cards=parser.parseDocument(document,{ baseUrl:location.href });
    if (!cards.length) throw error('NO_PRODUCT_CARDS','当前页面没有可解析的真实商品卡。');
    return { cards,pageContext:{ site_country:profile.site_country,language:profile.language,currency:profile.currency,
      category_key:profile.category_key,category_profile_version:profile.category_profile_version,sort_order:profile.sort_order } };
  }

  async function capture({ campaignId,sourceId,batchId=globalThis.crypto?.randomUUID?.() ?? `catalog-${Date.now()}`,cards=null,captureMode=null,pageBinding=null }) {
    const lookup=campaignId && sourceId ? await send({ type:'GET_CATALOG_CONTEXT',campaignId,sourceId }):await send({ type:'GET_CATALOG_CURRENT' });
    if (!lookup?.ok) throw error(lookup?.errorCode ?? 'CATALOG_CONTEXT_MISMATCH',lookup?.error ?? '无法读取Catalog上下文。');
    campaignId=campaignId ?? lookup.context.campaign.id;sourceId=sourceId ?? lookup.context.source.id;
    const inspected=inspectContext(lookup.context);let selected=selectRequestedCards(inspected.cards,cards);
    if (lookup.context.campaign.browserControlMode===FULL_REFRESH_MODE) {
      selected=selected.filter(card => Number.isInteger(card.sales_count) && card.sales_count>=0 && Boolean(card.raw_sales_text));
      if (!selected.length) throw error('FULL_REFRESH_SALES_EVIDENCE_REQUIRED','当前页面没有同时具备 raw_sales_text 与有效 sales_count 的商品卡。');
    }
    const chunks=splitCards(selected);const capturedAt=new Date().toISOString();const results=[];
    for (let index=0;index<chunks.length;index+=1) {
      const chunkBatchId=chunks.length===1 ? batchId:`${batchId}:part-${index+1}-of-${chunks.length}`;
      const payload={ campaign_id:campaignId,source_id:sourceId,batch_id:chunkBatchId,category_key:lookup.context.profile.category_key,
        category_profile_version:lookup.context.profile.category_profile_version,page_url:location.href,page_title:document.title,
        captured_at:capturedAt,page_context:inspected.pageContext,capture_mode:captureMode,page_binding:pageBinding,cards:chunks[index] };
      const saved=await send({ type:'SAVE_CATALOG_BATCH',payload });
      if (!saved?.ok) throw error(saved?.errorCode ?? 'CATALOG_BATCH_FAILED',saved?.error ?? `Catalog分片 ${index+1}/${chunks.length} 保存失败。`);
      results.push(saved.result);
    }
    const result=aggregateResults(batchId,results);
    if (lookup.context.queue?.id && !MANUAL_CAPTURE_MODES.has(captureMode)) {
      const before=Number(lookup.context.campaign.nonElectronicUniqueCount ?? 0);
      const after=Number(result.campaign?.nonElectronicUniqueCount ?? before);
      const checkpoint=await send({ type:'SAVE_CATALOG_CHECKPOINT',payload:{
        campaign_id:campaignId,source_id:sourceId,queue_id:lookup.context.queue.id,status:'capturing',
        checkpoint:{ runner_state:'YINGDAO_CAPTURED',browser_control_mode:lookup.context.campaign.browserControlMode ?? 'yingdao_browser_controller',
          batch_id:result.batch?.batchId ?? batchId,current_unique:after,new_goods_count:Math.max(0,after-before),
          raw_observation_count:Number(result.campaign?.rawObservedCount ?? 0),captured_at:capturedAt }
      } });
      if (!checkpoint?.ok) throw error(checkpoint?.errorCode ?? 'CATALOG_CHECKPOINT_FAILED',
        `Catalog批次已保存，但checkpoint失败：${checkpoint?.error ?? '未知错误'}`);
      result.checkpoint=checkpoint.result;
    }
    return result;
  }

  async function capturePassive({ campaignId,sourceId,maxCards=300,goodsIds=null,pageBinding=null,transportPolicy=null,batchId=globalThis.crypto?.randomUUID?.() ?? `passive-${Date.now()}` }={}) {
    const parser=globalThis.TemuCatalogParser,cache=globalThis.TemuCatalogNetworkCache,merger=globalThis.TemuCatalogProductMerger;
    if (!parser || !cache || !merger) throw error('PASSIVE_CAPTURE_NOT_READY','Passive Network parser/cache/merger尚未就绪。');
    const rawCards=parser.parseDocument(document,{ baseUrl:location.href,enrich:false });const records=new Map(cache.snapshot().map(record=>[String(record.goods_id),record]));
    const policy=transportPolicy?.policy??transportPolicy??'NETWORK_ENRICHED_REQUIRED',built=buildPassiveCandidates({domCards:rawCards,networkRecords:records,requested:goodsIds,policy,limit:resolvePassiveBatchLimit(maxCards),pageBinding});const cards=built.cards;
    if (!cards.length) throw error('NO_PASSIVE_NETWORK_DOM_MATCH','当前尚无 Network cache 与真实 DOM goods_id 的严格交集，请继续人工导航。');
    const result=await capture({ campaignId,sourceId,batchId,cards,captureMode:'MANUAL_BIND_PASSIVE_CAPTURE',pageBinding });
    return { ...result,passiveGoodsIds:cards.map(card=>String(card.goods_id)),passiveCandidateCount:cards.length,candidateDiagnostics:built.diagnostics,captureTransportPolicy:policy };
  }

  function buildPassiveCandidates({domCards=[],networkRecords=new Map(),requested=null,policy='NETWORK_ENRICHED_REQUIRED',limit=MAX_CARDS_PER_BATCH,pageBinding=null}={}){
    const requestedIds=Array.isArray(requested)?new Set(requested.map(String)):null,domIds=new Set(domCards.map(card=>String(card?.goods_id??''))),cards=[];let networkEnriched=0,domOnlyEligible=0,domRejectedMinimumContract=0;
    for(const dom of domCards){const id=String(dom?.goods_id??'');if(requestedIds&&!requestedIds.has(id))continue;const record=networkRecords.get(id),matched=Boolean(record&&String(record.goods_id)===id);
      let candidate=null;if(matched){candidate=globalThis.TemuCatalogProductMerger.mergeDomNetwork(dom,record);if(candidate)networkEnriched+=1;}
      else if(policy==='DOM_REQUIRED_NETWORK_OPTIONAL'&&validDomMinimum(dom)){candidate={...dom,image_url:dom.image_url??null,price_amount:dom.price_amount??null,sales_count:dom.sales_count??null,rating:dom.rating??null,review_count:dom.review_count??null,capture_transport:'DOM',network_observed:false,field_provenance:dom.field_provenance??{}};domOnlyEligible+=1;}
      else if(policy==='DOM_REQUIRED_NETWORK_OPTIONAL')domRejectedMinimumContract+=1;
      if(!candidate)continue;cards.push({...candidate,network_observed:matched,network_endpoint:matched?record.endpoint??null:null,network_observed_at:matched?record.lastSeenAt??null:null,bound_url:pageBinding?.bound_url??null,bound_at:pageBinding?.bound_at??null,bound_category:pageBinding?.bound_category??null,bound_sort:pageBinding?.bound_sort??null});if(cards.length>=limit)break;
    }
    const networkOnlyRejected=[...networkRecords.keys()].filter(id=>!domIds.has(String(id))).length;
    return{cards,diagnostics:{domVisibleGoods:domIds.size,networkCachedGoods:networkRecords.size,domNetworkIntersection:[...domIds].filter(id=>networkRecords.has(id)).length,networkEnriched,domOnlyEligible,domRejectedMinimumContract,networkOnlyRejected,totalEligibleForCurrentPolicy:cards.length}};
  }
  function validDomMinimum(card){if(!/^\d+$/.test(String(card?.goods_id??''))||!String(card?.title??'').trim())return false;try{const url=new URL(String(card?.source_url??card?.canonical_url??card?.href??''));return url.protocol==='https:'&&(url.hostname==='temu.com'||url.hostname.endsWith('.temu.com'));}catch{return false;}}

  function selectRequestedCards(domCards,requested) {
    if (requested===null || requested===undefined) return domCards;
    if (!Array.isArray(requested) || !requested.length) throw error('NO_PRODUCT_CARDS','本轮没有可提交的Passive商品。');
    const domIds=new Set(domCards.map(card=>String(card.goods_id)));
    const selected=requested.filter(card=>card && domIds.has(String(card.goods_id)));
    if (!selected.length) throw error('NO_PRODUCT_CARDS','Passive商品已不在当前真实DOM。');
    return selected;
  }

  function splitCards(cards,max=MAX_CARDS_PER_BATCH) { const chunks=[];for(let index=0;index<cards.length;index+=max)chunks.push(cards.slice(index,index+max));return chunks; }
  function resolvePassiveBatchLimit(value){if(value===null||value===undefined)return MAX_CARDS_PER_BATCH;const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<=0)throw error('INVALID_PASSIVE_BATCH_LIMIT','Passive batch limit必须是正整数。');return Math.min(parsed,MAX_CARDS_PER_BATCH);}
  function aggregateResults(batchId,results) { const last=results.at(-1);const sum=field => results.reduce((total,item)=>total+Number(item.batch?.[field] ?? 0),0);
    return { ...last,idempotentReplay:results.every(item=>item.idempotentReplay),batch:{ ...last.batch,batchId,chunkCount:results.length,
      chunkBatchIds:results.map(item=>item.batch?.batchId).filter(Boolean),receivedCount:sum('receivedCount'),stagingCount:sum('stagingCount'),
      excludedCount:sum('excludedCount'),duplicateCount:sum('duplicateCount') } }; }

  function showStatus(message,{ ok=false,result=null,errorCode=null }={}) {
    let notice=document.getElementById('temu-catalog-capture-status');
    if (!notice) { notice=document.createElement('div');notice.id='temu-catalog-capture-status';notice.setAttribute('role','status');
      Object.assign(notice.style,{ all:'initial',position:'fixed',right:'18px',bottom:'122px',zIndex:'2147483647',width:'360px',boxSizing:'border-box',padding:'11px 13px',borderRadius:'8px',background:'#17324d',color:'#fff',font:'14px/1.45 system-ui,sans-serif',boxShadow:'0 3px 12px rgba(0,0,0,.3)' });document.documentElement.append(notice); }
    notice.textContent=message;notice.dataset.state=ok ? 'completed':'failed';notice.dataset.errorCode=errorCode ?? '';
    if (result) { notice.dataset.batchId=result.batch?.batchId ?? '';notice.dataset.rawObservedCount=String(result.campaign?.rawObservedCount ?? '');notice.dataset.nonElectronicUniqueCount=String(result.campaign?.nonElectronicUniqueCount ?? ''); }
  }

  function installButton() {
    if (document.getElementById('temu-catalog-capture-button')) return;
    const button=document.createElement('button');button.id='temu-catalog-capture-button';button.type='button';button.textContent='采集当前商品列表';
    Object.assign(button.style,{ all:'initial',position:'fixed',right:'18px',bottom:'70px',zIndex:'2147483646',boxSizing:'border-box',padding:'11px 15px',border:'0',borderRadius:'8px',background:'#0369a1',color:'#fff',font:'700 14px/1.3 system-ui,sans-serif',cursor:'pointer',boxShadow:'0 2px 10px rgba(0,0,0,.25)' });
    button.addEventListener('click',async () => { button.disabled=true;button.textContent='Catalog采集中…';try { const result=await capture({});showStatus(`Catalog批次完成：非电子唯一 ${result.campaign.nonElectronicUniqueCount}，raw ${result.campaign.rawObservedCount}。`,{ ok:true,result }); }
      catch (caught) { showStatus(`Catalog未采集：${caught.message}`,{ errorCode:caught.code }); } finally { button.disabled=false;button.textContent='采集当前商品列表'; } });
    document.documentElement.append(button);
  }

  globalThis.TemuCatalogCapture=Object.freeze({ inspectContext,capture,capturePassive,buildPassiveCandidates,splitCards,aggregateResults,selectRequestedCards,resolvePassiveBatchLimit,MAX_CARDS_PER_BATCH });
  // Listing controls are owned by the context-selected operator overlay.
})();
