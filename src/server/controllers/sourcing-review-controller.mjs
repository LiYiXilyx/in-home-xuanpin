export function createSourcingReviewController({service,imageResolver}={}) {
  if(!service||!imageResolver) throw new TypeError('sourcing review controller dependencies are required');

  function bootstrap({runId,filter}={}) {
    service.assertFixedRun(runId);
    return service.bootstrap({filter});
  }

  function goods({runId,temuGoodsId}={}) {
    service.assertFixedRun(runId);
    return service.goodsDetail(temuGoodsId);
  }

  function temuImage({runId,temuGoodsId}={}) {
    service.assertFixedRun(runId);
    return service.resolveTemuImage(temuGoodsId,imageResolver);
  }

  function supplierImage({runId,temuGoodsId,productId}={}) {
    service.assertFixedRun(runId);
    return service.resolveSupplierImage(temuGoodsId,productId,imageResolver);
  }

  function openLink({runId,temuGoodsId,productId}={}) {
    service.assertFixedRun(runId);
    return service.resolveOpenLink({temuGoodsId,productId});
  }

  function select({temuGoodsId,body}={}) {
    assertRouteGoods(temuGoodsId,body);
    return service.selectCandidate(input(body,temuGoodsId,{productId:body?.product_id}));
  }

  function clearSelection({temuGoodsId,body}={}) {
    assertRouteGoods(temuGoodsId,body);
    return service.clearSelection(input(body,temuGoodsId));
  }

  function exclude({temuGoodsId,productId,body}={}) {
    assertRouteGoods(temuGoodsId,body);
    return service.excludeCandidate(input(body,temuGoodsId,{productId}));
  }

  function restore({temuGoodsId,productId,body}={}) {
    assertRouteGoods(temuGoodsId,body);
    return service.restoreCandidate(input(body,temuGoodsId,{productId}));
  }

  function note({temuGoodsId,productId,body}={}) {
    assertRouteGoods(temuGoodsId,body);
    const note=body?.operator_note??null;
    if(note!==null&&Array.from(String(note)).length>2000) throw coded('OPERATOR_NOTE_TOO_LONG','operator_note 最多 2000 个字符');
    return service.saveCandidateNote(input(body,temuGoodsId,{productId,operatorNote:note}));
  }

  return {bootstrap,goods,temuImage,supplierImage,openLink,select,clearSelection,exclude,restore,note};
}

function input(body,temuGoodsId,extra={}) {
  return {
    runId:String(body?.run_id??''),temuGoodsId:String(temuGoodsId),
    expectedRevision:body?.expected_revision,...extra,
  };
}

function assertRouteGoods(temuGoodsId,body) {
  if(body?.temu_goods_id!==undefined&&String(body.temu_goods_id)!==String(temuGoodsId)) {
    throw coded('REVIEW_IDENTITY_MISMATCH','route goods 与 body goods 不一致');
  }
}

function coded(code,message) {
  return Object.assign(new Error(message),{code});
}
