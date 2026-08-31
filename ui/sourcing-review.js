import {createReviewConsoleState} from './sourcing-review-state.js';

const RUN_ID=new URLSearchParams(location.search).get('run_id')||'yingdao_random5_v1_20260831_001';
const $=id=>document.getElementById(id);
const api={
  async request(path,options={}) {
    const response=await fetch(path,{
      method:options.method??'GET',
      headers:options.body?{'content-type':'application/json'}:undefined,
      body:options.body?JSON.stringify(options.body):undefined,
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw Object.assign(new Error(payload.error?.message??payload.message??`请求失败 (${response.status})`),{status:response.status,code:payload.error?.code??payload.code});
    return payload;
  },
};
const review=createReviewConsoleState({api,runId:RUN_ID,openWindow:window.open.bind(window)});

function text(tag,value,className) {
  const node=document.createElement(tag);
  if(className) node.className=className;
  node.textContent=value??'—';
  return node;
}
function field(label,value) { return `${label}：${value??'—'}`; }
function productId(row) { return String(row?.['1688_product_id']??row?.supplier_product_id??''); }
function supplierImage(goodsId,row) {
  const params=new URLSearchParams({run_id:RUN_ID});
  return `/api/sourcing/review/images/supplier/${encodeURIComponent(goodsId)}/${encodeURIComponent(productId(row))}?${params}`;
}
function temuImage(goodsId) {
  return `/api/sourcing/review/images/temu/${encodeURIComponent(goodsId)}?run_id=${encodeURIComponent(RUN_ID)}`;
}
function image(src,alt) {
  const img=document.createElement('img'); img.src=src; img.alt=alt; img.loading='lazy';
  img.addEventListener('error',()=>{const missing=text('span','MISSING','status error');img.replaceWith(missing);},{once:true});
  return img;
}

function render() {
  const state=review.snapshot(),summary=state.bootstrap,detail=state.detail,candidate=state.currentCandidate;
  $('reviewRunId').textContent=RUN_ID;
  $('metricTotal').textContent=summary?.total_goods??0;
  $('metricPending').textContent=summary?.awaiting_review??0;
  $('metricConfirmed').textContent=summary?.confirmed??0;
  $('metricNoSelection').textContent=summary?.no_selection??0;
  $('reviewNotice').textContent=state.notice??'';
  document.querySelectorAll('[data-filter]').forEach(button=>button.classList.toggle('active',button.dataset.filter===state.filter));
  renderGoods(state); renderTemu(detail); renderCandidates(state); renderDetail(candidate,detail);
  const ids=summary?.goods.map(row=>String(row.temu_goods_id))??[],index=ids.indexOf(state.currentGoodsId);
  $('reviewPrev').disabled=index<=0; $('reviewNext').disabled=index<0||index>=ids.length-1;
}

function renderGoods(state) {
  const root=$('goodsList'); root.replaceChildren();
  for(const item of state.bootstrap?.goods??[]) {
    const id=String(item.temu_goods_id),button=document.createElement('button');
    button.type='button'; button.className=`goods-item${id===state.currentGoodsId?' active':''}`;
    button.append(image(temuImage(id),`Temu ${id}`));
    const copy=document.createElement('span');
    copy.append(text('strong',id),text('span',item.temu_title??'Temu上下文缺失','meta'),text('span',item.review_status,'status'));
    if(item.image_failed) copy.append(text('span','图片失败','status error'));
    button.append(copy); button.addEventListener('click',()=>act(()=>review.selectGoods(id))); root.append(button);
  }
}

function renderTemu(detail) {
  const root=$('currentTemu'); root.replaceChildren(); if(!detail) return;
  const context=detail.temu_context??{},id=detail.temu_goods_id;
  root.append(image(temuImage(id),`Temu ${id}`));
  const copy=document.createElement('div'); copy.append(text('h2',context.temu_title??'MISSING'));
  for(const value of [field('goods_id',id),field('复核状态',detail.review_status),field('分类',[context.level1,context.level2,context.level3].filter(Boolean).join(' / ')||null),field('similar_cluster',context.similar_cluster),field('上下文',context.temu_context_status)]) copy.append(text('p',value,'meta'));
  root.append(copy);
}

function renderCandidates(state) {
  const root=$('candidateGrid'); root.replaceChildren();
  for(const row of state.detail?.candidates??[]) {
    const id=productId(row),button=document.createElement('button'); button.type='button';
    button.className=`candidate-card${id===state.currentProductId?' active':''}${Number(row.review_excluded)===1?' excluded':''}`;
    button.append(image(supplierImage(state.currentGoodsId,row),`1688 ${id}`),text('h3',row['1688_title']??row.supplier_title??id));
    const meta=[
      `#${row.random_sample_rank} · original ${row.original_rank??'—'}`,field('product_id',id),
      field('RMB',row.price_rmb??row.supplier_price_rmb),field('MOQ',row.moq),field('月销',row.monthly_sales),
      field('累计销量',row.cumulative_sales),field('店铺',row.shop_name),field('店铺资质',row.shop_qualification),
    ];
    button.append(text('p',meta.join('\n'),'meta'));
    if(Number(row.selected_candidate)===1) button.append(text('span','已选定','status'));
    if(Number(row.review_excluded)===1) button.append(text('span','已排除','status error'));
    button.addEventListener('click',()=>{review.chooseCandidate(id);render();}); root.append(button);
  }
}

function renderDetail(row,detail) {
  const root=$('candidateDetail'); root.replaceChildren();
  const disabled=!row;
  for(const id of ['openSupplierLink','selectCandidate','excludeCandidate','restoreCandidate','saveNote']) $(id).disabled=disabled;
  $('clearSelection').disabled=!detail?.candidates.some(item=>Number(item.selected_candidate)===1);
  if(!row) { root.append(text('p','请选择候选')); $('operatorNote').value=''; return; }
  root.append(image(supplierImage(detail.temu_goods_id,row),`1688 ${productId(row)}`));
  root.lastChild.className='detail-image';
  const values=[
    field('random_sample_rank',row.random_sample_rank),field('original_rank',row.original_rank),field('1688_product_id',productId(row)),
    field('标题',row['1688_title']??row.supplier_title),field('RMB价格',row.price_rmb??row.supplier_price_rmb),field('MOQ',row.moq),
    field('月销',row.monthly_sales),field('累计销量',row.cumulative_sales),field('店铺',row.shop_name),field('店铺资质',row.shop_qualification),
    field('图片状态',row.image_download_status),field('复核状态',Number(row.review_excluded)===1?'已排除':Number(row.selected_candidate)===1?'已选定':'待复核'),
  ];
  for(const value of values) root.append(text('p',value,'meta'));
  $('operatorNote').value=row.operator_note??'';
  $('selectCandidate').disabled=Number(row.review_excluded)===1;
  $('excludeCandidate').hidden=Number(row.review_excluded)===1;
  $('restoreCandidate').hidden=Number(row.review_excluded)!==1;
}

async function act(operation) {
  try { await operation(); } catch(error) { $('reviewNotice').textContent=error.message; }
  render();
}

document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>act(()=>review.load(button.dataset.filter))));
$('reviewPrev').addEventListener('click',()=>act(()=>review.previous())); $('reviewNext').addEventListener('click',()=>act(()=>review.next()));
$('openSupplierLink').addEventListener('click',()=>act(()=>review.openLink()));
$('selectCandidate').addEventListener('click',()=>act(()=>review.selectCandidate())); $('clearSelection').addEventListener('click',()=>act(()=>review.clearSelection()));
$('excludeCandidate').addEventListener('click',()=>act(()=>review.excludeCandidate())); $('restoreCandidate').addEventListener('click',()=>act(()=>review.restoreCandidate()));
$('saveNote').addEventListener('click',()=>act(()=>review.saveNote($('operatorNote').value)));
act(()=>review.load());
