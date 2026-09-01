import {createReviewConsoleState} from './sourcing-review-state.js';

const RUN_ID=new URLSearchParams(location.search).get('run_id');
const INITIAL_GOODS_ID=new URLSearchParams(location.search).get('goods_id');
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
const review=RUN_ID?createReviewConsoleState({api,runId:RUN_ID,initialGoodsId:INITIAL_GOODS_ID,openWindow:window.open.bind(window)}):null;

function text(tag,value,className) {
  const node=document.createElement(tag);
  if(className) node.className=className;
  node.textContent=value??'—';
  return node;
}
function field(label,value) { return `${label}：${value??'—'}`; }
function number(value,digits=2) { return Number.isFinite(Number(value))?Number(value).toFixed(digits):'—'; }
function money(value,currency) { return Number.isFinite(Number(value))?`${currency==='CNY'?'¥':'€'}${number(value)}`:'—'; }
function productId(row) { return String(row?.['1688_product_id']??row?.supplier_product_id??''); }
function supplierImage(goodsId,row) {
  const params=new URLSearchParams({run_id:RUN_ID});
  return `/api/sourcing/review/images/supplier/${encodeURIComponent(goodsId)}/${encodeURIComponent(productId(row))}?${params}`;
}
function temuImage(goodsId) {
  return `/api/sourcing/review/images/temu/${encodeURIComponent(goodsId)}?run_id=${encodeURIComponent(RUN_ID)}`;
}
function visualImage(goodsId,fingerprint) { const params=new URLSearchParams({run_id:RUN_ID,index_fingerprint:fingerprint});return `/api/sourcing/review/visual-index/images/${encodeURIComponent(goodsId)}?${params}`; }
function image(src,alt) {
  const img=document.createElement('img'); img.src=src; img.alt=alt; img.loading='lazy';
  img.addEventListener('error',()=>{const missing=text('span','MISSING','status error');img.replaceWith(missing);},{once:true});
  return img;
}

function render() {
  if(!review){$('reviewRunId').textContent='未指定';$('reviewNotice').textContent='缺少 run_id，请从 YingDao 运营台选择一个 Review Run。';document.querySelectorAll('button,textarea').forEach(node=>node.disabled=true);return;}
  const state=review.snapshot(),summary=state.bootstrap,detail=state.detail,candidate=state.currentCandidate;
  $('reviewRunId').textContent=RUN_ID;
  $('metricTotal').textContent=summary?.total_goods??0;
  $('metricPending').textContent=summary?.awaiting_review??0;
  $('metricConfirmed').textContent=summary?.confirmed??0;
  $('metricNoSelection').textContent=summary?.no_selection??0;
  $('reviewNotice').textContent=state.notice??'';
  document.querySelectorAll('[data-filter]').forEach(button=>button.classList.toggle('active',button.dataset.filter===state.filter));
  renderGoods(state); renderTemu(detail); renderOpportunity(state); renderCandidates(state); renderDetail(candidate,detail);
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
    copy.append(text('span',`${item.group_label??'未可靠分组'} · ${item.group_item_count??1}款`,'meta'));
    copy.append(text('span',`标价 ${money(item.temu_listed_price_eur,'EUR')} · 单个 ${money(item.temu_unit_price_eur,'EUR')}${item.temu_quantity_confidence==='LOW'||item.quantity_confidence==='LOW'?' (推定)':''}`,'meta'));
    if(item.image_failed) copy.append(text('span','图片失败','status error'));
    button.append(copy); button.addEventListener('click',()=>act(()=>review.selectGoods(id,{confirmDiscard:confirmDiscardNote}))); root.append(button);
  }
}

function renderTemu(detail) {
  const root=$('currentTemu'); root.replaceChildren(); if(!detail) return;
  const context=detail.temu_context??{},id=detail.temu_goods_id;
  root.append(image(temuImage(id),`Temu ${id}`));
  const copy=document.createElement('div'); copy.append(text('h2',context.temu_title??'MISSING'));
  for(const value of [field('goods_id',id),field('复核状态',detail.review_status),field('Temu标价',money(context.temu_listed_price_eur,'EUR')),field('包装数量',context.temu_pack_quantity),field('Temu单个价',`${money(context.temu_unit_price_eur,'EUR')} / 件`),field('数量依据',context.quantity_source),field('解析置信度',context.quantity_confidence),field('价格来源',context.temu_price_source),field('同类',`${context.group_label??'未可靠分组'} (${detail.group_context?.item_count??1}款)`),field('分组依据',`${context.group_source??'—'} / ${context.group_confidence??'—'}`),field('分类',[context.level1,context.level2,context.level3].filter(Boolean).join(' / ')||null),field('上下文',context.temu_context_status)]) copy.append(text('p',value,'meta'));
  root.append(copy);
}

function renderOpportunity(state) {
  const detail=state.detail,result=state.visualResult,index=result?.index;
  const toggle=$('reviewOpportunityToggle'),panel=$('reviewOpportunityPanel'),summary=$('reviewOpportunitySummary'),items=$('reviewOpportunityItems'),benchmark=$('reviewOpportunityBenchmark');
  summary.replaceChildren();items.replaceChildren();benchmark.replaceChildren();
  if(!detail){toggle.disabled=true;panel.hidden=true;return;}toggle.disabled=false;toggle.setAttribute('aria-expanded',String(state.visualExpanded));toggle.textContent=state.visualExpanded?'收起视觉相似商品':'展开视觉相似商品';panel.hidden=!state.visualExpanded;
  if(state.visualLoading){summary.append(text('strong','视觉索引查询中…'));return;}if(state.visualError){summary.append(text('strong',`视觉索引错误：${state.visualError}`,'status error'));return;}if(!result){summary.append(text('strong','Excel视觉相似商品'),text('span','展开后从当前 run 绑定的 05_细分商品明细全量索引中检索','meta'));return;}if(index?.status!=='READY'){summary.append(text('strong',`视觉索引：${index?.status??'NOT_BUILT'}`),text('span','请先运行 YingDao 视觉索引构建','meta'));return;}
  const m=result.market_metrics??{};summary.append(text('strong',`Excel视觉相似商品 · 命中 ${result.search?.match_count??0}`),text('span',`来源：05_细分商品明细 · 检索范围 ${index.universe_goods_count}款 · 可用图片 ${index.universe_image_count}张 · 模型 ${index.model_id} r${index.model_revision}`,'meta'),text('span',`其他相似最低 ${money(m.min_other_listed_price_eur,'EUR')} · 最低可靠单价 ${money(m.min_reliable_unit_price_eur,'EUR')} · 中位数 ${money(m.median_reliable_unit_price_eur,'EUR')}`,'meta'));
  const thumbs=document.createElement('div');thumbs.className='opportunity-thumbs';
  for(const item of (result.matches??[]).slice(0,6)){const img=image(visualImage(item.goods_id,index.index_fingerprint),`视觉匹配 ${item.goods_id}`);img.addEventListener('click',()=>{review.previewVisualImage(item.goods_id);render();});thumbs.append(img);}summary.append(thumbs);$('reviewOpportunitySort').hidden=true;
  for(const item of (result.matches??[]).slice(0,20)){const card=document.createElement('article');card.className='opportunity-item';const img=image(visualImage(item.goods_id,index.index_fingerprint),`视觉匹配 ${item.goods_id}`);img.addEventListener('click',()=>{review.previewVisualImage(item.goods_id);render();});card.append(img,text('strong',item.title??item.goods_id),text('p',[field('goods_id',item.goods_id),field('视觉相似度',number(item.final_similarity_score,3)),field('匹配原因',item.match_reason),field('Temu标价',money(item.price_eur,'EUR')),field('销量',item.sales_count),field('评分',item.rating),field('生命周期',item.review_plan_status)].join('\n'),'meta'));if(item.navigation_action==='SWITCH_CURRENT_RUN'){const button=text('button','切换到此商品复核');button.addEventListener('click',()=>act(()=>review.switchVisualCurrentRun(item.goods_id,{confirmDiscard:confirmDiscardNote})));card.append(button);}else if(item.navigation_action==='OPEN_OTHER_RUN'){const button=text('button',`打开 Batch ${item.review_batch_number??''} 复核`);button.addEventListener('click',()=>review.openVisualOtherRun(item.goods_id));card.append(button);}else card.append(text('span','尚未生成1688候选','status'));items.append(card);}
  benchmark.append(text('strong','视觉相似市场价格基准'),text('span',`当前商品 ${money(m.anchor_listed_price_eur,'EUR')} · 其他视觉相似最低 ${money(m.min_other_listed_price_eur,'EUR')} · 视觉市场最低可靠单价 ${money(m.min_reliable_unit_price_eur,'EUR')} · 中位数 ${money(m.median_reliable_unit_price_eur,'EUR')} · 可靠样本 ${m.reliable_unit_price_count??0}`,'meta'));
  const preview=$('reviewOpportunityPreview'),previewImage=$('reviewOpportunityPreviewImage');preview.hidden=!state.visualPreviewGoodsId;if(state.visualPreviewGoodsId)previewImage.src=visualImage(state.visualPreviewGoodsId,index.index_fingerprint);
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
      field('包装数',row.supplier_pack_quantity),field('采购单价CNY',money(row.supplier_unit_price_cny,'CNY')),field('采购单价EUR',money(row.supplier_unit_price_eur,'EUR')),
      field('价格倍率',row.opportunity_ratio===null?null:`${number(row.opportunity_ratio,1)}x`),field('机会标签',row.opportunity_band),
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
    field('价格区间',`${money(row.supplier_price_low_cny,'CNY')} - ${money(row.supplier_price_high_cny,'CNY')}`),field('价格依据',row.supplier_price_basis),field('包装数',row.supplier_pack_quantity),field('包装置信',row.supplier_quantity_confidence),field('采购单价CNY',money(row.supplier_unit_price_cny,'CNY')),field('采购单价EUR',money(row.supplier_unit_price_eur,'EUR')),field('Temu同类最低单价',money(detail.group_context?.metrics?.group_min_unit_price_eur,'EUR')),field('价格倍率',row.opportunity_ratio===null?null:`${number(row.opportunity_ratio,1)}x`),field('机会标签',row.opportunity_band),field('需要检查',(row.opportunity_reasons??[]).join(', ')||null),
    field('月销',row.monthly_sales),field('累计销量',row.cumulative_sales),field('店铺',row.shop_name),field('店铺资质',row.shop_qualification),
    field('图片状态',row.image_download_status),field('复核状态',Number(row.review_excluded)===1?'已排除':Number(row.selected_candidate)===1?'已选定':'待复核'),
  ];
  for(const value of values) root.append(text('p',value,'meta'));
  $('operatorNote').value=row.operator_note??'';
  $('selectCandidate').disabled=Number(row.review_excluded)===1;
  $('excludeCandidate').hidden=Number(row.review_excluded)===1;
  $('restoreCandidate').hidden=Number(row.review_excluded)!==1;
}

function sortedGroupItems(items,sort,currentGoodsId) { const rows=[...items],id=x=>String(x.temu_goods_id),num=x=>Number.isFinite(Number(x))?Number(x):Infinity;if(sort==='GOODS_ID')return rows.sort((a,b)=>id(a).localeCompare(id(b)));if(sort==='LISTED_PRICE')return rows.sort((a,b)=>num(a.temu_listed_price_eur)-num(b.temu_listed_price_eur)||id(a).localeCompare(id(b)));if(sort==='UNIT_PRICE')return rows.sort((a,b)=>num(a.temu_unit_price_eur)-num(b.temu_unit_price_eur)||id(a).localeCompare(id(b)));return rows.sort((a,b)=>(id(a)===currentGoodsId?-1:0)-(id(b)===currentGoodsId?-1:0)||num(a.temu_unit_price_eur)-num(b.temu_unit_price_eur)||id(a).localeCompare(id(b)));}
function confirmDiscardNote() { return globalThis.confirm?.('人工备注尚未保存，确定放弃并切换商品吗？')??false; }

async function act(operation) {
  try { await operation(); } catch(error) { $('reviewNotice').textContent=error.message; }
  render();
}

document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>act(()=>review.load(button.dataset.filter))));
$('reviewPrev').addEventListener('click',()=>act(()=>review.previous({confirmDiscard:confirmDiscardNote}))); $('reviewNext').addEventListener('click',()=>act(()=>review.next({confirmDiscard:confirmDiscardNote})));
$('openSupplierLink').addEventListener('click',()=>act(()=>review.openLink()));
$('selectCandidate').addEventListener('click',()=>act(()=>review.selectCandidate())); $('clearSelection').addEventListener('click',()=>act(()=>review.clearSelection()));
$('excludeCandidate').addEventListener('click',()=>act(()=>review.excludeCandidate())); $('restoreCandidate').addEventListener('click',()=>act(()=>review.restoreCandidate()));
$('saveNote').addEventListener('click',()=>act(()=>review.saveNote($('operatorNote').value)));
$('operatorNote').addEventListener('input',()=>review.setNoteDirty(true));
$('reviewOpportunityToggle').addEventListener('click',()=>act(()=>review.toggleVisual()));
$('reviewOpportunitySort').addEventListener('change',event=>{review.setGroupSort(event.target.value);render();});
$('reviewOpportunityPreviewClose').addEventListener('click',()=>{review.closeVisualPreview();render();});
if(review)act(()=>review.load());else render();
