import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOpportunityProduct } from '../../src/modules/opportunity/opportunity-classifier.mjs';
import { analyzeOpportunitySegments,rankOpportunityProducts,OPPORTUNITY_SCORE_WEIGHTS,PRODUCT_SCORE_WEIGHTS } from '../../src/modules/opportunity/opportunity-metrics.mjs';
import { buildGroupingQa,sortOpportunityItems } from '../../src/modules/opportunity/opportunity-grouping.mjs';

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

test('clear cover and fastener entities receive formal taxonomy plus auditable grouping evidence',()=>{
  const cover=classifyOpportunityProduct({...base,goodsId:'10',title:'Waterproof Motorcycle Cover for Outdoor Storage'});
  assert.deepEqual([cover.level1Scene,cover.productType,cover.level3Segment,cover.similarProductCluster],['安全防护','车体防护','车罩','车罩']);
  assert.match(cover.clusteringEvidence,/title_keyword:/);assert.equal(cover.imageEvidence,'not_assessed');assert.equal(cover.evidenceConflict,false);
  const bolt=classifyOpportunityProduct({...base,goodsId:'20',title:'Stainless Steel Motorcycle Bolt Kit Universal Fasteners'});
  assert.deepEqual([bolt.level1Scene,bolt.productType,bolt.level3Segment,bolt.similarProductCluster],['维修保养','紧固/密封件','螺栓','螺栓']);
});

test('image evidence is never fabricated and explicit evidence conflict forces review',()=>{
  const missing=classifyOpportunityProduct({...base,imageUrl:null,title:'Universal Motorcycle Accessory'});
  assert.equal(missing.imageEvidence,'unavailable');
  const conflict=classifyOpportunityProduct({...base,title:'Waterproof Motorcycle Cover',imageEvidence:'bolt/screw kit',evidenceConflict:true});
  assert.equal(conflict.evidenceConflict,true);assert.equal(conflict.manualReviewRequired,true);assert.ok(conflict.confidence<0.5);
});

test('detail grouping is deterministic, contiguous, and sales-descending inside one cluster',()=>{
  const items=[
    {...base,goodsId:'3',title:'Motorcycle Mount Bracket',salesCount:10},
    {...base,goodsId:'2',title:'Waterproof Motorcycle Cover',salesCount:20},
    {...base,goodsId:'1',title:'Waterproof Motorcycle Cover',salesCount:100},
    {...base,goodsId:'4',title:'Motorcycle Bolt Kit',salesCount:30},
  ];
  const sorted=sortOpportunityItems(items),covers=sorted.filter(x=>x.similarProductCluster==='车罩');
  assert.deepEqual(covers.map(x=>x.goodsId),['1','2']);
  const qa=buildGroupingQa(items);assert.equal(qa.sameLevel2Contiguous,true);assert.equal(qa.sameLevel3Contiguous,true);assert.equal(qa.sameSimilarClusterContiguous,true);
});

function make(productType,level1Scene,count,start){return Array.from({length:count},(_,i)=>({platform:'temu',goodsId:`${productType}-${i}`,title:`${productType} ${i}`,included:true,productType,level1Scene,priceAmount:20+i,salesCount:start+i*10,rating:4+i/10,reviewCount:5+i,estimatedGmv:(20+i)*(start+i*10),warningCodes:[],fitmentType:'universal',logisticsType:'light_small',ipRisk:'unknown'}));}
