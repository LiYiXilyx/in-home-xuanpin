'use strict';

(() => {
  const CARD_SELECTORS=['[data-product-card]','article:has(a[href*="goods_id="])','article:has(a[href*="-g-"])','li:has(a[href*="goods_id="])','li:has(a[href*="-g-"])'];

  function extractGoodsId(value) {
    try { const url=new URL(value,'https://www.temu.com');return url.searchParams.get('goods_id')?.trim() || url.pathname.match(/-g-(\d+)\.html/i)?.[1] || null; }
    catch { return null; }
  }

  function parseDocument(documentValue,{ baseUrl=globalThis.location?.href ?? 'https://www.temu.com/',startSequence=1,enrich=true }={}) {
    let elements=[];
    for (const selector of CARD_SELECTORS) {
      try { elements=[...documentValue.querySelectorAll(selector)]; } catch { elements=[]; }
      if (elements.length) break;
    }
    if (!elements.length) {
      const links=[...documentValue.querySelectorAll('a[href*="goods_id="],a[href*="-g-"]')].filter(link => extractGoodsId(link.href || link.getAttribute('href')));
      elements=links.map(findCardContainer);
    }
    elements=[...new Set(elements)];
    const cards=elements.map((element,index) => parseElement(element,{ baseUrl,sequence:startSequence+index })).filter(Boolean);
    return enrich?enrichCards(cards):cards;
  }

  function parseElement(element,{ baseUrl,sequence }) {
    const links=[...(element.matches?.('a[href]') ? [element]:[]),...element.querySelectorAll('a[href]')];
    const link=links.find(item => extractGoodsId(item.href || item.getAttribute('href'))) ?? null;
    if (!link) return null;
    const href=absoluteUrl(link.href || link.getAttribute('href'),baseUrl);
    const goodsId=extractGoodsId(href);
    if (!goodsId) return null;
    const rawText=clean(element.innerText || element.textContent);
    const image=element.querySelector('img');
    const title=firstText(link.getAttribute('aria-label'),image?.getAttribute('alt'),link.innerText);
    const prices=parsePrices(rawText);
    const badgeText=[...element.querySelectorAll('[class*="badge"],[data-badge],[aria-label*="badge" i]')].map(item => clean(item.innerText || item.textContent)).filter(Boolean).join(' | ') || null;
    return { goods_id:goodsId,href,title,image_url:absoluteUrl(image?.currentSrc || image?.src || image?.getAttribute('src'),baseUrl),
      price_amount:prices[0] ?? null,original_price_amount:prices[1] ?? null,sales_count:parseCompactCount(rawText,/([\d.,]+)\s*([KMB])?\+?\s*sold\b/i),
      rating:parseRating(rawText,element),review_count:parseReviewCount(rawText),listing_rank:sequence,dom_sequence:sequence,
      badge_text:badgeText,raw_card_text:rawText };
  }

  function parseHtmlFixture(html,{ baseUrl='https://www.temu.com/',startSequence=1 }={}) {
    const cards=[];const pattern=/<(article|li)\b[^>]*data-product-card[^>]*>([\s\S]*?)<\/\1>/gi;let match;
    while ((match=pattern.exec(html))) {
      const body=match[2];const anchor=body.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);if (!anchor) continue;
      const href=attribute(anchor[1],'href');const goodsId=extractGoodsId(href);if (!goodsId) continue;
      const imageTag=body.match(/<img\b([^>]*)>/i)?.[1] ?? '';
      const rawText=clean(decodeHtml(body.replace(/<[^>]+>/g,' ')));const prices=parsePrices(rawText);
      const ariaText=[...body.matchAll(/aria-label\s*=\s*["']([^"']*)["']/gi)].map(item => decodeHtml(item[1])).join(' ');
      cards.push({ goods_id:goodsId,href:absoluteUrl(href,baseUrl),title:firstText(attribute(anchor[1],'aria-label'),attribute(imageTag,'alt'),decodeHtml(anchor[2].replace(/<[^>]+>/g,' '))),
        image_url:absoluteUrl(attribute(imageTag,'src'),baseUrl),price_amount:prices[0] ?? null,original_price_amount:prices[1] ?? null,
        sales_count:parseCompactCount(rawText,/([\d.,]+)\s*([KMB])?\+?\s*sold\b/i),rating:parseRating(`${ariaText} ${rawText}`),review_count:parseReviewCount(rawText),
        listing_rank:startSequence+cards.length,dom_sequence:startSequence+cards.length,badge_text:null,raw_card_text:rawText });
    }
    return cards;
  }

  function parsePrices(text) {
    const matches=[...String(text).matchAll(/(?:€|EUR\s*)(\d{1,6}(?:[.,]\d{1,2})?)/gi)].map(match => localizedNumber(match[1])).filter(Number.isFinite);
    return [...new Set(matches)];
  }
  function parseRating(text,element=null) {
    const aria=element ? [...element.querySelectorAll('[aria-label]')].map(item => item.getAttribute('aria-label')).join(' '):'';
    const combined=`${aria} ${text}`;const match=combined.match(/(\d(?:[.,]\d)?)\s*out of (?:5|five)(?: stars)?/i) || combined.match(/rating\s*:?\s*(\d(?:[.,]\d)?)/i);
    const value=match ? localizedNumber(match[1]):null;return value!==null && value>=0 && value<=5 ? value:null;
  }
  function parseReviewCount(text) { return parseCompactCount(text,/\(?([\d.,]+)\s*([KMB])?\s*(?:reviews?|ratings?)\)?/i); }
  function parseCompactCount(text,pattern) { const match=String(text).match(pattern);if (!match) return null;const compact=String(match[1]);const value=!match[2] && /^\d{1,3}(?:[.,]\d{3})+$/.test(compact) ? Number(compact.replace(/[.,]/g,'')):localizedNumber(compact);const multiplier={ K:1e3,M:1e6,B:1e9 }[String(match[2] ?? '').toUpperCase()] ?? 1;return Number.isFinite(value) ? Math.round(value*multiplier):null; }
  function findCardContainer(link) { let element=link.parentElement;for (let depth=0;element && depth<6;depth+=1,element=element.parentElement) { const productLinks=element.querySelectorAll('a[href*="goods_id="],a[href*="-g-"]').length;if (productLinks===1 && element.querySelector('img')) return element;if (productLinks>1) break; }return link.parentElement ?? link; }
  function localizedNumber(value) { let text=String(value).replace(/\s/g,'');if (text.includes(',') && text.includes('.')) text=text.lastIndexOf(',')>text.lastIndexOf('.') ? text.replace(/\./g,'').replace(',','.'):text.replace(/,/g,'');else if (text.includes(',')) text=/,\d{1,2}$/.test(text) ? text.replace(',','.'):text.replace(/,/g,'');const result=Number(text);return Number.isFinite(result) ? result:null; }
  function absoluteUrl(value,baseUrl) { if (!value) return null;try { return new URL(value,baseUrl).href; } catch { return null; } }
  function firstText(...values) { return values.map(clean).find(Boolean) ?? null; }
  function clean(value) { return String(value ?? '').replace(/\s+/g,' ').trim(); }
  function attribute(text,name) { return decodeHtml(text.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`,'i'))?.[1] ?? ''); }
  function decodeHtml(value) { return String(value).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' '); }

  function enrichCards(cards) { const cache=globalThis.TemuCatalogNetworkCache,merger=globalThis.TemuCatalogProductMerger;
    return cards.map(card=>merger?.mergeDomNetwork(card,cache?.get(card.goods_id))??card); }

  globalThis.TemuCatalogParser=Object.freeze({ extractGoodsId,parseDocument,parseElement,parseHtmlFixture,parsePrices,parseReviewCount,enrichCards });
})();
