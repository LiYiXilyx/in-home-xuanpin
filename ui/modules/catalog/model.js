const ERROR_MESSAGES=Object.freeze({
  CATALOG_RPA_CLAIM_CONFLICT:'检测到其它活跃采集队列，请停止操作并检查当前任务。',
  CATALOG_RPA_CONTEXT_AMBIGUOUS:'检测到多个采集上下文，请停止操作并人工检查，系统不会选择最新任务。',
  INITIAL_ACTIVE_POOL_REQUIRED:'所选类目没有可用 Active Pool，请使用独立的初始建池流程。',
  CATALOG_BASELINE_INCONSISTENT:'Active Pool 与该类目 membership 不一致，本次未写入数据。',
  CATEGORY_PROFILE_NOT_FOUND:'找不到所选 Category Profile，请刷新配置列表。',
  CATEGORY_PROFILE_VERSION_MISMATCH:'Category Profile 版本已变化，请刷新后重新选择。',
  CATALOG_TARGET_INVALID:'本次新增数量无效，或计算后的 Target 超过 Profile 上限。',
  CAMPAIGN_NAME_CONFLICT:'任务名称已经存在，请更换名称；系统不会复用旧任务。',
  OPERATOR_CREATE_IDEMPOTENCY_CONFLICT:'创建请求标识与原参数不一致，请停止并刷新表单。',
  INITIAL_POOL_EMPTY:'当前尚未采集到候选商品，请先检测、绑定并采集当前页面。',
  INITIAL_POOL_QA_STALE:'QA 后候选集合已变化，请重新运行首池 QA。',
  INITIAL_POOL_QA_REQUIRED:'必须先运行并通过当前候选集合的首池 QA。',
  INITIAL_POOL_ACTIVATION_IN_PROGRESS:'首个商品池正在建立，请等待完成，不要重复操作。',
  INITIAL_POOL_ALREADY_EXISTS:'该 Category 已存在商品池，请刷新后使用新增采集流程。',
  INITIAL_POOL_HISTORY_EXISTS:'该 Category 存在商品池历史，不能再次建立首池。',
  INITIAL_CATEGORY_STATE_INCONSISTENT:'该 Category 存在无 Pool 对应的 membership，请停止并检查数据。'
});

export function calculateTarget(profile,requestedNewCount){
  if(!profile||!positiveInteger(requestedNewCount)||!nonNegativeInteger(profile.active_pool_count))return null;
  return Number(profile.active_pool_count)+Number(requestedNewCount);
}
export function buildCreatePayload({profile,requestedNewCount,campaignName,requestId}={}){
  if(!profile?.category_key||!profile?.category_profile_version)throw new Error('请选择有效 Category Profile。');
  if(!positiveInteger(requestedNewCount))throw new Error('本次新增目标必须是正整数。');
  const name=String(campaignName??'').trim(),identity=String(requestId??'').trim();
  if(!name)throw new Error('任务名称不能为空。');if(!identity)throw new Error('创建请求标识不能为空。');
  return{category_key:profile.category_key,category_profile_version:profile.category_profile_version,
    requested_new_count:Number(requestedNewCount),campaign_name:name,request_id:identity};
}
export function buildInitialCreatePayload({profile,campaignName,requestId}={}){
  if(!profile?.category_key||!profile?.category_profile_version)throw new Error('请选择有效 Category Profile。');
  const name=String(campaignName??'').trim(),identity=String(requestId??'').trim();
  if(!name)throw new Error('任务名称不能为空。');if(!identity)throw new Error('创建请求标识不能为空。');
  return{category_key:profile.category_key,category_profile_version:profile.category_profile_version,campaign_name:name,request_id:identity};
}
export function buildInitialQaPayload(input={}){return buildInitialActionPayload(input);}
export function buildInitialActivationPayload(input={}){return buildInitialActionPayload(input);}
export function initialOperatorViewModel(current={}){const qa=current.qa??{},status=qa.status??'NOT_RUN',currentCount=Number(current.current_unique??0);
  return{modeLabel:'不限数量 / OPEN_ENDED',currentCount,qaStatus:status,qaCandidateCount:Number(qa.qa_candidate_count??0),
    unreviewedDelta:Number(qa.unreviewed_delta??Math.max(0,currentCount-Number(qa.qa_candidate_count??0))),
    qaEnabled:currentCount>0&&!['RUNNING','ACTIVATING'].includes(status),activationEnabled:status==='PASSED_CURRENT',
    activationInProgress:status==='ACTIVATING',failureCodes:qa.failure_codes??[]};}
export function operatorErrorMessage(error={}){const code=String(error.code??'OPERATION_FAILED');
  return`${code}：${ERROR_MESSAGES[code]??error.message??'创建采集任务失败，请停止并检查。'}`;}
export function createRequestIdentity({randomUUID}={}){if(typeof randomUUID!=='function')throw new Error('无法生成创建请求标识。');
  const value=String(randomUUID()).trim();if(!value)throw new Error('无法生成创建请求标识。');return value;}
function positiveInteger(value){return Number.isInteger(Number(value))&&Number(value)>0;}
function nonNegativeInteger(value){return Number.isInteger(Number(value))&&Number(value)>=0;}
function buildInitialActionPayload({campaignId,profile,requestId}={}){const campaign=String(campaignId??'').trim(),identity=String(requestId??'').trim();
  if(!campaign||!identity||!profile?.category_key||!profile?.category_profile_version)throw new Error('Initial操作缺少明确 identity。');
  return{campaign_id:campaign,category_key:profile.category_key,category_profile_version:profile.category_profile_version,request_id:identity};}
