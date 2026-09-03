export function createTemuMarketEvidenceController({service}={}){if(!service)throw new TypeError('market evidence service required');const ids=(goodsId,body)=>({reviewRunId:String(body?.review_run_id??''),anchorTemuGoodsId:String(goodsId),sessionId:String(body?.session_id??''),expectedRevision:body?.expected_revision,requestId:String(body?.request_id??'')});return{
  create:({goodsId,body})=>service.createSession({reviewRunId:String(body?.review_run_id??''),anchorTemuGoodsId:String(goodsId),query:body?.query,requestId:body?.request_id}),
  list:({goodsId,runId})=>service.listSessions(runId,goodsId),
  get:({goodsId,sessionId,runId})=>service.getEvidence(runId,goodsId,sessionId),
  close:({goodsId,sessionId,body})=>service.closeSession({...ids(goodsId,{...body,session_id:sessionId})}),
  reissueBindToken:({goodsId,sessionId,body})=>service.reissueBindToken({...ids(goodsId,{...body,session_id:sessionId})}),
  bind:({body})=>service.consumeBindToken({bindToken:body?.bind_token,tabIdentityHash:body?.tab_identity_hash,contextHash:body?.context_hash,pageUrl:body?.page_url,query:body?.query,confirmEffectiveQuery:body?.confirm_effective_query===true,requestId:body?.request_id}),
  phase:({goodsId,sessionId,phase,body})=>service.savePhase({...ids(goodsId,{...body,session_id:sessionId}),phase,tabIdentityHash:body?.tab_identity_hash,contextHash:body?.context_hash,pageUrl:body?.page_url,query:body?.query,safeRegion:body?.safe_region,pngBase64:body?.png_base64,screenshotWidth:body?.screenshot_width,screenshotHeight:body?.screenshot_height,cards:body?.cards}),
  screenshot:({goodsId,sessionId,phase,runId})=>service.readScreenshot(runId,goodsId,sessionId,phase),
  assessment:({goodsId,sessionId,body})=>service.saveAssessment({...ids(goodsId,{...body,session_id:sessionId}),temuPriceEur:body?.temu_price_eur,temuPackQuantity:body?.temu_pack_quantity,supplierPriceCny:body?.supplier_price_cny,supplierPackQuantity:body?.supplier_pack_quantity,moq:body?.moq,supplierProductId:body?.supplier_product_id,referenceGoodsId:body?.reference_goods_id,evidencePhase:body?.evidence_phase})
};}
