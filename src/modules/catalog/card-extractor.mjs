export async function extractRawCards(page, selectors = {}) {
  const productLinks = selectors.productLinks || "a[href*='goods.html'], a[href*='-g-']";
  const productCard = selectors.productCard || "[data-testid*='product'], [class*='product-card'], [class*='ProductCard'], li, article";
  return page.locator(productLinks).evaluateAll((anchors, args) => {
    const rows = [];
    for (const anchor of anchors) {
      if (!anchor.href) continue;
      let node = anchor;
      let configured = null;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        if (!configured && node.matches?.(args.productCard)) configured = node;
        const text = String(node.innerText || '');
        if (node.querySelector?.('img') && /(?:€|EUR|\$|USD|£|GBP)/i.test(text)) { configured = node; break; }
      }
      const card = configured || anchor.parentElement || anchor;
      const images = [...card.querySelectorAll('img')].map(image => ({
        url: image.currentSrc || image.src || image.getAttribute('data-src') || '', alt: image.alt || '',
        area: Math.max(image.clientWidth * image.clientHeight, image.naturalWidth * image.naturalHeight)
      })).filter(image => image.url).sort((a, b) => b.area - a.area);
      const labels = [...card.querySelectorAll('[aria-label], [title]')]
        .flatMap(element => [element.getAttribute('aria-label'), element.getAttribute('title')]).filter(Boolean).slice(0, 40);
      rows.push({
        href: anchor.href,
        goodsIdCandidate: anchor.getAttribute('data-goods-id') || card.getAttribute?.('data-goods-id') || null,
        titleCandidates: [anchor.getAttribute('aria-label'), anchor.getAttribute('title'), anchor.innerText,
          card.querySelector('[data-tooltip-title]')?.getAttribute('data-tooltip-title'),
          card.querySelector('h2,h3,[class*="title"],[class*="Title"]')?.textContent, images[0]?.alt].filter(Boolean),
        imageCandidates: images,
        priceText: card.innerText || '', salesText: card.innerText || '', ratingText: labels.join(' '),
        reviewText: `${card.innerText || ''} ${labels.join(' ')}`,
        cardText: String(card.innerText || anchor.innerText || '').replace(/\s+/g, ' ').trim(), visibleLabels: labels
      });
    }
    return rows;
  }, { productCard });
}

// Deterministic fallback for sanitized fixture files. Live collection uses the DOM extractor above.
export function extractCardCandidatesFromHtml(html, baseUrl = 'https://www.temu.com/') {
  const cards = [];
  for (const match of String(html).matchAll(/<(?:article|li)\b[^>]*data-product-card[^>]*>([\s\S]*?)<\/(?:article|li)>/gi)) {
    const block = match[1];
    const anchor = block.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const image = block.match(/<img\b([^>]*)>/i);
    cards.push({
      href: safeUrl(attribute(anchor[1], 'href'), baseUrl), goodsIdCandidate: attribute(anchor[1], 'data-goods-id'),
      titleCandidates: [attribute(anchor[1], 'aria-label'), stripTags(anchor[2]), attribute(image?.[1], 'alt')].filter(Boolean),
      imageCandidates: image ? [{ url: safeUrl(attribute(image[1], 'src'), baseUrl), alt: attribute(image[1], 'alt'), area: 0 }] : [],
      priceText: stripTags(block), salesText: stripTags(block), ratingText: stripTags(block), reviewText: stripTags(block),
      cardText: stripTags(block), visibleLabels: [...block.matchAll(/aria-label=(?:"([^"]*)"|'([^']*)')/gi)].map(item => item[1] ?? item[2])
    });
  }
  return cards;
}
function attribute(source = '', name) {
  const match = String(source).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeEntities(match?.[1] ?? match?.[2] ?? '') || null;
}
function stripTags(value = '') { return decodeEntities(String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }
function decodeEntities(value) { return String(value).replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' '); }
function safeUrl(value, base) { try { return value ? new URL(value, base).toString() : null; } catch { return null; } }
