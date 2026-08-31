const ALLOWED_RUN_STATUSES=new Set(['COMPLETED','COMPLETED_WITH_WARNINGS']);
const ALLOWED_FILTERS=new Set(['ALL','PENDING','CONFIRMED','IMAGE_FAILED']);

export function createSourcingReviewService({
  sourcingRepository,temuRepository,runId,
  expectedGoods=50,expectedCandidates=250,
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
      temu_context:temuRepository.getTemuContext(goodsId),
      candidates:[...item.candidates].sort((a,b)=>a.random_sample_rank-b.random_sample_rank),
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

  function loadSnapshot() {
    const goods=sourcingRepository.listReviewGoods(fixedRunId);
    if(goods.length===0) throw serviceError('REVIEW_RUN_EMPTY',`review run 没有商品：${fixedRunId}`);
    const details=goods.map(item=>sourcingRepository.getReviewGoods(fixedRunId,String(item.temu_goods_id)));
    const run=details[0].run;
    const status=run.import_status??run.status;
    if(!ALLOWED_RUN_STATUSES.has(status)) throw serviceError('REVIEW_RUN_NOT_COMPLETED',`review run 状态不可用：${status}`);
    const candidateCount=details.reduce((sum,item)=>sum+item.candidates.length,0);
    if(goods.length!==expectedGoods||candidateCount!==expectedCandidates) throw serviceError(
      'REVIEW_V1_COUNT_MISMATCH',
      `V1 review 数量不匹配：goods=${goods.length}/${expectedGoods}, candidates=${candidateCount}/${expectedCandidates}`,
    );
    const joined=details.map(item=>{
      const context=temuRepository.getTemuContext(String(item.temu_goods_id));
      return {
        temu_goods_id:String(item.temu_goods_id),review_status:item.review_status,
        review_revision:item.review_revision,review_updated_at:item.review_updated_at,
        image_failed:item.candidates.some(candidate=>candidate.image_download_status!=='SUCCESS'),
        candidate_count:item.candidates.length,...context,
      };
    });
    validateStatusConservation(joined);
    return {run,goods:joined,details};
  }

  return {fixedRunId,bootstrap,goodsDetail,navigation};
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
