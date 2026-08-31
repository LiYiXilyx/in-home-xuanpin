import test from 'node:test';
import assert from 'node:assert/strict';
import { hashInitialCandidate } from '../../src/modules/catalog-scale/initial-candidate-hash.mjs';

function payload(goodsId, extra = {}) {
  return { platform:'temu', goods_id:String(goodsId), category_key:'fixture-category-b',
    category_profile_version:'fixture-category-b-v1', title:`Item ${goodsId}`,
    source_url:`https://www.temu.com/de-en/item-${goodsId}.html`,
    canonical_url:`https://www.temu.com/goods.html?goods_id=${goodsId}`,
    image_url:`https://img.test/${goodsId}.jpg`, price_amount:12, currency:'EUR', sales_count:100,
    rating:4.8, review_count:20, listing_rank:null, electronic_screening_status:'passed',
    business_eligible:true, reviewable:true, quality_status:'pending', source_id:'source-1',
    first_batch_id:'batch-1', raw:{ stable:'yes' }, ...extra };
}

function reverseKeys(value) {
  return Object.fromEntries(Object.entries(value).reverse().map(([key,item]) =>
    [key,item && typeof item === 'object' && !Array.isArray(item) ? reverseKeys(item) : item]));
}

test('canonical hash ignores input/key order, timezone fields, and last_seen_at', () => {
  const a=[payload('2',{last_seen_at:'2026-08-31T01:00:00+08:00'}),payload('1')];
  const b=[reverseKeys(payload('1',{last_seen_at:'ignored'})),reverseKeys(payload('2'))];
  assert.equal(hashInitialCandidate(a,{hashVersion:'v1'}).hash,
    hashInitialCandidate(b,{hashVersion:'v1'}).hash);
});

test('activation business changes alter the hash and unknown versions hard fail', () => {
  assert.notEqual(hashInitialCandidate([payload('1',{price_amount:12})],{hashVersion:'v1'}).hash,
    hashInitialCandidate([payload('1',{price_amount:13})],{hashVersion:'v1'}).hash);
  assert.throws(() => hashInitialCandidate([],{hashVersion:'v2'}),
    error => error.code === 'INITIAL_POOL_HASH_VERSION_UNSUPPORTED');
});
