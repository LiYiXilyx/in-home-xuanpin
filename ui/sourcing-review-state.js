const FILTERS=new Set(['ALL','PENDING','CONFIRMED','IMAGE_FAILED']);

export function createReviewConsoleState({api,runId,openWindow=globalThis.open?.bind(globalThis)}={}) {
  if(!api||!runId) throw new TypeError('api and runId are required');
  let model={filter:'ALL',bootstrap:null,detail:null,currentGoodsId:null,currentProductId:null,notice:''};

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

  async function selectGoods(goodsId) {
    const key=String(goodsId);
    const response=await request(`/api/sourcing/review/goods/${encodeURIComponent(key)}?${query()}`);
    response.candidates=[...(response.candidates??[])].sort((a,b)=>Number(a.random_sample_rank)-Number(b.random_sample_rank));
    model.detail=response;
    model.currentGoodsId=key;
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

  async function move(delta) {
    const ids=model.bootstrap?.goods.map(row=>String(row.temu_goods_id))??[];
    const index=ids.indexOf(model.currentGoodsId);
    const target=ids[index+delta];
    if(target) await selectGoods(target);
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
  function saveNote(operatorNote) { return mutate(candidateSuffix('note'),'PUT',{operator_note:operatorNote}); }

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
    load,selectGoods,chooseCandidate,previous:()=>move(-1),next:()=>move(1),snapshot,
    selectCandidate,clearSelection,excludeCandidate,restoreCandidate,saveNote,openLink,
  };
}
