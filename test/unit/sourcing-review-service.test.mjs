import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourcingReviewService } from '../../src/modules/sourcing/sourcing-review-service.mjs';

function fixture({status='COMPLETED'}={}) {
  const state={
    runs:new Map([['run-fixed',{run_id:'run-fixed',import_status:status,status:'COMPLETED'}]]),
    goods:[
      {temu_goods_id:'601',review_status:'PENDING',review_revision:0},
      {temu_goods_id:'602',review_status:'CONFIRMED',review_revision:2},
      {temu_goods_id:'603',review_status:'NO_SELECTION',review_revision:3},
    ],
    candidates:new Map([
      ['601',[candidate('601',1,'p1','SUCCESS'),candidate('601',2,'p2','FAILED')]],
      ['602',[candidate('602',1,'p3','SUCCESS')]],
      ['603',[candidate('603',1,'p4','SUCCESS')]],
    ]),
  };
  const sourcingRepository={
    listReviewGoods(runId){assert.equal(runId,'run-fixed');return state.goods.map(row=>({...row}));},
    getReviewGoods(runId,goodsId){
      const item=state.goods.find(row=>row.temu_goods_id===goodsId);
      if(!item) throw Object.assign(new Error('missing'),{code:'REVIEW_GOODS_NOT_FOUND'});
      return {...item,run:{...state.runs.get(runId)},candidates:state.candidates.get(goodsId).map(row=>({...row}))};
    },
  };
  const temuRepository={getTemuContext(goodsId){
    if(goodsId==='603') return {temu_goods_id:goodsId,temu_context_status:'MISSING',temu_title:null};
    return {temu_goods_id:goodsId,temu_context_status:'AVAILABLE',temu_title:`Temu ${goodsId}`,level1:'L1'};
  }};
  return {state,sourcingRepository,temuRepository};
}

function candidate(goodsId,rank,productId,imageStatus) {
  return {
    temu_goods_id:goodsId,random_sample_rank:rank,candidate_rank:rank,
    original_rank:rank*10,'1688_product_id':productId,image_download_status:imageStatus,
  };
}

test('bootstrap pins completed run, joins Temu context and conserves mutually exclusive statuses',()=>{
  const {sourcingRepository,temuRepository}=fixture();
  const service=createSourcingReviewService({
    sourcingRepository,temuRepository,runId:'run-fixed',expectedGoods:3,expectedCandidates:4,
  });
  const result=service.bootstrap({filter:'ALL'});
  assert.deepEqual({
    run_id:result.run_id,total_goods:result.total_goods,awaiting_review:result.awaiting_review,
    confirmed:result.confirmed,no_selection:result.no_selection,image_failed_goods:result.image_failed_goods,
  },{run_id:'run-fixed',total_goods:3,awaiting_review:1,confirmed:1,no_selection:1,image_failed_goods:1});
  assert.equal(result.total_goods,result.awaiting_review+result.confirmed+result.no_selection);
  assert.deepEqual(result.goods.map(row=>row.temu_title),['Temu 601','Temu 602',null]);
  assert.equal(result.goods[2].temu_context_status,'MISSING');
});

test('filters and previous next navigation use the stable filtered goods order',()=>{
  const {sourcingRepository,temuRepository}=fixture();
  const service=createSourcingReviewService({sourcingRepository,temuRepository,runId:'run-fixed',expectedGoods:3,expectedCandidates:4});
  assert.deepEqual(service.bootstrap({filter:'PENDING'}).goods.map(x=>x.temu_goods_id),['601']);
  assert.deepEqual(service.bootstrap({filter:'CONFIRMED'}).goods.map(x=>x.temu_goods_id),['602']);
  assert.deepEqual(service.bootstrap({filter:'IMAGE_FAILED'}).goods.map(x=>x.temu_goods_id),['601']);
  assert.deepEqual(service.navigation({temuGoodsId:'602',filter:'ALL'}),{previous_goods_id:'601',next_goods_id:'603'});
  assert.deepEqual(service.navigation({temuGoodsId:'601',filter:'PENDING'}),{previous_goods_id:null,next_goods_id:null});
});

test('goods detail preserves stable Random5 order and missing Temu context',()=>{
  const {sourcingRepository,temuRepository}=fixture();
  const service=createSourcingReviewService({sourcingRepository,temuRepository,runId:'run-fixed',expectedGoods:3,expectedCandidates:4});
  assert.deepEqual(service.goodsDetail('601').candidates.map(x=>x.random_sample_rank),[1,2]);
  assert.equal(service.goodsDetail('603').temu_context.temu_context_status,'MISSING');
});

test('service rejects unfinished runs and V1 count drift',()=>{
  const unfinished=fixture({status:'RUNNING'});
  assert.throws(()=>createSourcingReviewService({
    sourcingRepository:unfinished.sourcingRepository,temuRepository:unfinished.temuRepository,
    runId:'run-fixed',expectedGoods:3,expectedCandidates:4,
  }).bootstrap(),error=>error.code==='REVIEW_RUN_NOT_COMPLETED');
  const valid=fixture();
  assert.throws(()=>createSourcingReviewService({
    sourcingRepository:valid.sourcingRepository,temuRepository:valid.temuRepository,
    runId:'run-fixed',expectedGoods:50,expectedCandidates:250,
  }).bootstrap(),error=>error.code==='REVIEW_V1_COUNT_MISMATCH');
});

test('a newly inserted run never changes the fixed session run',()=>{
  const {state,sourcingRepository,temuRepository}=fixture();
  const service=createSourcingReviewService({sourcingRepository,temuRepository,runId:'run-fixed',expectedGoods:3,expectedCandidates:4});
  assert.equal(service.bootstrap().run_id,'run-fixed');
  state.runs.set('run-new',{run_id:'run-new',import_status:'COMPLETED',status:'COMPLETED'});
  assert.equal(service.bootstrap().run_id,'run-fixed');
  assert.equal(service.fixedRunId,'run-fixed');
});

test('bootstrap and detail expose deterministic run-bound groups prices and opportunities',()=>{
  const {sourcingRepository,temuRepository}=fixture();
  sourcingRepository.getReviewGoods('run-fixed','601').candidates;
  const original=sourcingRepository.getReviewGoods.bind(sourcingRepository);
  sourcingRepository.getReviewGoods=(run,id)=>{
    const value=original(run,id);
    return {...value,candidates:value.candidates.map(row=>({...row,supplier_title:row['1688_product_id']==='p1'?'10pcs clips':'single clip',price_rmb:8}))};
  };
  const itemsByGoodsId=new Map([
    ['601',workbook('601','Pack of 10 clips',12,'夹子')],['602',workbook('602','5pcs clips',10,'夹子')],
    ['603',workbook('603','37L bag',20,null)],
  ]);
  const service=createSourcingReviewService({sourcingRepository,temuRepository,runId:'run-fixed',expectedGoods:3,expectedCandidates:4,
    opportunityContext:{itemsByGoodsId,fx:{status:'AVAILABLE',eur_per_cny:.12,cny_per_eur:8.333333,source:'TEST',as_of:'2026-09-01'}},
  });
  const bootstrap=service.bootstrap();
  assert.deepEqual(bootstrap.goods.slice(0,2).map(x=>[x.group_label,x.group_item_count,x.temu_listed_price_eur,x.temu_pack_quantity,x.temu_unit_price_eur]),[
    ['夹子',2,12,10,1.2],['夹子',2,10,5,2],
  ]);
  const detail=service.goodsDetail('601');
  assert.equal(detail.group_context.item_count,2);assert.equal(detail.group_context.metrics.group_min_unit_price_eur,1.2);
  assert.deepEqual(detail.group_context.items.map(x=>x.temu_goods_id),['601','602']);
  assert.equal(detail.fx_context.cny_per_eur,8.333333);
  assert.equal(detail.temu_context.temu_price_source,'RUN_SELECTED_WORKBOOK_SHEET05');
  assert.equal(detail.candidates[0].supplier_pack_quantity,10);
  assert.equal(detail.candidates[0].opportunity_ratio,12.5);
  assert.equal(detail.candidates[0].opportunity_band,'HIGH');
});

function workbook(id,title,price,cluster){return {temu_goods_id:id,temu_title:title,temu_listed_price_eur:price,temu_currency:'EUR',temu_price_source:'RUN_SELECTED_WORKBOOK_SHEET05',temu_price_source_id:'source',similar_cluster:cluster,level1:'L1',level2:'L2',level3:'L3'};}
