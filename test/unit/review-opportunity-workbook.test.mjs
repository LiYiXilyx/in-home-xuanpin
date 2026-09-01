import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRunOpportunitySheet } from '../../src/modules/sourcing/review-opportunity-workbook.mjs';

const headers=['相似产品簇','当前价格 EUR','goods_id','当前 Pool Version','用户场景','产品类型','Level3具体细分','商品标题'];

test('run workbook fields are mapped by real headers and restricted to requested goods',()=>{
  const result=parseRunOpportunitySheet([
    headers,
    ['尾包',12.99,"'601",'pool-1','L1','L2','L3','Title 601'],
    ['其它',9.5,"'999",'pool-1','X1','X2','X3','Title 999'],
    [null,8.25,"'602",'pool-1','A1','A2','A3','Title 602'],
  ],{runGoodsIds:['602','601'],sourceId:'sha#sheet'});
  assert.deepEqual([...result.itemsByGoodsId],[
    ['601',{temu_goods_id:'601',temu_title:'Title 601',temu_listed_price_eur:12.99,temu_currency:'EUR',temu_price_source:'RUN_SELECTED_WORKBOOK_SHEET05',temu_price_source_id:'sha#sheet#pool-1',pool_version_id:'pool-1',similar_cluster:'尾包',level1:'L1',level2:'L2',level3:'L3'}],
    ['602',{temu_goods_id:'602',temu_title:'Title 602',temu_listed_price_eur:8.25,temu_currency:'EUR',temu_price_source:'RUN_SELECTED_WORKBOOK_SHEET05',temu_price_source_id:'sha#sheet#pool-1',pool_version_id:'pool-1',similar_cluster:null,level1:'A1',level2:'A2',level3:'A3'}],
  ]);
});

test('run workbook rejects duplicate or missing requested goods instead of falling back',()=>{
  const row=['尾包',12.99,"'601",'pool-1','L1','L2','L3','Title'];
  assert.throws(()=>parseRunOpportunitySheet([headers,row,row],{runGoodsIds:['601'],sourceId:'sha'}),error=>error.code==='REVIEW_WORKBOOK_DUPLICATE_GOODS');
  assert.throws(()=>parseRunOpportunitySheet([headers,row],{runGoodsIds:['601','602'],sourceId:'sha'}),error=>error.code==='REVIEW_WORKBOOK_GOODS_MISSING');
});

test('invalid or absent EUR price stays null and never becomes zero',()=>{
  const result=parseRunOpportunitySheet([headers,[null,'-',"'601",'pool-1','L1','L2','L3','Title']],{runGoodsIds:['601'],sourceId:'sha'});
  assert.equal(result.itemsByGoodsId.get('601').temu_listed_price_eur,null);
});
