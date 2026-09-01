const ALLOWED_RUN_STATUSES=new Set(['COMPLETED','COMPLETED_WITH_WARNINGS']);
const ALLOWED_FILTERS=new Set(['ALL','PENDING','CONFIRMED','IMAGE_FAILED']);
import {normalizeUnitPrice} from './unit-price-normalizer.mjs';
import {buildOpportunityGroups} from './review-opportunity-groups.mjs';
import {calculateOpportunity,normalizeSupplierCandidate} from './review-opportunity-calculator.mjs';
import {resolveRunExpectedCounts} from './review-lifecycle-mapper.mjs';

export function createSourcingReviewService({
  sourcingRepository,temuRepository,runId,
  expectedGoods=null,expectedCandidates=null,
  opportunityContext=null,visualContext=null,
}={}) {
  const fixedRunId=required(runId,'run_id');

  function bootstrap({filter='ALL'}={}) {
    const snapshot=loadSnapshot();
    const filterKey=normalizeFilter(filter);
    const visible=snapshot.goods.filter(item=>matchesFilter(item,filterKey));
    return {
      run_id:fixedRunId,
      total_goods:snapshot.goods.length,
      awaiting_review:snapshot.goods.filter(item=>item.review_status==='PENDING').length,
      confirmed:snapshot.goods.filter(item=>item.review_status==='CONFIRMED').length,
      no_selection:snapshot.goods.filter(item=>item.review_status==='NO_SELECTION').length,
      image_failed_goods:snapshot.goods.filter(item=>item.image_failed).length,
      expected_counts:{expected_goods_count:snapshot.run.expected_goods_count,expected_candidate_count:snapshot.run.expected_candidate_count,expected_candidates_per_goods:snapshot.run.expected_candidates_per_goods,source:snapshot.run.source},
      filter:filterKey,
      goods:visible,
    };
  }

  function goodsDetail(temuGoodsId) {
    const goodsId=required(temuGoodsId,'temu_goods_id');
    const snapshot=loadSnapshot();
    const item=snapshot.details.find(row=>String(row.temu_goods_id)===goodsId);
    if(!item) throw serviceError('REVIEW_GOODS_NOT_FOUND',`review goods 不存在：${fixedRunId}/${goodsId}`);
    return {
      run_id:fixedRunId,
      temu_goods_id:goodsId,
      review_status:item.review_status,
      review_revision:item.review_revision,
      review_updated_at:item.review_updated_at,
      temu_context:item.temu_context,group_context:item.group_context,fx_context:snapshot.fx,
      candidates:item.candidates,
    };
  }

  function navigation({temuGoodsId,filter='ALL'}={}) {
    const goodsId=required(temuGoodsId,'temu_goods_id');
    const ids=bootstrap({filter}).goods.map(item=>String(item.temu_goods_id));
    const index=ids.indexOf(goodsId);
    if(index<0) throw serviceError('REVIEW_GOODS_NOT_IN_FILTER',`当前过滤结果不包含：${goodsId}`);
    return {
      previous_goods_id:index>0?ids[index-1]:null,
      next_goods_id:index<ids.length-1?ids[index+1]:null,
    };
  }

  function selectCandidate(input) {
    assertFixedRun(input?.runId);
    sourcingRepository.selectCandidate(input);
    return goodsDetail(input.temuGoodsId);
  }

  function clearSelection(input) {
    assertFixedRun(input?.runId);
    sourcingRepository.clearSelection(input);
    return goodsDetail(input.temuGoodsId);
  }

  function excludeCandidate(input) {
    assertFixedRun(input?.runId);
    sourcingRepository.excludeCandidate(input);
    return goodsDetail(input.temuGoodsId);
  }

  function restoreCandidate(input) {
    assertFixedRun(input?.runId);
    sourcingRepository.restoreCandidate(input);
    return goodsDetail(input.temuGoodsId);
  }

  function saveCandidateNote(input) {
    assertFixedRun(input?.runId);
    sourcingRepository.saveCandidateNote(input);
    return goodsDetail(input.temuGoodsId);
  }

  async function resolveTemuImage(temuGoodsId,imageResolver) {
    return imageResolver.resolveTemuImage(goodsDetail(temuGoodsId).temu_context);
  }

  async function resolveSupplierImage(temuGoodsId,productId,imageResolver) {
    const goodsId=required(temuGoodsId,'temu_goods_id'),productKey=required(productId,'product_id');
    const snapshot=loadSnapshot();
    const detail=snapshot.details.find(row=>String(row.temu_goods_id)===goodsId);
    const candidate=detail?.candidates.find(row=>String(row['1688_product_id']??row.supplier_product_id)===productKey);
    if(!candidate) throw serviceError('REVIEW_CANDIDATE_NOT_FOUND',`supplier candidate 不存在：${fixedRunId}/${goodsId}/${productKey}`);
    return imageResolver.resolveSupplierImage({run:snapshot.run,candidate});
  }

  function resolveOpenLink({temuGoodsId,productId}={}) {
    const goodsId=required(temuGoodsId,'temu_goods_id'),productKey=required(productId,'product_id');
    const detail=goodsDetail(goodsId);
    const candidate=detail.candidates.find(row=>String(row['1688_product_id']??row.supplier_product_id)===productKey);
    if(!candidate) throw serviceError('REVIEW_CANDIDATE_NOT_FOUND',`supplier candidate 不存在：${fixedRunId}/${goodsId}/${productKey}`);
    return {url:validated1688Url(candidate['1688_product_url']??candidate.supplier_url)};
  }

  async function visualMatches(temuGoodsId,options={}) { const detail=goodsDetail(temuGoodsId);if(!visualContext)return {run_id:fixedRunId,anchor_goods_id:String(temuGoodsId),index:{status:'NOT_BUILT'},search:{match_count:0,reliable_match_count:0},matches:[],candidate_opportunities:[]};const result=await visualContext.query({goodsId:String(temuGoodsId),...options}),minimum=result.market_metrics?.min_reliable_unit_price_eur??null;const candidate_opportunities=detail.candidates.map(candidate=>{if(minimum===null)return {product_id:String(candidate['1688_product_id']??candidate.supplier_product_id),opportunity_ratio:null,opportunity_band:'VISUAL_MATCH_REQUIRED',opportunity_reasons:['VISUAL_MATCH_REQUIRED']};return {product_id:String(candidate['1688_product_id']??candidate.supplier_product_id),...calculateOpportunity({group:{metrics:{group_min_unit_price_eur:minimum},group_confidence:'HIGH'},candidate,fx:detail.fx_context})};});return {...result,candidate_opportunities}; }
  async function visualImage(temuGoodsId,options={}) { if(!visualContext)throw serviceError('VISUAL_INDEX_NOT_BUILT','visual index not built');return visualContext.image({goodsId:String(temuGoodsId),...options}); }

  function assertFixedRun(value) {
    if(String(value??'')!==fixedRunId) throw serviceError('REVIEW_RUN_MISMATCH',`review run 必须固定为：${fixedRunId}`);
    return fixedRunId;
  }

  function loadSnapshot() {
    const goods=sourcingRepository.listReviewGoods(fixedRunId);
    if(goods.length===0) throw serviceError('REVIEW_RUN_EMPTY',`review run 没有商品：${fixedRunId}`);
    const details=goods.map(item=>sourcingRepository.getReviewGoods(fixedRunId,String(item.temu_goods_id)));
    const run=details[0].run;
    const status=run.import_status??run.status;
    if(!ALLOWED_RUN_STATUSES.has(status)) throw serviceError('REVIEW_RUN_NOT_COMPLETED',`review run 状态不可用：${status}`);
    const candidateCount=details.reduce((sum,item)=>sum+item.candidates.length,0);
    const countMetadata=resolveRunExpectedCounts({...run,...(expectedGoods?{expected_goods_count:expectedGoods}:{}),...(expectedCandidates?{expected_candidate_count:expectedCandidates}:{})},{actualGoods:goods.length,actualCandidates:candidateCount});
    const ids=details.map(item=>String(item.temu_goods_id));
    const contexts=temuRepository.getTemuContexts?.(ids)??new Map(ids.map(id=>[id,temuRepository.getTemuContext(id)]));
    const normalized=details.map(item=>{
      const goodsId=String(item.temu_goods_id),context=contexts.get(goodsId)??temuRepository.getTemuContext(goodsId);
      const evidence=opportunityContext?.itemsByGoodsId?.get(goodsId)??{temu_goods_id:goodsId};
      const unit=normalizeUnitPrice({listedPrice:evidence.temu_listed_price_eur,currency:'EUR',title:evidence.temu_title??context.temu_title});
      return {...context,...evidence,temu_title:context.temu_title??evidence.temu_title??null,
        temu_pack_quantity:unit.pack_quantity,temu_unit_price_eur:unit.unit_price,
        quantity_source:unit.quantity_source,quantity_confidence:unit.quantity_confidence,
        price_basis:unit.price_basis,normalization_status:unit.normalization_status,quantity_evidence:unit.evidence,
        review_status:item.review_status,review_revision:item.review_revision,review_updated_at:item.review_updated_at,
      };
    });
    const grouped=buildOpportunityGroups(normalized),fx=opportunityContext?.fx??{
      status:'FX_RATE_REQUIRED',cny_per_eur:null,eur_per_cny:null,source:null,as_of:null,
    };
    const joined=details.map(item=>{
      const goodsId=String(item.temu_goods_id),temu=grouped.itemByGoodsId.get(goodsId),group=grouped.groupsByKey.get(temu.group_key);
      return {
        temu_goods_id:String(item.temu_goods_id),review_status:item.review_status,
        review_revision:item.review_revision,review_updated_at:item.review_updated_at,
        image_failed:item.candidates.some(candidate=>candidate.image_download_status!=='SUCCESS'),
        candidate_count:item.candidates.length,...temu,group_item_count:group.metrics.group_item_count,
      };
    });
    const enrichedDetails=details.map(item=>{
      const goodsId=String(item.temu_goods_id),temu=grouped.itemByGoodsId.get(goodsId),group=grouped.groupsByKey.get(temu.group_key);
      const groupItems=group.items.map(row=>({
        temu_goods_id:row.temu_goods_id,temu_title:row.temu_title,review_status:row.review_status,
        group_key:row.group_key,group_label:row.group_label,temu_listed_price_eur:row.temu_listed_price_eur??null,
        temu_pack_quantity:row.temu_pack_quantity,temu_unit_price_eur:row.temu_unit_price_eur,
        quantity_source:row.quantity_source,quantity_confidence:row.quantity_confidence,
        is_current:row.temu_goods_id===goodsId,is_min_listed:row.temu_goods_id===group.metrics.group_min_listed_goods_id,
        is_min_unit:row.temu_goods_id===group.metrics.group_min_unit_goods_id,
      }));
      const groupContext={group_key:group.group_key,group_label:group.group_label,group_source:group.group_source,
        group_confidence:group.group_confidence,item_count:group.metrics.group_item_count,metrics:group.metrics,items:groupItems};
      const candidates=[...item.candidates].sort((a,b)=>a.random_sample_rank-b.random_sample_rank).map(raw=>{
        const normalizedCandidate=normalizeSupplierCandidate(raw,fx);
        return {...normalizedCandidate,...calculateOpportunity({group:groupContext,candidate:normalizedCandidate,fx})};
      });
      return {...item,temu_context:temu,group_context:groupContext,candidates};
    });
    validateStatusConservation(joined);
    return {run:{...run,...countMetadata},goods:joined,details:enrichedDetails,fx};
  }

  return {
    fixedRunId,bootstrap,goodsDetail,navigation,assertFixedRun,
    selectCandidate,clearSelection,excludeCandidate,restoreCandidate,saveCandidateNote,
    resolveTemuImage,resolveSupplierImage,resolveOpenLink,visualMatches,visualImage,
  };
}

function normalizeFilter(value) {
  const filter=String(value??'ALL').toUpperCase();
  if(!ALLOWED_FILTERS.has(filter)) throw serviceError('REVIEW_FILTER_INVALID',`不支持的 review filter：${filter}`);
  return filter;
}

function matchesFilter(item,filter) {
  if(filter==='ALL') return true;
  if(filter==='IMAGE_FAILED') return item.image_failed;
  return item.review_status===filter;
}

function validateStatusConservation(goods) {
  const valid=new Set(['PENDING','CONFIRMED','NO_SELECTION']);
  const invalid=goods.find(item=>!valid.has(item.review_status));
  if(invalid) throw serviceError('REVIEW_STATUS_INVALID',`review status 非法：${invalid.review_status}`);
}

function required(value,name) {
  const text=value===null||value===undefined?'':String(value);
  if(text==='') throw serviceError('REVIEW_IDENTITY_REQUIRED',`${name} 不能为空`);
  return text;
}

function serviceError(code,message) {
  return Object.assign(new Error(message),{code});
}

function validated1688Url(value) {
  const raw=String(value??'');
  if(/[\u0000-\u001f\u007f]/.test(raw)) throw serviceError('REVIEW_1688_URL_INVALID','1688 URL 含非法字符');
  let url;
  try { url=new URL(raw); } catch { throw serviceError('REVIEW_1688_URL_INVALID','1688 URL 无效'); }
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||(host!=='1688.com'&&!host.endsWith('.1688.com'))||url.username||url.password||url.port) {
    throw serviceError('REVIEW_1688_URL_INVALID','只允许当前候选的 HTTPS 1688 URL');
  }
  return url.href;
}
