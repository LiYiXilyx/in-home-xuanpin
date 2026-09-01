const FILTERS=new Set(['ALL','PENDING','CONFIRMED','IMAGE_FAILED']);

export function createReviewConsoleState({api,runId,initialGoodsId=null,openWindow=globalThis.open?.bind(globalThis),onChange=()=>{}}={}) {
  if(!api||!runId) throw new TypeError('api and runId are required');
  let model={filter:'ALL',bootstrap:null,detail:null,currentGoodsId:initialGoodsId?String(initialGoodsId):null,currentProductId:null,notice:'',
    groupExpanded:false,groupSort:'DEFAULT',comparisonGoodsId:null,imagePreview:null,noteDirty:false,
    visualExpanded:false,visualLoading:false,visualResult:null,visualError:null,visualPreviewGoodsId:null,
    visualState:emptyVisualState(null)};
  let goodsRequestSequence=0,visualRequestSequence=0,activeIndexFingerprint=null;
  const visualMatchesByGoodsId=new Map();

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
    const goodsToken=++goodsRequestSequence;
    model.currentGoodsId=key;model.detail=null;model.currentProductId=null;model.noteDirty=false;model.comparisonGoodsId=null;model.imagePreview=null;model.visualPreviewGoodsId=null;
    invalidateVisualMatches(key);notify();
    const response=await request(`/api/sourcing/review/goods/${encodeURIComponent(key)}?${query()}`);
    if(goodsToken!==goodsRequestSequence||model.currentGoodsId!==key)return snapshot();
    response.candidates=[...(response.candidates??[])].sort((a,b)=>Number(a.random_sample_rank)-Number(b.random_sample_rank));
    model.detail=response;
    if(!response.candidates.some(row=>productId(row)===model.currentProductId)) {
      model.currentProductId=productId(response.candidates[0])||null;
    }
    if(model.visualExpanded){markCandidateVisualLoading();notify();await refreshVisualMatches(key,{allowCache:false});}else notify();
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

  async function toggleVisual() { model.visualExpanded=!model.visualExpanded;if(!model.visualExpanded){notify();return snapshot();}await refreshVisualMatches(model.currentGoodsId,{allowCache:true});return snapshot(); }
  async function refreshVisualMatches(goodsId,{allowCache=false,ignoreFingerprint=false}={}){
    const anchor=String(goodsId??'');if(!anchor||anchor!==model.currentGoodsId)return snapshot();
    const cached=allowCache&&activeIndexFingerprint?visualMatchesByGoodsId.get(visualCacheKey(runId,anchor,activeIndexFingerprint)):null;
    if(cached){applyVisualResult(anchor,cached);notify();return snapshot();}
    const requestToken=++visualRequestSequence;setVisualState(anchor,'LOADING');markCandidateVisualLoading();notify();
    const params=new URLSearchParams({run_id:runId,limit:'20'});if(activeIndexFingerprint&&!ignoreFingerprint)params.set('index_fingerprint',activeIndexFingerprint);
    try{
      const result=await request(`/api/sourcing/review/goods/${encodeURIComponent(anchor)}/visual-matches?${params}`);
      if(requestToken!==visualRequestSequence||model.currentGoodsId!==anchor||String(result?.anchor_goods_id??'')!==anchor)return snapshot();
      if(result?.run_id&&String(result.run_id)!==String(runId))return snapshot();
      const fingerprint=result?.index?.index_fingerprint??null;activeIndexFingerprint=fingerprint;
      if(fingerprint)visualMatchesByGoodsId.set(visualCacheKey(runId,anchor,fingerprint),result);
      applyVisualResult(anchor,result);notify();
    }catch(error){
      if(requestToken!==visualRequestSequence||model.currentGoodsId!==anchor)return snapshot();
      if(error?.code==='VISUAL_INDEX_STALE'&&!ignoreFingerprint){activeIndexFingerprint=null;visualMatchesByGoodsId.clear();return refreshVisualMatches(anchor,{allowCache:false,ignoreFingerprint:true});}
      setVisualState(anchor,'ERROR',{error:error.code??error.message});notify();
    }
    return snapshot();
  }
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

  function invalidateVisualMatches(anchor){visualRequestSequence+=1;setVisualState(anchor,'IDLE');}
  function setVisualState(anchor,status,{result=null,error=null}={}){const matches=result?.matches??[],marketMetrics=result?.market_metrics??null,indexFingerprint=result?.index?.index_fingerprint??null;model.visualState={anchorGoodsId:anchor,status,matches,marketMetrics,error,indexFingerprint};model.visualLoading=status==='LOADING';model.visualResult=result;model.visualError=error;}
  function applyVisualResult(anchor,result){const status=result?.index?.status==='READY'&&(result.matches??[]).length===0?'EMPTY':'READY';setVisualState(anchor,status,{result});const byProduct=new Map((result.candidate_opportunities??[]).map(row=>[String(row.product_id),row]));if(model.detail&&model.currentGoodsId===anchor)model.detail.candidates=model.detail.candidates.map(row=>({...row,...byProduct.get(productId(row))}));}
  function markCandidateVisualLoading(){if(!model.detail)return;model.detail.candidates=model.detail.candidates.map(row=>({...row,opportunity_ratio:null,opportunity_band:'VISUAL_MATCH_LOADING',opportunity_reasons:['VISUAL_MATCH_LOADING']}));}
  function notify(){onChange(snapshot());}

  return {
    load,selectGoods,chooseCandidate,previous:options=>move(-1,options),next:options=>move(1,options),snapshot,
    selectCandidate,clearSelection,excludeCandidate,restoreCandidate,saveNote,openLink,
    toggleGroup,setGroupSort,previewGroupImage,closeImagePreview,switchToGroupGoods,setNoteDirty,
    toggleVisual,refreshVisualMatches,previewVisualImage,closeVisualPreview,switchVisualCurrentRun,openVisualOtherRun,
  };
}

function emptyVisualState(anchorGoodsId){return{anchorGoodsId,status:'IDLE',matches:[],marketMetrics:null,error:null,indexFingerprint:null};}
function visualCacheKey(runId,goodsId,fingerprint){return`${runId}\u0000${goodsId}\u0000${fingerprint}`;}
