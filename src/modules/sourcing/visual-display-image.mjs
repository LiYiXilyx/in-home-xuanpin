export function createVisualDisplayImageResolver({runId,universe,indexStore,temuRepository,temuImageResolver}={}) {
  const endpoint=(goodsId,fingerprint)=>`/api/sourcing/review/visual-index/display-images/${encodeURIComponent(goodsId)}?${new URLSearchParams({run_id:String(runId),index_fingerprint:String(fingerprint)})}`;

  async function resolve({goodsId,fingerprint}={}) {
    const id=String(goodsId),state=await indexStore.status({universe});
    if(state.status!=='READY'||fingerprint!==state.index_fingerprint) throw fault('VISUAL_INDEX_STALE','index unavailable');
    const index=await indexStore.loadReady({universe});
    if(!index.products.some(row=>String(row.goods_id)===id)) throw fault('VISUAL_IMAGE_NOT_FOUND','goods not indexed');
    const context=temuRepository?.getTemuContext?.(id);
    if(context) {
      const original=await temuImageResolver.resolveTemuImage(context);
      if(original?.kind==='LOCAL'&&original.width>0&&original.height>0) return {
        kind:'TEMU_LOCAL_ORIGINAL',source:'TEMU_IMAGE_CACHE',contentType:original.contentType,bytes:original.bytes,
        width:original.width,height:original.height,lowResolution:Math.min(original.width,original.height)<224,
      };
    }
    const display=await indexStore.displayAsset?.({universe,goodsId:id});
    if(display) return {...display,kind:'INDEX_DISPLAY_THUMBNAIL',source:'VISUAL_INDEX_DISPLAY'};
    const retrieval=await indexStore.retrievalAsset?.({universe,goodsId:id});
    if(retrieval) return {...retrieval,kind:'RETRIEVAL_FALLBACK',source:'VISUAL_INDEX_RETRIEVAL',lowResolution:true};
    return null;
  }

  async function describe(input) {
    const asset=await resolve(input);
    if(!asset) return {display_image_url:null,display_image_kind:'MISSING',display_image_width:null,display_image_height:null,display_image_low_resolution:true,display_image_source:'NONE'};
    return {display_image_url:endpoint(String(input.goodsId),String(input.fingerprint)),display_image_kind:asset.kind,
      display_image_width:asset.width,display_image_height:asset.height,display_image_low_resolution:Boolean(asset.lowResolution),display_image_source:asset.source};
  }
  async function image(input) {const asset=await resolve(input);if(!asset)throw fault('VISUAL_IMAGE_NOT_FOUND','display image unavailable');return {...asset,display_image_kind:asset.kind,kind:'LOCAL'};}
  return {describe,image};
}
function fault(code,message){return Object.assign(new Error(message),{code});}
