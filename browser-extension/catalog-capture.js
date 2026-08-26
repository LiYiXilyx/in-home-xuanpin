'use strict';

(() => {
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
    if (!campaignId || !sourceId) throw error('CATALOG_CONTEXT_MISMATCH','Catalog采集缺少campaignId或sourceId。');
    const lookup=await send({ type:'GET_CATALOG_CONTEXT',campaignId,sourceId });
    if (!lookup?.ok) throw error(lookup?.errorCode ?? 'CATALOG_CONTEXT_MISMATCH',lookup?.error ?? '无法读取Catalog上下文。');
    const inspected=inspectContext(lookup.context);
    const payload={ campaign_id:campaignId,source_id:sourceId,batch_id:batchId,category_key:lookup.context.profile.category_key,
      category_profile_version:lookup.context.profile.category_profile_version,page_url:location.href,page_title:document.title,
      captured_at:new Date().toISOString(),page_context:inspected.pageContext,cards:inspected.cards };
    const saved=await send({ type:'SAVE_CATALOG_BATCH',payload });
    if (!saved?.ok) throw error(saved?.errorCode ?? 'CATALOG_BATCH_FAILED',saved?.error ?? 'Catalog批次保存失败。');
    return saved.result;
  }

  globalThis.TemuCatalogCapture=Object.freeze({ inspectContext,capture });
})();
