import test from 'node:test';import assert from 'node:assert/strict';
import {buildOpportunityGroups,resolveOpportunityGroup,sortGroupItems} from '../../src/modules/sourcing/review-opportunity-groups.mjs';

test('reliable cluster wins, taxonomy falls back and unknown labels never mass merge',()=>{
  assert.deepEqual(resolveOpportunityGroup({temu_goods_id:'1',similar_cluster:' 尾包 ',level1:'L1',level2:'L2',level3:'L3'}),{group_key:'CLUSTER:尾包',group_label:'尾包',group_source:'SIMILAR_CLUSTER',group_confidence:'HIGH'});
  assert.deepEqual(resolveOpportunityGroup({temu_goods_id:'2',similar_cluster:'未知',level1:'Motorcycle',level2:'收纳',level3:'尾包'}),{group_key:'TAXONOMY:motorcycle|收纳|尾包',group_label:'尾包',group_source:'TAXONOMY_PATH',group_confidence:'MEDIUM'});
  assert.equal(resolveOpportunityGroup({temu_goods_id:'3',level1:'其它',level2:'待细分',level3:'未知'}).group_key,'GOODS:3');
  assert.equal(resolveOpportunityGroup({temu_goods_id:'4',level1:'Motorcycle',level2:'其它',level3:'待细分'}).group_key,'GOODS:4');
});

test('group keys metrics and item order are deterministic under reversed input',()=>{
  const rows=[
    item('b',10,2,'HIGH'),item('a',12,1,'HIGH'),item('c',8,8,'LOW'),item('d',null,null,'LOW'),
  ];
  const first=buildOpportunityGroups(rows),second=buildOpportunityGroups([...rows].reverse());
  const a=[...first.groupsByKey.values()][0],b=[...second.groupsByKey.values()][0];
  assert.deepEqual(a,b);
  assert.deepEqual(a.items.map(x=>x.temu_goods_id),['a','b','c','d']);
  assert.deepEqual(a.metrics,{
    group_item_count:4,group_listed_price_count:3,group_unit_price_count:2,
    group_min_listed_price_eur:8,group_min_listed_goods_id:'c',group_min_unit_price_eur:1,
    group_min_unit_goods_id:'a',group_median_unit_price_eur:1.5,
    group_price_coverage:0.75,group_unit_price_coverage:0.5,includes_assumed_units:true,
  });
});

test('group display sorting supports current first, unit, listed and goods id',()=>{
  const rows=[item('b',10,5,'HIGH'),item('a',12,2,'HIGH'),item('c',8,8,'LOW')];
  assert.deepEqual(sortGroupItems(rows,{sort:'DEFAULT',currentGoodsId:'b'}).map(x=>x.temu_goods_id),['b','a','c']);
  assert.deepEqual(sortGroupItems(rows,{sort:'UNIT_PRICE'}).map(x=>x.temu_goods_id),['a','b','c']);
  assert.deepEqual(sortGroupItems(rows,{sort:'LISTED_PRICE'}).map(x=>x.temu_goods_id),['c','b','a']);
  assert.deepEqual(sortGroupItems(rows,{sort:'GOODS_ID'}).map(x=>x.temu_goods_id),['a','b','c']);
});

function item(id,listed,unit,confidence){return {temu_goods_id:id,similar_cluster:'尾包',temu_listed_price_eur:listed,temu_unit_price_eur:unit,quantity_confidence:confidence};}
