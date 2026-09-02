import {transaction} from '../../db/client.mjs';
import {AppError} from '../../shared/errors.mjs';

export function createCatalogClaimRecoveryService({repository,inspectionService,activityRegistry,now=()=>new Date().toISOString(),hooks={}}){
  function endStaleClaim(input){
    if(input.operatorConfirmation!=='END_STALE_CLAIM')throw new AppError('必须明确二次确认结束陈旧占用。',{code:'STALE_CLAIM_OPERATOR_CONFIRMATION_REQUIRED'});
    const replay=repository.getTerminationAuditByRequestId(input.requestId);
    if(replay){if(!sameRequest(replay,input))throw new AppError('request_id已用于另一结束请求。',{code:'STALE_CLAIM_REQUEST_CONFLICT'});return{...replay,idempotentReplay:true};}
    return transaction(repository.db,()=>{
      const check=inspectionService.recheckConfirmed({campaignId:input.campaignId,firstInspectionId:input.firstInspectionId,secondInspectionId:input.secondInspectionId});
      if(check.determination!=='STALE_CONFIRMED'||check.row.queueId!==input.queueId||check.row.sourceId!==input.sourceId||check.row.claimToken!==input.expectedClaimToken||Number(check.row.claimGeneration)!==Number(input.expectedClaimGeneration))throw new AppError('Claim在执行瞬间未严格确认stale。',{code:'STALE_CLAIM_NOT_CONFIRMED',details:check});
      const audit=repository.terminalizeClaim({campaignId:input.campaignId,queueId:input.queueId,sourceId:input.sourceId,firstInspectionId:input.firstInspectionId,secondInspectionId:input.secondInspectionId,claimToken:input.expectedClaimToken,claimGeneration:Number(input.expectedClaimGeneration),requestId:input.requestId,evidence:{checkedAt:now(),reasons:check.reasons,current:check.current,activity:check.activity},hooks});
      return{...audit,idempotentReplay:false};
    });
  }
  return{endStaleClaim};
}
function sameRequest(a,b){return a.campaignId===b.campaignId&&a.queueId===b.queueId&&a.sourceId===b.sourceId&&a.firstInspectionId===b.firstInspectionId&&a.secondInspectionId===b.secondInspectionId&&a.claimToken===b.expectedClaimToken&&a.claimGeneration===Number(b.expectedClaimGeneration);}
