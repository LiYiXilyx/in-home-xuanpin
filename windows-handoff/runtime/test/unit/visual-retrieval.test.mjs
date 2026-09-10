import test from 'node:test';import assert from 'node:assert/strict';import {queryVisualIndex} from '../../src/modules/sourcing/visual-retrieval.mjs';
const product=(id,vector,extra={})=>({goods_id:id,vector,perceptual_hash:'0000000000000000',level2:'cover',level3:'cover',...extra});
test('returns deterministic semantic-first neighbors and excludes anchor',()=>{
 const products=[product('a',[1,0]),product('c',[0.8,0.2]),product('b',[0.9,0.1])];
 const one=queryVisualIndex({index:{products,index_fingerprint:'f'},anchorGoodsId:'a',threshold:.7});const two=queryVisualIndex({index:{products:[...products].reverse(),index_fingerprint:'f'},anchorGoodsId:'a',threshold:.7});
 assert.deepEqual(one.matches.map(x=>x.goods_id),['b','c']);assert.deepEqual(one.matches,two.matches);assert.equal(one.matches.some(x=>x.goods_id==='a'),false);
});
test('taxonomy cannot force a weak visual hit and metadata conflicts are auditable',()=>{
 const index={products:[product('a',[1,0]),product('weak',[0,1]),product('conflict',[.99,.01],{level2:'fuel',level3:'fuel'})]};
 const result=queryVisualIndex({index,anchorGoodsId:'a',threshold:.7});assert.equal(result.matches.some(x=>x.goods_id==='weak'),false);assert.equal(result.matches[0].metadata_consistency,'CONFLICT');assert.match(result.matches[0].match_reason,/METADATA_CONFLICT/);
});
