import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUnitPrice,parsePackQuantity} from '../../src/modules/sourcing/unit-price-normalizer.mjs';

const cases=[
  ['10pcs Motorcycle Fuel Hose',10,'HIGH'],['10 pcs clips',10,'HIGH'],['10-piece set',10,'HIGH'],
  ['Pack of 12 Clips',12,'HIGH'],['set of 8 bolts',8,'HIGH'],['2 pairs guards',4,'HIGH'],['pair of 2 mirrors',2,'HIGH'],
  ['10个装',10,'HIGH'],['10只装',10,'HIGH'],['10件装',10,'HIGH'],['10套装',10,'HIGH'],['10片装',10,'HIGH'],
  ['一包10个',10,'HIGH'],['每包10个',10,'HIGH'],['10个/包',10,'HIGH'],
  ['37L Motorcycle Tail Bag',1,'LOW'],['50cc Fuel Hose',1,'LOW'],['12V LED Light',1,'LOW'],
  ['6mm x 20mm Bolt, 10pcs',10,'HIGH'],['Model X2024 bracket',1,'LOW'],['10件起批',1,'LOW'],
];
for(const [title,quantity,confidence] of cases)test(`pack quantity: ${title}`,()=>{
  const result=parsePackQuantity(title);
  assert.equal(result.pack_quantity,quantity);assert.equal(result.quantity_confidence,confidence);
});

test('normalizer preserves listed price and derives unit price without MOQ input',()=>{
  assert.deepEqual(normalizeUnitPrice({listedPrice:12,currency:'EUR',title:'Pack of 12 Clips'}),{
    listed_price:12,currency:'EUR',pack_quantity:12,unit_price:1,
    quantity_source:'TITLE_EXPLICIT_PACK',quantity_confidence:'HIGH',price_basis:'LISTED_SINGLE_VALUE',
    normalization_status:'NORMALIZED',evidence:'Pack of 12',
  });
  assert.equal(normalizeUnitPrice({listedPrice:10,currency:'CNY',title:'10件起批',moq:10}).pack_quantity,1);
});

test('missing price remains null while assumed single remains explicit',()=>{
  const result=normalizeUnitPrice({listedPrice:null,currency:'EUR',title:'37L bag'});
  assert.equal(result.listed_price,null);assert.equal(result.unit_price,null);
  assert.equal(result.quantity_source,'ASSUMED_SINGLE');assert.equal(result.normalization_status,'ASSUMED');
});
