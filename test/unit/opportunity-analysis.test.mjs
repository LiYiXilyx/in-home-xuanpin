import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOpportunityProduct } from '../../src/modules/opportunity/opportunity-classifier.mjs';
import { analyzeOpportunitySegments,rankOpportunityProducts,OPPORTUNITY_SCORE_WEIGHTS,PRODUCT_SCORE_WEIGHTS } from '../../src/modules/opportunity/opportunity-metrics.mjs';

const base={priceAmount:20,salesCount:100,rating:4.5,reviewCount:10,imageUrl:'image',currentSourceUrl:'source',currency:'EUR'};

test('opportunity classifier assigns real motorcycle scenes and preserves hard electronic exclusion',()=>{
  const bag=classifyOpportunityProduct({...base,title:'Universal Motorcycle Tail Rear Seat Bag'});
  assert.equal(bag.level1Scene,'骑行收纳');assert.equal(bag.productType,'尾包/后座包');assert.equal(bag.included,true);
  const electronic=classifyOpportunityProduct({...base,title:'Bluetooth Rechargeable Motorcycle Helmet Headset'});
  assert.equal(electronic.included,false);assert.ok(electronic.hardExclusions.length>0);
});

test('segment scoring uses fixed weights and sample gate',()=>{
  assert.deepEqual(OPPORTUNITY_SCORE_WEIGHTS,{demand:0.25,commercialValue:0.20,entryFriendliness:0.25,reviewGap:0.15,quality:0.15});
  assert.deepEqual(PRODUCT_SCORE_WEIGHTS,{demandValidation:0.35,commercialValue:0.30,quality:0.15,reviewGap:0.20});
  const items=[...make('尾包/后座包','骑行收纳',4,100),...make('排气管/消音器','维修保养',2,70)];
  const segments=analyzeOpportunitySegments(items),bag=segments.find(x=>x.productType==='尾包/后座包'),exhaust=segments.find(x=>x.productType==='排气管/消音器');
  assert.equal(bag.sampleStatus,'RANKED');assert.ok(Number.isFinite(bag.opportunityScore));assert.equal(exhaust.sampleStatus,'VALIDATION_OPPORTUNITY');assert.equal(exhaust.opportunityScore,null);
  const ranked=rankOpportunityProducts(items,segments,{limit:5});assert.ok(ranked.scored.length>0);assert.ok(ranked.selected.length<=5);
});

test('top3 concentration is diagnosed instead of treated as source exhaustion',()=>{
  const items=make('车把/横把','控制操纵',4,1);items[0].salesCount=1000;items[0].estimatedGmv=20000;
  const segment=analyzeOpportunitySegments(items)[0];assert.ok(segment.top3SalesShare>=0.65);assert.equal(segment.riskLevel,'high');assert.ok(segment.dominanceType);
});

function make(productType,level1Scene,count,start){return Array.from({length:count},(_,i)=>({platform:'temu',goodsId:`${productType}-${i}`,title:`${productType} ${i}`,included:true,productType,level1Scene,priceAmount:20+i,salesCount:start+i*10,rating:4+i/10,reviewCount:5+i,estimatedGmv:(20+i)*(start+i*10),warningCodes:[],fitmentType:'universal',logisticsType:'light_small',ipRisk:'unknown'}));}
