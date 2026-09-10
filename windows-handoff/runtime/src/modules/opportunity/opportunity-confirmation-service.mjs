import { transaction } from '../../db/client.mjs';
import { createOpportunityConfirmationRepository,OPPORTUNITY_DECISIONS } from '../../db/repositories/opportunity-confirmation-repository.mjs';

const DECISIONS=new Set(OPPORTUNITY_DECISIONS);
const GOODS_ID=/^\d{1,16}$/;

export function createOpportunityConfirmationService(db,{ now=()=>new Date().toISOString() }={}){
  const repository=createOpportunityConfirmationRepository(db,{now});
  function listCandidates(snapshotId){const id=required(snapshotId,'snapshotId');const snapshot=repository.getSnapshot(id);if(!snapshot)throw fault('SNAPSHOT_NOT_FOUND','Opportunity Snapshot不存在。');return {snapshot:{id:snapshot.id,status:snapshot.status},counts:repository.counts(id),candidates:repository.listCandidates(id)};}
  function confirmCandidate(input={}){
    const snapshotId=required(input.snapshotId,'snapshotId'),candidateId=positiveInteger(input.candidateId,'candidateId'),goodsId=validGoodsId(input.goodsId),platform=required(input.platform??'temu','platform');
    const decision=required(input.decision,'decision');if(!DECISIONS.has(decision))throw fault('INVALID_DECISION',`decision必须是：${OPPORTUNITY_DECISIONS.join(', ')}`);
    const reason=bounded(input.reason,'reason',2000),reviewedBy=bounded(input.reviewedBy,'reviewedBy',200),reviewedAt=timestamp(input.reviewedAt??now(),'reviewedAt');
    const snapshot=repository.getSnapshot(snapshotId);if(!snapshot)throw fault('SNAPSHOT_NOT_FOUND','Opportunity Snapshot不存在。');
    if(snapshot.status!=='awaiting_confirmation')throw fault('STALE_SNAPSHOT','只有 awaiting_confirmation Snapshot 可人工确认。');
    const candidate=repository.getCandidateById(candidateId);if(!candidate)throw fault('CANDIDATE_NOT_FOUND','Opportunity Candidate不存在。');
    if(candidate.snapshot_id!==snapshotId||candidate.platform!==platform)throw fault('SNAPSHOT_CANDIDATE_MISMATCH','Snapshot 与 Candidate identity 不匹配。');
    if(String(candidate.goods_id)!==goodsId)throw fault('GOODS_ID_MISMATCH','goods_id 与 Candidate identity 不匹配。');
    return transaction(db,()=>repository.saveConfirmation({snapshotId,candidateId,platform,goodsId,decision,reason,reviewedBy,reviewedAt}));
  }
  function checkEligibility(input={}){
    const parsed=eligibilityIdentity(input);if(!parsed.ok)return blocked(parsed.reason);
    const {snapshotId,candidateId,goodsId,platform}=parsed;const snapshot=repository.getSnapshot(snapshotId);if(!snapshot)return blocked('SNAPSHOT_NOT_FOUND');
    if(snapshot.status!=='awaiting_confirmation')return blocked('STALE_SNAPSHOT');
    const candidate=repository.getCandidateById(candidateId);if(!candidate)return blocked('CANDIDATE_NOT_FOUND');
    if(candidate.snapshot_id!==snapshotId||candidate.platform!==platform)return blocked('SNAPSHOT_CANDIDATE_MISMATCH');
    if(String(candidate.goods_id)!==goodsId)return blocked('GOODS_ID_MISMATCH');
    const confirmation=repository.getConfirmation(snapshotId,candidateId);if(!confirmation)return blocked('UNCONFIRMED');
    if(!DECISIONS.has(confirmation.decision))return blocked('MALFORMED_DECISION');
    if(confirmation.goodsId!==goodsId||confirmation.platform!==platform)return blocked('CONFIRMATION_IDENTITY_MISMATCH');
    return confirmation.decision==='approved'?{approved:true,reason:'APPROVED',decision:'approved',confirmationId:confirmation.confirmationId}:blocked(confirmation.decision.toUpperCase(),confirmation.decision);
  }
  function isOpportunityApproved(input){return checkEligibility(input).approved;}
  return {listCandidates,confirmCandidate,checkEligibility,isOpportunityApproved,decisions:OPPORTUNITY_DECISIONS};
}

function eligibilityIdentity(input){const snapshotId=String(input.snapshotId??'').trim(),platform=String(input.platform??'temu').trim(),goodsId=String(input.goodsId??'').trim(),candidateId=Number(input.candidateId);if(!snapshotId||!platform||!Number.isInteger(candidateId)||candidateId<1||!GOODS_ID.test(goodsId))return {ok:false,reason:'INVALID_IDENTITY'};return {ok:true,snapshotId,platform,goodsId,candidateId};}
function blocked(reason,decision=null){return {approved:false,reason,decision,confirmationId:null};}
function required(value,name){const result=String(value??'').trim();if(!result)throw fault('INVALID_INPUT',`${name}不能为空。`);return result;}
function bounded(value,name,max){const result=required(value,name);if(result.length>max)throw fault('INVALID_INPUT',`${name}超过${max}字符。`);return result;}
function positiveInteger(value,name){const result=Number(value);if(!Number.isInteger(result)||result<1)throw fault('INVALID_INPUT',`${name}必须是正整数。`);return result;}
function validGoodsId(value){const result=String(value??'').trim();if(!GOODS_ID.test(result))throw fault('INVALID_GOODS_ID','goodsId必须是1—16位数字字符串。');return result;}
function timestamp(value,name){const date=new Date(value);if(!Number.isFinite(date.valueOf()))throw fault('INVALID_INPUT',`${name}不是有效时间。`);return date.toISOString();}
function fault(code,message){const error=new Error(message);error.code=code;return error;}
