import test from 'node:test';
import assert from 'node:assert/strict';
import {createTemuMarketEvidenceState} from '../../ui/temu-market-evidence-state.js';

const session=(goods='1',overrides={})=>({session_id:`s-${goods}`,review_run_id:'r',anchor_temu_goods_id:goods,query:`frozen-${goods}`,status:'CREATED',revision:0,created_at:'2026-09-03T00:00:00Z',...overrides});

test('all three query drafts and selected slot survive ordinary state emissions',async()=>{
  const state=createTemuMarketEvidenceState({api:{list:async()=>[]},runId:'r'});
  await state.selectGoods('1',{suggestedQuery:'suggested'});
  state.setQueryDraft('1','operator one');state.setQueryDraft('2','operator two');state.setQueryDraft('3','运营 三');state.selectQuerySlot('3');state.setCalculator({price:1});
  assert.deepEqual(state.snapshot().queryDrafts,{'1':'operator one','2':'operator two','3':'运营 三'});assert.equal(state.snapshot().selectedQuerySlot,'3');assert.equal(state.selectedQuery(),'运营 三');
});

test('late session list and detail never overwrite a newer draft or goods selection',async()=>{
  let resolveList,resolveDetail,goodsOneLists=0;const api={list:(run,goods)=>goods==='1'&&goodsOneLists++===0?new Promise(resolve=>resolveList=resolve):Promise.resolve(goods==='2'?[session('2')]:[]),get:(run,goods)=>goods==='2'?new Promise(resolve=>resolveDetail=resolve):Promise.resolve({session:session(goods),phases:[]})};
  const state=createTemuMarketEvidenceState({api,runId:'r'}),first=state.selectGoods('1',{suggestedQuery:'A'});state.setQueryDraft('1','edited while loading');resolveList([]);await first;assert.equal(state.selectedQuery(),'edited while loading');
  const second=state.selectGoods('2',{suggestedQuery:'B'});state.setQueryDraft('2','edited B');await Promise.resolve();const back=state.selectGoods('1',{suggestedQuery:'new A'});resolveDetail({session:session('2'),phases:[{phase:'BEFORE'}]});await second;await back;
  assert.equal(state.snapshot().currentGoodsId,'1');assert.equal(state.selectedQuery(),'edited while loading');assert.equal(state.snapshot().evidence,null);
});

test('goods drafts are cached by run and goods and never leak across goods',async()=>{
  const state=createTemuMarketEvidenceState({api:{list:async()=>[]},runId:'r'});await state.selectGoods('A',{suggestedQuery:'suggest A'});state.setQueryDraft('2','draft A');state.selectQuerySlot('2');
  await state.selectGoods('B',{suggestedQuery:'suggest B'});assert.equal(state.selectedQuery(),'suggest B');state.setQueryDraft('1','draft B');await state.selectGoods('A',{suggestedQuery:'replacement'});assert.equal(state.snapshot().selectedQuerySlot,'2');assert.equal(state.selectedQuery(),'draft A');
});

test('copy freezes selected query, preserves drafts and owns success or failure feedback',async()=>{
  const copied=[],state=createTemuMarketEvidenceState({api:{list:async()=>[]},runId:'r'});await state.selectGoods('1');state.setQueryDraft('2',' exact query ');state.selectQuerySlot('2');await state.copySelectedQuery({writeText:async value=>copied.push(value)});
  assert.deepEqual(copied,['exact query']);assert.equal(state.snapshot().queryDrafts['2'],' exact query ');assert.match(state.snapshot().notice.message,/已复制搜索词：exact query/);
  await state.copySelectedQuery({writeText:async()=>{throw Object.assign(new Error('denied'),{code:'NotAllowedError'});},fallback:()=>false});assert.equal(state.snapshot().queryDrafts['2'],' exact query ');assert.match(state.snapshot().notice.message,/复制失败/);assert.equal(state.snapshot().notice.code,'NotAllowedError');
});

test('empty query blocks create and duplicate clicks coalesce while loading',async()=>{
  let calls=0,resolveCreate;const api={list:async()=>[],create:()=>{calls++;return new Promise(resolve=>resolveCreate=resolve);}},state=createTemuMarketEvidenceState({api,runId:'r'});await state.selectGoods('1');await assert.rejects(()=>state.createSession(),error=>error.code==='EVIDENCE_QUERY_REQUIRED');assert.equal(calls,0);
  state.setQueryDraft('1','operator query');const first=state.createSession(),second=state.createSession();assert.equal(first,second);assert.equal(state.snapshot().action.loading,true);assert.equal(state.snapshot().action.type,'CREATE_SESSION');resolveCreate({session:session('1',{query:'operator query'}),bindToken:'token'});await first;
  assert.equal(calls,1);assert.equal(state.selectedQuery(),'operator query');assert.equal(state.snapshot().bindToken,'token');assert.match(state.snapshot().notice.message,/证据会话创建成功/);
});

test('create failure keeps query and exposes technical code',async()=>{
  const api={list:async()=>[],create:async()=>{throw Object.assign(new Error('server down'),{code:'HTTP_500'});}},state=createTemuMarketEvidenceState({api,runId:'r'});await state.selectGoods('1');state.setQueryDraft('1','keep me');await assert.rejects(()=>state.createSession(),/server down/);
  assert.equal(state.selectedQuery(),'keep me');assert.equal(state.snapshot().action.loading,false);assert.equal(state.snapshot().notice.code,'HTTP_500');assert.match(state.snapshot().notice.message,/创建证据会话失败/);
});

test('writable-session conflict reloads and continues existing without changing either query',async()=>{
  let listCalls=0;const existing=session('1',{query:'old frozen',revision:2,status:'BEFORE_CAPTURED'});const api={list:async()=>{listCalls++;return listCalls===1?[]:[existing];},get:async()=>({session:existing,phases:[{phase:'BEFORE'}],delta:{added:[]}}),create:async()=>{throw Object.assign(new Error('exists'),{status:409,code:'EVIDENCE_SESSION_ALREADY_WRITABLE'});}};
  const state=createTemuMarketEvidenceState({api,runId:'r'});await state.selectGoods('1');state.setQueryDraft('1','new draft');const result=await state.createSession();assert.equal(result.existing,true);assert.equal(state.selectedQuery(),'new draft');assert.equal(state.snapshot().session.query,'old frozen');assert.match(state.snapshot().notice.message,/已有未完成/);
});

test('explicit and focus refresh load current phase detail without changing drafts',async()=>{
  let gets=0;const current=session('1',{status:'AFTER_CAPTURED',revision:3});const api={list:async()=>[current],get:async()=>{gets++;return{session:current,phases:[{phase:'BEFORE',card_count:2},{phase:'AFTER',card_count:4}],delta:{added:['3','4'],removed:[],retained:['1','2']}};}},state=createTemuMarketEvidenceState({api,runId:'r'});
  await state.selectGoods('1');state.setQueryDraft('3','draft three');await state.refreshEvidence({reason:'FOCUS'});assert.equal(gets,2);assert.equal(state.snapshot().queryDrafts['3'],'draft three');assert.equal(state.snapshot().evidence.phases.length,2);assert.match(state.snapshot().notice.message,/证据状态已刷新/);
});

test('save and next performs no automatic open search or session creation',async()=>{const calls=[];const active=session('1',{status:'AFTER_CAPTURED',revision:3});const api={saveAssessment:async x=>(calls.push(['save',x]),{}),list:async()=>[active],get:async()=>({session:active,phases:[]})},state=createTemuMarketEvidenceState({api,runId:'r'});await state.selectGoods('1');await state.saveAndNext({sessionId:'s-1',expectedRevision:3,assessment:{},next:async()=>calls.push(['next'])});assert.deepEqual(calls.map(x=>x[0]),['save','next']);});

test('explicit token reissue keeps the same session and exposes the new token',async()=>{const active=session('1',{status:'BOUND',revision:1}),calls=[],api={list:async()=>[active],get:async()=>({session:active,phases:[]}),reissue:async body=>(calls.push(body),{session:{...active,revision:2},bindToken:'replacement'})},state=createTemuMarketEvidenceState({api,runId:'r'});await state.selectGoods('1');await state.reissueBindToken();assert.equal(calls[0].session_id,'s-1');assert.equal(calls[0].expected_revision,1);assert.equal(state.snapshot().session.revision,2);assert.equal(state.snapshot().bindToken,'replacement');assert.match(state.snapshot().notice.message,/新绑定码/);});
