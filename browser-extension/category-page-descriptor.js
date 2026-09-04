'use strict';
(() => {
  const normalize=value=>String(value??'').normalize('NFKC').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
  function fail(code){throw Object.assign(new Error(code),{code});}
  function categoryUrl(raw){
    let u;try{u=new URL(raw);}catch{fail('CATEGORY_IDENTITY_UNRESOLVED');}
    if(u.protocol!=='https:'||!['www.temu.com','temu.com'].includes(u.hostname)||u.username||u.password||u.port)fail('UNSUPPORTED_CATEGORY_CAPTURE_PAGE');
    const match=u.pathname.match(/^\/de-en\/([a-z0-9]+(?:-[a-z0-9]+)*)-o([1-9]\d*)-(\d+)\.html$/);
    if(!match)fail('UNSUPPORTED_CATEGORY_CAPTURE_PAGE');
    for(const key of u.searchParams.keys())if(!/^(refer_|_x_|utm_|affiliate|aff_|session|exposure)/i.test(key))fail('CATEGORY_IDENTITY_UNRESOLVED');
    return {url:`https://www.temu.com${u.pathname}`,pathname:u.pathname,slug:match[1],numeric:match[3]};
  }
  function canonicalizeTemuCategoryListingUrl(url){return categoryUrl(url).url;}
  function validateDescriptor(input={}){
    if(input.descriptor_schema_version!==1||input.page_type!=='CATEGORY_LISTING')fail('UNSUPPORTED_CATEGORY_CAPTURE_PAGE');
    const u=categoryUrl(input.page_url);
    if(input.site_country!=='DE'||input.language!=='en'||input.currency!=='EUR')fail('CATEGORY_MARKET_MISMATCH');
    if(input.sort_order!=='Top Sales')fail('CATEGORY_SORT_MISMATCH');
    if(['captcha_blocking','security_verification','search_no_results'].some(k=>input[k]!==false)||!Number.isSafeInteger(input.dom_goods_count)||input.dom_goods_count<1)fail('CATEGORY_PAGE_HEALTH_INVALID');
    const breadcrumbs=Array.isArray(input.breadcrumbs)?input.breadcrumbs.map(normalize):[];
    if(breadcrumbs.length<2||breadcrumbs.length>20||breadcrumbs.some(x=>!x||x.length>200))fail('CATEGORY_IDENTITY_UNRESOLVED');
    const terminal=breadcrumbs.at(-1),parent=breadcrumbs.at(-2);
    if(!/[a-z]/i.test(terminal)||!Number.isFinite(Date.parse(input.detected_at)))fail('CATEGORY_IDENTITY_UNRESOLVED');
    return Object.freeze({descriptor_schema_version:1,page_url:u.url,canonical_listing_url:u.url,hostname:'www.temu.com',pathname:u.pathname,
      page_type:'CATEGORY_LISTING',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',
      breadcrumbs:Object.freeze(breadcrumbs),breadcrumb_terminal:terminal,breadcrumb_parent:parent,page_category_name:terminal,
      category_url_slug:u.slug,category_numeric_id:u.numeric,dom_goods_count:input.dom_goods_count,
      captcha_blocking:false,security_verification:false,search_no_results:false,detected_at:new Date(input.detected_at).toISOString()});
  }
  function parseCategoryPage(doc,url,now=()=>new Date()){
    const visible=n=>!n.hidden&&n.getAttribute?.('aria-hidden')!=='true'&&(!n.getClientRects||n.getClientRects().length>0)&&!n.closest?.('#temu-catalog-operator-overlay');
    const nodes=selector=>Array.from(doc.querySelectorAll(selector)).filter(visible);
    const text=n=>normalize(n.innerText??n.textContent);
    const crumbs=nodes('[aria-label*="breadcrumb" i] li').map(text);
    const breadcrumbs=crumbs.length?crumbs:globalThis.TemuCatalogBreadcrumbs?.extractTemuBreadcrumbs(doc).breadcrumbs??[];
    const cards=nodes('a[href*="-g-"],a[href*="goods_id="]');
    const goods=new Set(cards.map(n=>{try{const u=new URL(n.href,url);return u.pathname.match(/-g-(\d+)\.html/)?.[1]??u.searchParams.get('goods_id');}catch{return null;}}).filter(Boolean));
    const alerts=nodes('[role="alert"],h1,h2').map(text).join(' ');
    const sort=nodes('button,[role="button"],[aria-selected="true"]').some(n=>/^Sort by:\s*Top sales$/i.test(text(n))||n.getAttribute?.('aria-selected')==='true'&&/^Top sales$/i.test(text(n)));
    return validateDescriptor({descriptor_schema_version:1,page_url:url,page_type:'CATEGORY_LISTING',site_country:new URL(url).pathname.startsWith('/de-en/')?'DE':'',
      language:/^en(?:-|$)/i.test(doc.documentElement.lang)?'en':'',currency:cards.some(n=>/€|\bEUR\b/.test(text(n)))?'EUR':'',sort_order:sort?'Top Sales':'',breadcrumbs,
      dom_goods_count:goods.size,captcha_blocking:/captcha|verify you are human/i.test(alerts),security_verification:/security verification|security check/i.test(alerts),search_no_results:/no (?:search )?results|nothing found/i.test(alerts),detected_at:now().toISOString()});
  }
  globalThis.TemuCategoryPageDescriptor=Object.freeze({canonicalizeTemuCategoryListingUrl,validateDescriptor,parseCategoryPage});
})();
