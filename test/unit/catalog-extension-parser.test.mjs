import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');

test('Catalog Extension parses the sanitized product-card fixture with stable fields and goods_id identity',() => {
  const context={ URL };context.globalThis=context;
  vm.runInNewContext(fs.readFileSync(path.join(root,'browser-extension/catalog-parser.js'),'utf8'),context);
  const html=fs.readFileSync(path.join(root,'test/fixtures/catalog/product-cards.html'),'utf8');
  const cards=context.TemuCatalogParser.parseHtmlFixture(html);
  assert.equal(cards.length,3);
  assert.deepEqual(Array.from(cards,card => card.goods_id),['601234567890123','609876543210987','601111111111111']);
  assert.equal(cards[0].href,'https://www.temu.com/goods.html?goods_id=601234567890123&utm_source=fixture');
  assert.equal(cards[0].title,'Universal Motorcycle Phone Mount');
  assert.equal(cards[0].image_url,'https://img.example.test/601234567890123.webp');
  assert.equal(cards[0].price_amount,12.49);
  assert.equal(cards[0].sales_count,1200);
  assert.equal(cards[0].rating,4.8);
  assert.equal(cards[0].review_count,321);
  assert.equal(cards[1].price_amount,19.99);
  assert.equal(cards[1].rating,4.7);
  assert.equal(cards[1].listing_rank,2);
  assert.equal(cards[1].dom_sequence,2);
  assert.equal(cards[2].price_amount,null);
  assert.match(cards[2].raw_card_text,/Missing Metrics Motorcycle Cover/);
  assert.equal(context.TemuCatalogParser.extractGoodsId('https://www.temu.com/de-en/item-g-123456.html?x=1'),'123456');
  assert.equal(context.TemuCatalogParser.extractGoodsId('https://example.test/no-product'),null);
  assert.equal(context.TemuCatalogParser.parseReviewCount('4.7 out of five stars 4.507 reviews'),4507);
});
