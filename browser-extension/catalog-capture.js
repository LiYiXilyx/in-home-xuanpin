'use strict';

(() => {
  const MAX_CARDS_PER_BATCH=300;
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

  async function capture({ campaignId,sourceId,batchId=globalThis.crypto?.randomUUID?.() ?? `catalog-${Date.now()}` }) {
    const lookup=campaignId && sourceId ? await send({ type:'GET_CATALOG_CONTEXT',campaignId,sourceId }):await send({ type:'GET_CATALOG_CURRENT' });
    if (!lookup?.ok) throw error(lookup?.errorCode ?? 'CATALOG_CONTEXT_MISMATCH',lookup?.error ?? '无法读取Catalog上下文。');
    campaignId=campaignId ?? lookup.context.campaign.id;sourceId=sourceId ?? lookup.context.source.id;
    const inspected=inspectContext(lookup.context);
    const chunks=splitCards(inspected.cards);const capturedAt=new Date().toISOString();const results=[];
    for (let index=0;index<chunks.length;index+=1) {
      const chunkBatchId=chunks.length===1 ? batchId:`${batchId}:part-${index+1}-of-${chunks.length}`;
      const payload={ campaign_id:campaignId,source_id:sourceId,batch_id:chunkBatchId,category_key:lookup.context.profile.category_key,
        category_profile_version:lookup.context.profile.category_profile_version,page_url:location.href,page_title:document.title,
        captured_at:capturedAt,page_context:inspected.pageContext,cards:chunks[index] };
      const saved=await send({ type:'SAVE_CATALOG_BATCH',payload });
      if (!saved?.ok) throw error(saved?.errorCode ?? 'CATALOG_BATCH_FAILED',saved?.error ?? `Catalog分片 ${index+1}/${chunks.length} 保存失败。`);
      results.push(saved.result);
    }
    return aggregateResults(batchId,results);
  }

  function splitCards(cards,max=MAX_CARDS_PER_BATCH) { const chunks=[];for(let index=0;index<cards.length;index+=max)chunks.push(cards.slice(index,index+max));return chunks; }
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

  globalThis.TemuCatalogCapture=Object.freeze({ inspectContext,capture,splitCards,aggregateResults,MAX_CARDS_PER_BATCH });
  installButton();
})();
