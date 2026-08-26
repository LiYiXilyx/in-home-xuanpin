export function createReviewQueueController({ queueService }) {
  return {
    enqueue(input={}) { return queueService.enqueue({ jobId:input.jobId,goodsIds:input.goodsIds }); },
    list(jobId) { return queueService.list({ jobId }); },
    get(id) { return queueService.get({ id }); },
    claimNext(input={}) { return queueService.claimNext({ jobId:input.jobId }); },
    resolveNavigation(id,input={}) { return queueService.resolveNavigation({ id,goodsId:input.goodsId,sourcePageUrl:input.sourcePageUrl,
      currentCategoryCards:input.currentCategoryCards,siteSearchCards:input.siteSearchCards,allowFallback:input.allowFallback === true }); },
    verifyNavigation(id,input={}) { return queueService.verifyNavigation({ id,goodsId:input.goodsId,detailUrl:input.detailUrl,detailText:input.detailText }); },
    waitingOperator(id,input={}) { return queueService.markWaitingOperator({ id,goodsId:input.goodsId }); },
    fail(id,input={}) { return queueService.fail({ id,goodsId:input.goodsId,errorCode:input.errorCode,errorMessage:input.errorMessage }); },
    retry(id) { return queueService.retry({ id }); }
  };
}
