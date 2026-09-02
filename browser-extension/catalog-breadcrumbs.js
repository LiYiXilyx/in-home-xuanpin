'use strict';

(() => {
  const SEPARATOR=/^[>\/›»→]+$/;

  function extractTemuBreadcrumbs(doc=globalThis.document){
    const containers=[...doc.querySelectorAll('nav[aria-label*="breadcrumb" i],[aria-label*="breadcrumb" i],nav > ol')];
    for(const container of containers){
      const values=extractVisibleItems(container);
      if(values.length>1)return freezeResult(values,'SEMANTIC_NAV');
    }
    for(const script of doc.querySelectorAll('script[type="application/ld+json"]')){
      const list=findBreadcrumbList(parseJson(script.textContent));
      const values=validatedJsonLd(list);
      if(values.length>1)return freezeResult(values,'JSON_LD');
    }
    return freezeResult([],'NONE');
  }

  function extractVisibleItems(container){
    const items=[...container.querySelectorAll(':scope > li')];
    return items.filter(visible).map(item=>item.querySelector('a,h1,[aria-current],span')??item).filter(visible)
      .map(item=>displayText(item)).filter(value=>value&&!SEPARATOR.test(value));
  }
  function visible(node){return !node?.hidden&&node?.getAttribute?.('aria-hidden')!=='true'&&(!node?.getClientRects||node.getClientRects().length>0);}
  function displayText(node){return normalizeText(node?.innerText??node?.textContent??'');}
  function parseJson(value){try{return JSON.parse(String(value??''));}catch{return null;}}
  function findBreadcrumbList(value){if(Array.isArray(value)){for(const item of value){const found=findBreadcrumbList(item);if(found)return found;}return null;}if(!value||typeof value!=='object')return null;if(value['@type']==='BreadcrumbList')return value;for(const item of Object.values(value)){const found=findBreadcrumbList(item);if(found)return found;}return null;}
  function validatedJsonLd(list){const rows=list?.itemListElement;if(!Array.isArray(rows)||!rows.length)return[];const ordered=[...rows].sort((a,b)=>Number(a?.position)-Number(b?.position));if(ordered.some((row,index)=>row?.['@type']!=='ListItem'||Number(row.position)!==index+1||!String(row.name??row.item?.name??'').trim()))return[];return ordered.map(row=>normalizeText(row.name??row.item?.name)).filter(Boolean);}
  function normalizeText(value){return String(value??'').normalize('NFKC').replace(/&(?:apos|#0*39|rsquo|lsquo);/gi,"'").replace(/&(?:gt|#0*62|rsaquo|#0*8250);/gi,'>').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/[‘’‛`´]/g,"'").replace(/\s+/g,' ').trim().replace(/^[>\/›»→]\s*|\s*[>\/›»→]$/g,'').trim();}
  function comparable(value){return normalizeText(value).toLocaleLowerCase();}
  function matchesBreadcrumbSuffix(observed,expected){if(!Array.isArray(expected)||!expected.length||!Array.isArray(observed)||observed.length<expected.length)return false;const offset=observed.length-expected.length;return expected.every((value,index)=>comparable(value)===comparable(observed[offset+index]));}
  function freezeResult(breadcrumbs,source){return Object.freeze({breadcrumbs:Object.freeze(breadcrumbs),source});}
  globalThis.TemuCatalogBreadcrumbs=Object.freeze({extractTemuBreadcrumbs,matchesBreadcrumbSuffix,normalizeText,comparable});
})();
