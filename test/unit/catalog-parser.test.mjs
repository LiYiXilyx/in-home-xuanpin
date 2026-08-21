import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractCardCandidatesFromHtml } from '../../src/modules/catalog/card-extractor.mjs';
import { buildQualityReport, sanitizeListingUrl } from '../../src/modules/catalog/capture-current-page.mjs';
import { collectListingProducts } from '../../src/modules/catalog/listing-scroll.mjs';
import { validateListingEvidence } from '../../src/modules/catalog/listing-validator.mjs';
import { canonicalizeProductUrl, normalizeProduct, parsePriceAmount, parseReviewCount, parseSalesCount } from '../../src/modules/catalog/product-normalizer.mjs';
import { cacheProductImage } from '../../src/modules/products/image-cache.mjs';

const context = {
  siteCountry: '德国', language: 'en', currency: 'EUR', primaryCategory: 'Automotive',
  subcategory: 'Motorcycles & Powersports Accessories', sortOrder: 'Top Sales', capturedAt: '2026-08-20T00:00:00.000Z'
};

test('sanitized HTML fixture extracts and normalizes catalog cards', async () => {
  const html = await fs.readFile(new URL('../fixtures/catalog/product-cards.html', import.meta.url), 'utf8');
  const cards = extractCardCandidatesFromHtml(html);
  assert.equal(cards.length, 3);
  const products = cards.map((card, index) => normalizeProduct(card, { ...context, listingRank: index + 1 }));
  assert.deepEqual(products.slice(0, 2).map(item => item.goods_id), ['601234567890123', '609876543210987']);
  assert.equal(products[0].canonical_url, 'https://www.temu.com/goods.html?goods_id=601234567890123');
  assert.match(products[0].source_url,/601234567890123/);
  assert.equal(products[0].price_amount, 12.49);
  assert.equal(products[0].sales_count, 1200);
  assert.equal(products[0].rating, 4.8);
  assert.equal(products[0].review_count, 321);
  assert.equal(products[1].price_amount, 19.99);
  assert.equal(products[2].price_amount, null);
  assert.equal(products[2].sales_count, null);
  assert.equal(products[2].rating, null);
  assert.equal(products[2].review_count, null);
});

test('identity ignores URL parameters and compact metrics keep missing values null', () => {
  assert.equal(canonicalizeProductUrl('https://www.temu.com/goods.html?goods_id=123456&utm_source=x#reviews'),
    'https://www.temu.com/goods.html?goods_id=123456');
  assert.equal(canonicalizeProductUrl('https://www.temu.com/a-product-g-123456.html?foo=bar'),
    'https://www.temu.com/goods.html?goods_id=123456');
  assert.equal(parsePriceAmount('€9,95', 'EUR'), 9.95);
  assert.equal(parseSalesCount('2.5M+ sold'), 2_500_000);
  assert.equal(parseSalesCount('€3.393,39€4.6K+sold4.6K+sold'), 4600);
  assert.equal(normalizeProduct({ href: 'https://www.temu.com/x-g-999.html', titleCandidates: ['Top pickPart'],
    imageCandidates: [], cardText: 'Details4.7 out of five stars1.360 reviews1.360', visibleLabels: [] }, context).rating, 4.7);
  assert.equal(parseReviewCount('(1.3K reviews)'), 1300);
  assert.equal(parseSalesCount('not shown'), null);
  assert.equal(sanitizeListingUrl('https://www.temu.com/de-en/motorcycles.html?_x_sessn_id=secret&refer_page_id=1'),
    'https://www.temu.com/de-en/motorcycles.html');
});

test('listing validator requires Temu, motorcycle evidence, Top Sales, country, language and currency', () => {
  const evidence = {
    url: 'https://www.temu.com/category/motorcycle-accessories.html',
    bodyText: 'Germany EUR € Motorcycles & Powersports Accessories Sort by: Top Sales',
    productLinkCount: 40, htmlLang: 'en-DE', title: 'Motorcycle Accessories', selectedLabels: ['Top Sales']
  };
  assert.equal(validateListingEvidence(evidence, context).valid, true);
  assert.throws(() => validateListingEvidence({ ...evidence, selectedLabels: [], bodyText: 'Germany EUR Motorcycle products' }, context),
    error => error.code === 'SORT_NOT_CONFIRMED');
  assert.throws(() => validateListingEvidence({ ...evidence, url: 'https://example.com/' }, context),
    error => error.code === 'WRONG_SITE');
});

test('virtualized listing accumulates first-seen goods_id order across DOM windows', async () => {
  let round = 0;
  const page = {
    evaluate: async () => {},
    mouse: { wheel: async () => { round += 1; } },
    getByRole: () => ({ count: async () => 0 })
  };
  const batches = [range(1, 40), range(21, 60), range(51, 90), range(81, 120)];
  const config = { browser: {}, catalog: { ...context, targetCount: 100, selectors: {}, capture: {
    maxStaleRounds: 2, maxExpansions: 1, minimumDelayMs: 0, maximumDelayMs: 0
  } } };
  const result = await collectListingProducts(page, config, { ...context, targetCount: 100 }, {
    detectChallenge: async () => null,
    extractCards: async () => batches[Math.min(round, batches.length - 1)]
  });
  assert.equal(result.products.length, 100);
  assert.equal(result.products[0].goods_id, '700000000000001');
  assert.equal(result.products[99].goods_id, '700000000000100');
  assert.deepEqual(result.products.map(item => item.listing_rank), rangeNumbers(1, 100));
  assert.ok(result.duplicateOccurrences > 0);
});

test('quality report counts missing fields without substituting zero', () => {
  const products = [normalizeProduct(rawCard(1), { ...context, listingRank: 1 }), normalizeProduct({
    href: 'https://www.temu.com/goods.html?goods_id=2', titleCandidates: ['Motorcycle Part'], imageCandidates: [],
    cardText: '', visibleLabels: []
  }, { ...context, listingRank: 2 })];
  const report = buildQualityReport(products, { totalOccurrences: 2, duplicateOccurrences: 0 });
  assert.equal(report.completeness_percent.goods_id, 100);
  assert.equal(report.completeness_percent.price_amount, 50);
  assert.equal(report.missing_fields.sales_count, 1);
});

test('image cache validates HTTP, MIME, signature and minimum bytes without blocking failures', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'temu-image-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(1200)]);
  const ok = await cacheProductImage({ goods_id: '1', image_url: 'https://img.test/1.png' }, {
    cacheDir: dir, minimumBytes: 100, fetchImpl: async () => new Response(png, { headers: { 'content-type': 'image/png' } })
  });
  assert.equal(ok.status, 'downloaded');
  assert.equal((await fs.stat(ok.local_path)).size, png.length);
  const bad = await cacheProductImage({ goods_id: '2', image_url: 'https://img.test/2.png' }, {
    cacheDir: dir, minimumBytes: 100, fetchImpl: async () => new Response(Buffer.alloc(200), { headers: { 'content-type': 'image/png' } })
  });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.error_code, 'IMAGE_SIGNATURE_INVALID');
});

function range(start, end) { return rangeNumbers(start, end).map(rawCard); }
function rangeNumbers(start, end) { return Array.from({ length: end - start + 1 }, (_, index) => start + index); }
function rawCard(number) {
  const goodsId = `700000000000${String(number).padStart(3, '0')}`;
  return { href: `https://www.temu.com/goods.html?goods_id=${goodsId}&ref=${number}`,
    titleCandidates: [`Motorcycle Part ${number}`], imageCandidates: [`https://img.test/${goodsId}.jpg`],
    cardText: `€${(10 + number / 100).toFixed(2)} ${number} sold 4.8 out of 5 stars ${number} reviews`, visibleLabels: ['4.8 out of 5 stars'] };
}
