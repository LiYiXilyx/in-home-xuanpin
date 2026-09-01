const FILTERS=new Set(['ALL','PENDING','CONFIRMED','IMAGE_FAILED']);

export function createReviewConsoleState({api,runId,initialGoodsId=null,openWindow=globalThis.open?.bind(globalThis)}={}) {
  if(!api||!runId) throw new TypeError('api and runId are required');
  let model={filter:'ALL',bootstrap:null,detail:null,currentGoodsId:initialGoodsId?String(initialGoodsId):null,currentProductId:null,notice:'',
    groupExpanded:false,groupSort:'DEFAULT',comparisonGoodsId:null,imagePreview:null,noteDirty:false,
    visualExpanded:false,visualLoading:false,visualResult:null,visualError:null,visualPreviewGoodsId:null};

  const request=(path,options)=>api.request(path,options);
  const query=()=>`run_id=${encodeURIComponent(runId)}`;
  const productId=row=>String(row?.['1688_product_id']??row?.supplier_product_id??'');

  async function load(filter=model.filter) {
    const key=String(filter).toUpperCase();
    if(!FILTERS.has(key)) throw new TypeError(`unsupported filter: ${key}`);
    model.filter=key;
    model.bootstrap=await request(`/api/sourcing/review/bootstrap?${query()}&filter=${encodeURIComponent(key)}`);
    const ids=model.bootstrap.goods.map(row=>String(row.temu_goods_id));
    if(!ids.includes(model.currentGoodsId)) model.currentGoodsId=ids[0]??null;
    if(model.currentGoodsId) await selectGoods(model.currentGoodsId);
    else { model.detail=null; model.currentProductId=null; }
    return snapshot();
  }

  async function refreshBootstrap() {
    model.bootstrap=await request(`/api/sourcing/review/bootstrap?${query()}&filter=${encodeURIComponent(model.filter)}`);
  }

  async function selectGoods(goodsId,{confirmDiscard}={}) {
    const key=String(goodsId);
    if(model.noteDirty&&model.currentGoodsId&&key!==model.currentGoodsId) {
      if(typeof confirmDiscard!=='function'||!confirmDiscard()) return false;
    }
    const response=await request(`/api/sourcing/review/goods/${encodeURIComponent(key)}?${query()}`);
    response.candidates=[...(response.candidates??[])].sort((a,b)=>Number(a.random_sample_rank)-Number(b.random_sample_rank));
    model.detail=response;
    model.currentGoodsId=key;
    model.noteDirty=false;model.comparisonGoodsId=null;model.imagePreview=null;model.visualResult=null;model.visualError=null;model.visualPreviewGoodsId=null;
    if(!response.candidates.some(row=>productId(row)===model.currentProductId)) {
      model.currentProductId=productId(response.candidates[0])||null;
    }
    return snapshot();
  }

  function chooseCandidate(value) {
    const key=String(value);
    if(!model.detail?.candidates.some(row=>productId(row)===key)) throw new TypeError('candidate is not in current goods');
    model.currentProductId=key;
    return snapshot();
  }

  async function move(delta,options={}) {
    const ids=model.bootstrap?.goods.map(row=>String(row.temu_goods_id))??[];
    const index=ids.indexOf(model.currentGoodsId);
    const target=ids[index+delta];
    if(target) await selectGoods(target,options);
    return snapshot();
  }

  async function mutate(suffix,method,extra={}) {
    const goodsId=model.currentGoodsId,candidate=currentCandidate();
    const body={run_id:runId,temu_goods_id:goodsId,expected_revision:model.detail.review_revision,...extra};
    try {
      const response=await request(`/api/sourcing/review/goods/${encodeURIComponent(goodsId)}${suffix(candidate)}`,{method,body});
      response.candidates=[...(response.candidates??[])].sort((a,b)=>Number(a.random_sample_rank)-Number(b.random_sample_rank));
      model.detail=response;
      model.notice='';
      await refreshBootstrap();
      return {conflict:false,state:snapshot()};
    } catch(error) {
      if(error?.status!==409||error?.code!=='REVIEW_CONFLICT') throw error;
      model.notice='复核数据已变化，已重新加载当前商品，请再次确认。';
      await selectGoods(goodsId);
      return {conflict:true,state:snapshot()};
    }
  }

  const candidateSuffix=action=>candidate=>`/candidates/${encodeURIComponent(productId(candidate))}/${action}`;

  function selectCandidate() {
    return mutate(()=>'/select','POST',{product_id:productId(currentCandidate())});
  }
  function clearSelection() { return mutate(()=>'/clear-selection','POST'); }
  function excludeCandidate() { return mutate(candidateSuffix('exclude'),'POST'); }
  function restoreCandidate() { return mutate(candidateSuffix('restore'),'POST'); }
  async function saveNote(operatorNote) { const result=await mutate(candidateSuffix('note'),'PUT',{operator_note:operatorNote});model.noteDirty=false;return result; }

  function toggleGroup() { model.groupExpanded=!model.groupExpanded;return snapshot(); }
  function setGroupSort(value) { const key=String(value);if(!new Set(['DEFAULT','UNIT_PRICE','LISTED_PRICE','GOODS_ID']).has(key))throw new TypeError(`unsupported group sort: ${key}`);model.groupSort=key;return snapshot(); }
  function previewGroupImage(goodsId) { const key=groupGoodsId(goodsId);model.comparisonGoodsId=key;model.imagePreview=key;return snapshot(); }
  function closeImagePreview() { model.imagePreview=null;return snapshot(); }
  function setNoteDirty(value) { model.noteDirty=Boolean(value);return snapshot(); }
  async function switchToGroupGoods(goodsId,{confirmDiscard}={}) { const key=groupGoodsId(goodsId);const result=await selectGoods(key,{confirmDiscard});return result===false?false:true; }

  async function toggleVisual() { model.visualExpanded=!model.visualExpanded;if(model.visualExpanded&&!model.visualResult){model.visualLoading=true;model.visualError=null;try{model.visualResult=await request(`/api/sourcing/review/goods/${encodeURIComponent(model.currentGoodsId)}/visual-matches?${query()}&limit=20`);const byProduct=new Map((model.visualResult.candidate_opportunities??[]).map(row=>[String(row.product_id),row]));if(model.detail)model.detail.candidates=model.detail.candidates.map(row=>({...row,...byProduct.get(productId(row))}));}catch(error){model.visualError=error.code??error.message;}finally{model.visualLoading=false;}}return snapshot(); }
  function previewVisualImage(goodsId){model.visualPreviewGoodsId=String(goodsId);return snapshot();}
  function closeVisualPreview(){model.visualPreviewGoodsId=null;return snapshot();}
  async function switchVisualCurrentRun(goodsId,options={}){const match=model.visualResult?.matches?.find(row=>String(row.goods_id)===String(goodsId));if(match?.navigation_action!=='SWITCH_CURRENT_RUN')throw new TypeError('visual match is not in current run');return selectGoods(goodsId,options);}
  function openVisualOtherRun(goodsId){const match=model.visualResult?.matches?.find(row=>String(row.goods_id)===String(goodsId));if(match?.navigation_action!=='OPEN_OTHER_RUN'||!match.review_run_id)throw new TypeError('visual match has no other run');const url=`/sourcing-review.html?run_id=${encodeURIComponent(match.review_run_id)}&goods_id=${encodeURIComponent(goodsId)}`;openWindow?.(url,'_blank','noopener,noreferrer');return url;}

  function groupGoodsId(value) {
    const key=String(value),items=model.detail?.group_context?.items??[];
    if(!items.some(item=>String(item.temu_goods_id)===key)) throw new TypeError('goods is not in current opportunity group');
    return key;
  }

  async function openLink() {
    const candidate=currentCandidate();
    if(!candidate) throw new TypeError('no candidate selected');
    const path=`/api/sourcing/review/goods/${encodeURIComponent(model.currentGoodsId)}/candidates/${encodeURIComponent(productId(candidate))}/open-link?${query()}`;
    const {url}=await request(path);
    openWindow?.(url,'_blank','noopener,noreferrer');
    return url;
  }

  function currentCandidate() {
    return model.detail?.candidates.find(row=>productId(row)===model.currentProductId)??null;
  }

  function snapshot() {
    return {...model,currentCandidate:currentCandidate(),runId};
  }

  return {
    load,selectGoods,chooseCandidate,previous:options=>move(-1,options),next:options=>move(1,options),snapshot,
    selectCandidate,clearSelection,excludeCandidate,restoreCandidate,saveNote,openLink,
    toggleGroup,setGroupSort,previewGroupImage,closeImagePreview,switchToGroupGoods,setNoteDirty,
    toggleVisual,previewVisualImage,closeVisualPreview,switchVisualCurrentRun,openVisualOtherRun,
  };
}
