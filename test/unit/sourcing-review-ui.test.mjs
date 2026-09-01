import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createReviewConsoleState} from '../../ui/sourcing-review-state.js';

const RUN='yingdao_random5_v1_20260831_001';

function detail(goodsId='g1',revision=0) {
  return {
    run_id:RUN,temu_goods_id:goodsId,review_status:'PENDING',review_revision:revision,
    temu_context:{temu_context_status:'FOUND',temu_title:`Temu ${goodsId}`,level1:'L1'},
    candidates:[5,1,3,2,4].map(rank=>({
      '1688_product_id':`p${rank}`,random_sample_rank:rank,original_rank:rank*10,
      '1688_title':`Supplier ${rank}`,review_excluded:0,selected_candidate:null,
    })),
  };
}

function fixtureApi({conflict=false}={}) {
  const calls=[];
  let current=detail();
  return {
    calls,
    async request(path,options={}) {
      calls.push({path,options});
      if(path.includes('/bootstrap')) return {
        run_id:RUN,total_goods:2,awaiting_review:2,confirmed:0,no_selection:0,
        filter:new URL(`http://local${path}`).searchParams.get('filter')??'ALL',
        goods:[
          {temu_goods_id:'g1',temu_title:'Temu g1',review_status:'PENDING',image_failed:false},
          {temu_goods_id:'g2',temu_title:'Temu g2',review_status:'PENDING',image_failed:true},
        ],
      };
      if(path.includes('/goods/g1?')||path.includes('/goods/g2?')) return detail(path.includes('/goods/g2?')?'g2':'g1',current.review_revision);
      if(path.includes('/open-link')) return {url:'https://detail.1688.com/offer/123.html'};
      if(conflict&&options.method&&options.method!=='GET') {
        conflict=false;
        throw Object.assign(new Error('changed'),{status:409,code:'REVIEW_CONFLICT'});
      }
      current={...current,review_revision:current.review_revision+1};
      return current;
    },
  };
}

test('loads the pinned run, sorts Random5 and navigates the filtered list',async()=>{
  const api=fixtureApi();
  const state=createReviewConsoleState({api,runId:RUN});
  await state.load('ALL');
  assert.equal(state.snapshot().currentGoodsId,'g1');
  assert.deepEqual(state.snapshot().detail.candidates.map(row=>row.random_sample_rank),[1,2,3,4,5]);
  await state.next();
  assert.equal(state.snapshot().currentGoodsId,'g2');
  await state.previous();
  assert.equal(state.snapshot().currentGoodsId,'g1');
});

test('candidate mutations carry identity and optimistic revision',async()=>{
  const api=fixtureApi();
  const state=createReviewConsoleState({api,runId:RUN});
  await state.load();
  state.chooseCandidate('p1');
  await state.selectCandidate();
  await state.clearSelection();
  await state.excludeCandidate();
  await state.restoreCandidate();
  await state.saveNote('checked');
  const mutations=api.calls.filter(call=>call.options.method&&call.options.method!=='GET');
  assert.deepEqual(mutations.map(call=>call.options.method),['POST','POST','POST','POST','PUT']);
  assert.ok(mutations.every(call=>call.options.body.run_id===RUN&&call.options.body.temu_goods_id==='g1'));
  assert.equal(mutations.at(-1).options.body.operator_note,'checked');
});

test('409 reloads current goods once and never retries the mutation',async()=>{
  const api=fixtureApi({conflict:true});
  const state=createReviewConsoleState({api,runId:RUN});
  await state.load();
  state.chooseCandidate('p1');
  const result=await state.selectCandidate();
  assert.equal(result.conflict,true);
  assert.match(state.snapshot().notice,/已变化/);
  assert.equal(api.calls.filter(call=>call.path.endsWith('/select')).length,1);
  assert.equal(api.calls.filter(call=>call.path.includes('/goods/g1?')).length,2);
});

test('opening a link resolves the selected database identity through the API',async()=>{
  const api=fixtureApi();
  const opened=[];
  const state=createReviewConsoleState({api,runId:RUN,openWindow:(...args)=>opened.push(args)});
  await state.load();
  state.chooseCandidate('p2');
  await state.openLink();
  assert.match(api.calls.at(-1).path,/goods\/g1\/candidates\/p2\/open-link\?run_id=/);
  assert.deepEqual(opened,[['https://detail.1688.com/offer/123.html','_blank','noopener,noreferrer']]);
});

test('review page is independent, three-column and linked from the operator homepage',()=>{
  const html=readFileSync(new URL('../../ui/sourcing-review.html',import.meta.url),'utf8');
  const home=readFileSync(new URL('../../ui/index.html',import.meta.url),'utf8');
  const yingdaoPanel=readFileSync(new URL('../../ui/modules/yingdao/panel.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../ui/sourcing-review.css',import.meta.url),'utf8');
  for(const id of ['goodsList','currentTemu','candidateGrid','candidateDetail','reviewPrev','reviewNext']) assert.match(html,new RegExp(`id="${id}"`));
  for(const label of ['打开1688链接','设为最终候选','取消最终选择','排除候选','恢复候选','保存人工备注']) assert.match(html,new RegExp(label));
  assert.match(home,/id="yingdao-module-root"/);
  assert.match(yingdaoPanel,/buildSourcingReviewUrl/);
  assert.doesNotMatch(yingdaoPanel,/href="\/sourcing-review\.html"[^?]/);
  const mobile=css.slice(css.lastIndexOf('@media(max-width:700px)'));
  assert.match(mobile,/\.goods-panel\{max-height:\d+vh\}/);
});

test('review page contains accessible opportunity accordion benchmark preview and explicit switch controls',()=>{
  const html=readFileSync(new URL('../../ui/sourcing-review.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../../ui/sourcing-review.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../../ui/sourcing-review.css',import.meta.url),'utf8');
  for(const id of ['reviewOpportunityToggle','reviewOpportunityPanel','reviewOpportunitySummary','reviewOpportunityItems','reviewOpportunityBenchmark','reviewOpportunityPreview']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/aria-expanded="false"/);assert.match(html,/aria-controls="reviewOpportunityPanel"/);assert.match(html,/role="region"/);
  assert.match(html,/价格倍率仅比较 Temu 商品价与 1688 采购价/);
  assert.match(js,/切换到此商品复核/);assert.match(js,/previewVisualImage/);assert.match(js,/opportunity_band/);assert.match(js,/Excel视觉相似商品/);
  assert.match(js,/value===null\|\|value===undefined\|\|value===''/,'missing prices must render as unavailable, never zero');
  assert.match(css,/\.opportunity-items\{[^}]*max-height:/);assert.match(css,/overflow:auto/);
});
