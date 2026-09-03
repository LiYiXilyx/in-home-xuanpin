import {createReviewConsoleState} from './sourcing-review-state.js';
import {createTemuMarketEvidenceState} from './temu-market-evidence-state.js';

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
const review=RUN_ID?createReviewConsoleState({api,runId:RUN_ID,initialGoodsId:INITIAL_GOODS_ID,openWindow:window.open.bind(window),onChange:()=>render()}):null;
const evidenceApi={list:(run,goods)=>api.request(`/api/sourcing/review/goods/${encodeURIComponent(goods)}/evidence-sessions?run_id=${encodeURIComponent(run)}`),get:(run,goods,session)=>api.request(`/api/sourcing/review/goods/${encodeURIComponent(goods)}/evidence-sessions/${encodeURIComponent(session)}?run_id=${encodeURIComponent(run)}`),create:body=>api.request(`/api/sourcing/review/goods/${encodeURIComponent(body.anchor_temu_goods_id)}/evidence-sessions`,{method:'POST',body}),saveAssessment:body=>api.request(`/api/sourcing/review/goods/${encodeURIComponent(body.anchor_temu_goods_id)}/evidence-sessions/${encodeURIComponent(body.session_id)}/assessments`,{method:'POST',body})};
const evidence=RUN_ID?createTemuMarketEvidenceState({api:evidenceApi,runId:RUN_ID,onChange:()=>render()}):null;let evidenceGoods=null;

function text(tag,value,className) {
  const node=document.createElement(tag);
  if(className) node.className=className;
  node.textContent=value??'—';
  return node;
}
function field(label,value) { return `${label}：${value??'—'}`; }
function number(value,digits=2) { return Number.isFinite(Number(value))?Number(value).toFixed(digits):'—'; }
function money(value,currency) { return value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?`${currency==='CNY'?'¥':'€'}${number(value)}`:'—'; }
function productId(row) { return String(row?.['1688_product_id']??row?.supplier_product_id??''); }
function supplierImage(goodsId,row) {
  const params=new URLSearchParams({run_id:RUN_ID});
  return `/api/sourcing/review/images/supplier/${encodeURIComponent(goodsId)}/${encodeURIComponent(productId(row))}?${params}`;
}
function temuImage(goodsId) {
  return `/api/sourcing/review/images/temu/${encodeURIComponent(goodsId)}?run_id=${encodeURIComponent(RUN_ID)}`;
}
function visualDisplayImage(item) { return item?.display_image_url??null; }
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
  renderMarketEvidence(state);if(state.currentGoodsId&&state.currentGoodsId!==evidenceGoods){evidenceGoods=state.currentGoodsId;$('market-evidence-query-2').value='';$('market-evidence-query-3').value='';$('market-evidence-query-slot').value='1';queueMicrotask(()=>evidence.selectGoods(state.currentGoodsId,{suggestedQuery:detail?.temu_context?.temu_title??''}));}
  const ids=summary?.goods.map(row=>String(row.temu_goods_id))??[],index=ids.indexOf(state.currentGoodsId);
  $('reviewPrev').disabled=index<=0; $('reviewNext').disabled=index<0||index>=ids.length-1;
}

function renderMarketEvidence(reviewState){if(!evidence)return;const state=evidence.snapshot(),session=state.session,phases=state.evidence?.phases??[];$('market-evidence-query').value=state.query??'';$('market-evidence-session').textContent=session?`Session ${session.session_id} · ${session.status} · revision ${session.revision}`:'尚未创建 Session';$('market-evidence-before').textContent=`BEFORE：${phases.some(x=>x.phase==='BEFORE')?'已保存':'未保存'}`;$('market-evidence-after').textContent=`AFTER：${phases.some(x=>x.phase==='AFTER')?'已保存':'未保存'}`;$('market-evidence-create').disabled=!reviewState.currentGoodsId||Boolean(session&&session.status!=='CLOSED');$('market-evidence-copy-token').disabled=!state.bindToken;const root=$('market-evidence-results');root.replaceChildren();for(const phase of phases){const cards=JSON.parse(phase.cards_json??'[]');root.append(text('strong',`${phase.phase} · ${cards.length} 个商品`));for(const card of cards.slice(0,30)){const button=text('button',`${card.goods_id} · ${card.title??''} · ${money(card.price_eur,'EUR')}`);button.type='button';button.addEventListener('click',()=>{$('market-evidence-temu-price').value=card.price_eur??'';updateEvidenceRatio();});root.append(button);}}const writable=Boolean(session&&session.anchor_temu_goods_id===reviewState.currentGoodsId&&['AFTER_CAPTURED','ASSESSED'].includes(session.status));$('market-evidence-save').disabled=!writable;$('market-evidence-save-next').disabled=!writable;}
function assessmentInput(){return{temu_price_eur:Number($('market-evidence-temu-price').value),temu_pack_quantity:Number($('market-evidence-temu-pack').value),supplier_price_cny:Number($('market-evidence-supplier-price').value),supplier_pack_quantity:Number($('market-evidence-supplier-pack').value),moq:$('market-evidence-moq').value===''?null:Number($('market-evidence-moq').value),supplier_product_id:review.snapshot().currentProductId,evidence_phase:'AFTER'};}
function updateEvidenceRatio(){const fx=review.snapshot().detail?.fx_context,cny=Number($('market-evidence-supplier-price').value),sp=Number($('market-evidence-supplier-pack').value),eur=Number($('market-evidence-temu-price').value),tp=Number($('market-evidence-temu-pack').value),ratio=fx?.cny_per_eur>0&&cny>0&&sp>0&&eur>0&&tp>0?(eur/tp)/(cny/sp/fx.cny_per_eur):null;$('market-evidence-ratio').textContent=`价格倍率：${ratio?ratio.toFixed(2)+'x':'—'}`;}
function selectedEvidenceQuery(){const slot=$('market-evidence-query-slot').value;return $(slot==='1'?'market-evidence-query':`market-evidence-query-${slot}`).value.trim();}

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
  if(!state.currentGoodsId){toggle.disabled=true;panel.hidden=true;return;}toggle.disabled=false;toggle.setAttribute('aria-expanded',String(state.visualExpanded));toggle.textContent=state.visualExpanded?'收起视觉相似商品':'展开视觉相似商品';panel.hidden=!state.visualExpanded;
  if(state.visualLoading){summary.append(text('strong',`正在检索当前商品 ${state.currentGoodsId} 的视觉相似商品…`));return;}if(state.visualError){summary.append(text('strong',`视觉索引错误：${state.visualError}`,'status error'));return;}if(!result){summary.append(text('strong','Excel视觉相似商品'),text('span','当前商品尚未加载视觉相似结果','meta'));return;}if(index?.status!=='READY'){summary.append(text('strong',`视觉索引：${index?.status??'NOT_BUILT'}`),text('span','请先运行 YingDao 视觉索引构建','meta'));return;}if(state.visualState.status==='EMPTY'){summary.append(text('strong','当前商品没有达到阈值的视觉相似商品'));benchmark.append(text('strong','视觉相似市场价格基准'),text('span','无可用视觉市场参考','meta'));return;}
  const m=result.market_metrics??{},matchCount=m.visual_match_count??result.search?.match_count??0;
  summary.append(text('strong',`Excel视觉相似商品 · 命中 ${matchCount}`),text('span',`来源：05_细分商品明细 · 检索范围 ${index.universe_goods_count}款 · 可用图片 ${index.universe_image_count}张 · 模型 ${index.model_id} r${index.model_revision}`,'meta'),text('span',`视觉命中：${matchCount} · 有效标价：${m.other_listed_price_sample_count??0} · 可靠单价：${m.reliable_unit_price_sample_count??0} · 推定单价：${m.provisional_unit_price_sample_count??0}`,'meta'),text('span',`其他相似最低标价 ${money(m.other_min_listed_price_eur,'EUR')} · 其他相似标价中位数 ${money(m.other_median_listed_price_eur,'EUR')}`,'meta'),text('span',`可靠单价最低 ${money(m.min_reliable_unit_price_eur,'EUR')} · 可靠单价中位数 ${money(m.median_reliable_unit_price_eur,'EUR')} （可靠样本 ${m.reliable_unit_price_sample_count??0} / ${matchCount}）`,'meta'),text('span',`推定单价最低 ${money(m.min_provisional_unit_price_eur,'EUR')} · 推定单价中位数 ${money(m.median_provisional_unit_price_eur,'EUR')} · 样本 ${m.provisional_unit_price_sample_count??0}`,'meta'));
  if((m.other_listed_price_sample_count??0)===0)summary.append(text('span','视觉相似商品存在，但没有可用 EUR 标价。','status warning'));
  if((m.provisional_unit_price_sample_count??0)>0)summary.append(text('span','推定：未从标题或结构化字段确认包装数量，暂按单件计算。','status warning'));
  if(m.listed_price_includes_conflicts)summary.append(text('span','部分视觉匹配与分类/商品类型信息存在冲突。标价可用于人工参考，但不属于严格可靠的同款价格样本。','status warning'));
  const thumbs=document.createElement('div');thumbs.className='opportunity-thumbs';
  for(const item of (result.matches??[]).slice(0,6)){if(!visualDisplayImage(item))continue;const img=image(visualDisplayImage(item),`视觉匹配 ${item.goods_id}`);if(item.display_image_low_resolution)img.classList.add('low-resolution');img.addEventListener('click',()=>{review.previewVisualImage(item.goods_id);render();});thumbs.append(img);}summary.append(thumbs);$('reviewOpportunitySort').hidden=true;
  for(const item of (result.matches??[]).slice(0,20)){const card=document.createElement('article');card.className='opportunity-item';if(visualDisplayImage(item)){const img=image(visualDisplayImage(item),`视觉匹配 ${item.goods_id}`);if(item.display_image_low_resolution)img.classList.add('low-resolution');img.addEventListener('click',()=>{review.previewVisualImage(item.goods_id);render();});card.append(img);}else card.append(text('span','暂无图片','visual-image-placeholder'));if(item.display_image_low_resolution)card.append(text('span','预览图分辨率较低','status warning'));card.append(text('strong',item.title??item.goods_id),text('p',[field('goods_id',item.goods_id),field('图片来源',item.display_image_kind),field('视觉相似度',number(item.final_similarity_score,3)),field('匹配原因',item.match_reason),field('Temu标价',money(item.price_eur,'EUR')),field('销量',item.sales_count),field('评分',item.rating),field('生命周期',item.review_plan_status)].join('\n'),'meta'));if(item.navigation_action==='SWITCH_CURRENT_RUN'){const button=text('button','切换到此商品复核');button.addEventListener('click',()=>act(()=>review.switchVisualCurrentRun(item.goods_id,{confirmDiscard:confirmDiscardNote})));card.append(button);}else if(item.navigation_action==='OPEN_OTHER_RUN'){const button=text('button',`打开 Batch ${item.review_batch_number??''} 复核`);button.addEventListener('click',()=>review.openVisualOtherRun(item.goods_id));card.append(button);}else card.append(text('span','尚未生成1688候选','status'));items.append(card);}
  benchmark.append(text('strong','视觉相似市场价格基准'),text('span',`当前商品标价 ${money(m.anchor_listed_price_eur,'EUR')} · 其他相似最低标价 ${money(m.other_min_listed_price_eur,'EUR')} · 其他相似标价中位数 ${money(m.other_median_listed_price_eur,'EUR')}`,'meta'),text('span',`可靠单价最低 ${money(m.min_reliable_unit_price_eur,'EUR')} （${m.reliable_unit_price_sample_count??0} / ${matchCount}） · 推定单价最低 ${money(m.min_provisional_unit_price_eur,'EUR')} · 推定中位数 ${money(m.median_provisional_unit_price_eur,'EUR')}`,'meta'));
  const preview=$('reviewOpportunityPreview'),previewImage=$('reviewOpportunityPreviewImage'),previewItem=(result.matches??[]).find(item=>String(item.goods_id)===String(state.visualPreviewGoodsId));preview.hidden=!state.visualPreviewGoodsId;if(state.visualPreviewGoodsId&&previewItem?.display_image_url)previewImage.src=previewItem.display_image_url;
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
$('market-evidence-create').addEventListener('click',()=>act(()=>evidence.createSession(selectedEvidenceQuery())));
$('market-evidence-copy-token').addEventListener('click',()=>act(async()=>{await navigator.clipboard.writeText(evidence.snapshot().bindToken);$('reviewNotice').textContent='绑定码已复制，请在人工打开的 Temu 搜索页扩展面板中粘贴。';}));
$('market-evidence-import-random5').addEventListener('click',()=>{const row=review.snapshot().currentCandidate;if(row){$('market-evidence-supplier-price').value=row.price_rmb??row.supplier_price_rmb??'';$('market-evidence-moq').value=row.moq??'';$('market-evidence-supplier-pack').value=row.supplier_pack_quantity??1;updateEvidenceRatio();}});
for(const id of ['market-evidence-temu-price','market-evidence-temu-pack','market-evidence-supplier-price','market-evidence-supplier-pack'])$(id).addEventListener('input',updateEvidenceRatio);
$('market-evidence-save').addEventListener('click',()=>act(()=>evidence.saveAssessment({assessment:assessmentInput()})));
$('market-evidence-save-next').addEventListener('click',()=>act(()=>evidence.saveAndNext({sessionId:evidence.snapshot().session?.session_id,expectedRevision:evidence.snapshot().session?.revision,assessment:assessmentInput(),next:()=>review.next({confirmDiscard:confirmDiscardNote})})));
if(review)act(()=>review.load());else render();
