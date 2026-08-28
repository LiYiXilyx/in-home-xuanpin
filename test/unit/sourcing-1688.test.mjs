import assert from 'node:assert/strict';
import test from 'node:test';
import { derive1688ProductId,loadSourcingConfig,parseRmbPrice,scoreCandidate,validateHttpUrl } from '../../src/modules/sourcing/sourcing-1688.mjs';

test('RMB price validation accepts ranges and rejects inverted bounds',()=>{
  assert.deepEqual(parseRmbPrice({raw:'¥12.50-18.00',min:'',max:''}),{raw:'¥12.50-18.00',min:12.5,max:18});
  assert.throws(()=>parseRmbPrice({raw:'12-9',min:12,max:9}),/上下限无效/);
});
test('1688 URL and product id validation are platform-scoped',()=>{
  const url=validateHttpUrl('https://detail.1688.com/offer/123456789.html',{platform:'1688'});
  assert.equal(derive1688ProductId(url),'123456789');
  assert.throws(()=>validateHttpUrl('https://example.com/offer/123.html',{platform:'1688'}),/不是1688域名/);
});

test('V1 scoring keeps image and overall similarity null and forces review',()=>{
  const config=loadSourcingConfig('config/1688-sourcing-v1.json');
  const score=scoreCandidate({temuTitle:'motorcycle tail bag waterproof',supplierTitle:'防水 motorcycle tail bag',level1:'骑行收纳',level2:'尾包/后座包',level3:'防水后座包',similarCluster:'尾包',weights:config.similarityWeights});
  assert.equal(score.imageSimilarity,null);assert.equal(score.imageSimilarityStatus,'NOT_IMPLEMENTED');assert.equal(score.overallSimilarity,null);
  assert.equal(score.manualReviewRequired,true);assert.ok(score.titleSimilarity>0);
  assert.deepEqual(score.weights,{image:0.6,title:0.25,category:0.15});
});
