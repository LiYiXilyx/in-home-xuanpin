import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SAMPLE_METHOD,
  sampleStableRandom5,
} from '../../src/modules/sourcing/stable-random5.mjs';

test('stable Random5 returns the hand-verified SHA256 byte order and audit metadata', () => {
  const rows=['p1','p2','p3','p4','p5','p6'].map((id,index)=>({ '1688_product_id':id,original_rank:index+1 }));
  const sampled=sampleStableRandom5('g1',rows);

  assert.deepEqual(sampled.map(item=>item['1688_product_id']),['p5','p3','p2','p4','p6']);
  assert.deepEqual(sampled.map(item=>item.original_rank),[5,3,2,4,6]);
  assert.deepEqual(sampled.map(item=>item.random_sample_rank),[1,2,3,4,5]);
  assert.ok(sampled.every(item=>item.sample_seed==='g1'));
  assert.ok(sampled.every(item=>item.sample_method==='SHA256_STABLE_ORDER_V1'));
  assert.ok(sampled.every(item=>item.selected_candidate===null));
  assert.equal(SAMPLE_METHOD,'SHA256_STABLE_ORDER_V1');
});

test('duplicate product IDs retain the earliest original rank exactly once', () => {
  const sampled=sampleStableRandom5('g1',[
    { '1688_product_id':'p1',original_rank:8,title:'late' },
    { '1688_product_id':'p1',original_rank:2,title:'early' },
    { '1688_product_id':'p2',original_rank:3,title:'other' },
  ]);

  assert.equal(sampled.length,2);
  const p1=sampled.find(item=>item['1688_product_id']==='p1');
  assert.equal(p1.original_rank,2);
  assert.equal(p1.title,'early');
  assert.equal(sampled.filter(item=>item['1688_product_id']==='p1').length,1);
});

test('same input, cloned input, and reversed input produce identical ordered records', () => {
  const rows=[
    { '1688_product_id':'p1',original_rank:4,title:'late' },
    { '1688_product_id':'p1',original_rank:1,title:'early' },
    { '1688_product_id':'p2',original_rank:2,title:'two' },
    { '1688_product_id':'p3',original_rank:3,title:'three' },
    { '1688_product_id':'p4',original_rank:4,title:'four' },
    { '1688_product_id':'p5',original_rank:5,title:'five' },
    { '1688_product_id':'p6',original_rank:6,title:'six' },
  ];

  const first=sampleStableRandom5('g1',rows);
  const second=sampleStableRandom5('g1',structuredClone(rows));
  const reversed=sampleStableRandom5('g1',structuredClone(rows).reverse());

  assert.deepEqual(second,first);
  assert.deepEqual(reversed,first);
});

test('equal-rank duplicate records use a deterministic input-order-independent tie-break', () => {
  const alpha={ '1688_product_id':'p1',original_rank:1,title:'alpha' };
  const beta={ '1688_product_id':'p1',original_rank:1,title:'beta' };
  const forward=sampleStableRandom5('g1',[beta,alpha]);
  const reversed=sampleStableRandom5('g1',[alpha,beta]);

  assert.deepEqual(forward,reversed);
  assert.equal(forward[0].title,'alpha');
});

test('invalid product IDs are excluded and fewer than five valid candidates are all returned', () => {
  const sampled=sampleStableRandom5(601,[
    { '1688_product_id':null,original_rank:1 },
    { '1688_product_id':' ',original_rank:2 },
    { '1688_product_id':'100',original_rank:3 },
    { '1688_product_id':'200',original_rank:4 },
  ]);

  assert.deepEqual(sampled.map(item=>item['1688_product_id']).sort(),['100','200']);
  assert.equal(sampled.length,2);
  assert.ok(sampled.every(item=>item.sample_seed==='601'));
});
