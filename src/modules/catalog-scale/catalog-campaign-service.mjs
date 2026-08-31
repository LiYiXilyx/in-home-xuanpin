import { createHash } from 'node:crypto';
import { transaction } from '../../db/client.mjs';
import { createCatalogCampaignRepository } from '../../db/repositories/catalog-campaign-repository.mjs';
import { AppError } from '../../shared/errors.mjs';
import { canonicalProductUrl,createId } from '../../shared/ids.mjs';
import { validateCategoryProfile } from './category-profile.mjs';
import { screenCatalogElectronicRisk } from './electronic-screening.mjs';

const CAMPAIGN_TRANSITIONS=Object.freeze({
  pending:['running','cancelled'],running:['paused','manual_required','qa_pending','failed','cancelled'],paused:['running','failed','cancelled'],
  manual_required:['running','failed','cancelled'],
  qa_pending:['completed','qa_failed'],qa_failed:['running','failed','cancelled'],completed:[],failed:[],cancelled:[]
});
export const CATALOG_LOAD_STATES=Object.freeze([
  'LOAD_MORE_PROGRESS','LOAD_MORE_RETRYABLE','MANUAL_VERIFICATION_REQUIRED','LISTING_CONTEXT_UNHEALTHY'
]);
const NON_EXHAUSTING_LOAD_STATES=new Set([
  'LOAD_MORE_RETRYABLE','MANUAL_VERIFICATION_REQUIRED','LISTING_CONTEXT_UNHEALTHY'
]);
const MANUAL_PASSIVE_CAPTURE_MODE='MANUAL_BIND_PASSIVE_CAPTURE';
const MANUAL_PASSIVE_CAPTURE_ALIASES=new Set([MANUAL_PASSIVE_CAPTURE_MODE,'MANUAL_NAVIGATION_PASSIVE_CAPTURE']);
const FULL_REFRESH_EXTENSION_MODE='FULL_REFRESH_EXTENSION_AUTO';
const LOCAL_EXTENSION_MODES=new Set([...MANUAL_PASSIVE_CAPTURE_ALIASES,FULL_REFRESH_EXTENSION_MODE]);

export function createCatalogCampaignService(db,{ now=() => new Date().toISOString(),screenElectronicRisk=screenCatalogElectronicRisk }={}) {
  const repository=createCatalogCampaignRepository(db,{ now });

  function createCampaignRecord({ id=null,name,campaignType='expansion',profile,baselinePoolCount=0,targetCount=null,browserContext=null,
    configExtras={} }) {
    const validated=validateCategoryProfile(profile);
    if (campaignType==='expansion') {
      const consistency=repository.getBaselineConsistency(validated);
      if (consistency.activePoolVersionExists && !consistency.consistent) throw new AppError(
        'Active Pool Version与active memberships不一致，拒绝继续Expansion。',{
          code:'CATALOG_BASELINE_INCONSISTENT',details:consistency
        }
      );
      if (consistency.activePoolVersionExists && baselinePoolCount>0 && consistency.activePoolVersionCount!==Number(baselinePoolCount)) {
        throw new AppError('Active Pool Version数量与请求baseline不一致。',{
          code:'CATALOG_BASELINE_INCONSISTENT',details:{ ...consistency,expectedBaseline:Number(baselinePoolCount) }
        });
      }
    }
    let campaign=repository.createCampaign({ id:id || undefined,name,campaignType,categoryKey:validated.category_key,
      categoryProfileVersion:validated.category_profile_version,targetGate:validated.business_rules.default_gate,
      targetCount:targetCount ?? validated.target_count,baselinePoolCount,config:{ categoryProfile:validated,...configExtras } });
    if (browserContext) campaign=repository.setCampaignBrowserContext(campaign.id,browserContext);
    if (campaignType==='refresh' || campaignType==='expansion') {
      repository.captureCampaignBaseline(campaign.id);
      campaign=repository.getCampaign(campaign.id);
    }
    return campaign;
  }

  function createCampaign(input) {
    return transaction(db,() => createCampaignRecord(input));
  }

  function createOperatorManualCampaign(input) {
    plainObject(input,'Operator Campaign create request');
    const profile=validateCategoryProfile(input.profile);
    const requestedNewCount=optionalPositiveInteger(input.requestedNewCount,'requestedNewCount');
    if (requestedNewCount===null) throw new AppError('requestedNewCount必须是正整数。',{ code:'OPERATOR_CAMPAIGN_INVALID' });
    const campaignName=requiredString(input.campaignName,'campaignName',256);
    const requestId=requiredString(input.requestId,'requestId',128);
    return transaction(db,() => {
      const replay=repository.findOperatorCampaignByRequestId(requestId);
      if (replay) return exactOperatorReplay(replay,{ profile,requestedNewCount,campaignName,requestId });
      if (repository.listActiveRpaQueues().length) throw new AppError('已有活跃Catalog RPA来源，拒绝创建或猜测恢复。',{
        code:'CATALOG_RPA_CLAIM_CONFLICT',retriable:true });
      if (repository.findCampaignByName(campaignName)) throw new AppError('Campaign名称已存在。',{
        code:'CAMPAIGN_NAME_CONFLICT',details:{ campaignName } });
      const consistency=repository.getBaselineConsistency(profile);
      if (!consistency.activePoolVersionExists || consistency.activePoolVersionCount<=0) throw new AppError(
        'Operator Campaign要求已存在非空Active Pool。',{ code:'INITIAL_ACTIVE_POOL_REQUIRED',details:consistency });
      if (!consistency.consistent || consistency.activePoolVersionRecordCount!==1
        || consistency.activePoolDeclaredCount!==consistency.activePoolVersionCount
        || consistency.activePoolRowCount!==consistency.activePoolVersionCount
        || consistency.activePoolGoodsIdCount!==consistency.activePoolVersionCount
        || consistency.activeMembershipCount!==consistency.activePoolVersionCount
        || consistency.intersectionCount!==consistency.activePoolVersionCount) throw new AppError('Active Pool与active memberships不一致。',{
        code:'CATALOG_BASELINE_INCONSISTENT',details:consistency });
      const baselineCount=consistency.activePoolVersionCount;
      const targetCount=baselineCount+requestedNewCount;
      if (targetCount>profile.target_count) throw new AppError('Campaign target超过Category Profile上限。',{
        code:'CATALOG_TARGET_INVALID',details:{ baselineCount,requestedNewCount,targetCount,profileTarget:profile.target_count } });
      let campaign=createCampaignRecord({ name:campaignName,campaignType:'expansion',profile,baselinePoolCount:baselineCount,targetCount,
        browserContext:{ profileName:'Temu1店',profileDirectory:'Profile 10',controlMode:MANUAL_PASSIVE_CAPTURE_MODE },configExtras:{ operatorCreate:{
          requestId,requestedNewCount,captureMode:MANUAL_PASSIVE_CAPTURE_MODE
        } } });
      if (campaign.baselinePoolCount!==baselineCount || campaign.baselinePoolVersionId!==consistency.activePoolVersionId) throw new AppError(
        'Campaign冻结baseline与创建时Active Pool不一致。',{ code:'CATALOG_BASELINE_INCONSISTENT' });
      const source=repository.createSource(campaign,{ sourceKey:'manual-bind-passive',sourceType:'category',
        sortOrder:profile.sort_order,priority:1,targetQuota:requestedNewCount,navigationHint:{
          entryMethod:'human_navigation_only',automaticNavigation:false,automaticScroll:false,automaticPagination:false,
          automaticSeeMore:false,automaticCategorySwitching:false,automaticSortSwitching:false,
          automaticCaptchaHandling:false,directApi:false
        } });
      campaign=repository.transitionCampaign(campaign.id,'running');
      const pending=repository.getNextRpaQueue(campaign.id);
      const queue=repository.claimRpaQueue(pending.id,createId('catalog_claim'));
      if (!queue) throw new AppError('Operator Campaign Queue领取冲突。',{ code:'CATALOG_RPA_CLAIM_CONFLICT' });
      repository.createSourceRun(source.id,queue.attemptCount);
      repository.transitionSource(source.id,'capturing');
      const checkpoint={ runner_state:'UNBOUND',capture_mode:MANUAL_PASSIVE_CAPTURE_MODE,capture_paused:true,
        automatic_scroll:false,automatic_navigation:false,automatic_pagination:false,automatic_see_more:false,
        automatic_category_switching:false,automatic_sort_switching:false,automatic_captcha_handling:false,direct_api:false,
        capture_origin_unique:baselineCount,session_target:targetCount,last_action:'operator_campaign_created' };
      const claimed=repository.transitionRpaQueue(queue.id,'capturing',{ checkpoint,clearError:true });
      campaign=repository.getCampaign(campaign.id);
      return operatorSummary(campaign,claimed,false);
    });
  }

  function describeOperatorProfile(inputProfile) {
    const profile=validateCategoryProfile(inputProfile);
    const baseline=repository.getBaselineConsistency(profile);
    return { category_key:profile.category_key,category_profile_version:profile.category_profile_version,
      display_name:profile.display_name,site_country:profile.site_country,language:profile.language,currency:profile.currency,
      sort_order:profile.sort_order,profile_target_count:profile.target_count,
      active_pool_count:baseline.activePoolVersionCount,active_pool_version_id:baseline.activePoolVersionId,
      capture_mode:MANUAL_PASSIVE_CAPTURE_MODE,available:Boolean(baseline.activePoolVersionExists
        && baseline.activePoolVersionCount>0 && baseline.consistent),baseline_consistency:baseline };
  }

  function exactOperatorReplay(campaign,input) {
    const create=campaign.config?.operatorCreate;
    if (campaign.categoryKey!==input.profile.category_key
      || campaign.categoryProfileVersion!==input.profile.category_profile_version
      || campaign.name!==input.campaignName || create?.requestId!==input.requestId
      || create?.requestedNewCount!==input.requestedNewCount
      || create?.captureMode!==MANUAL_PASSIVE_CAPTURE_MODE) throw new AppError(
      '相同request_id对应的创建参数不同。',{ code:'OPERATOR_CREATE_IDEMPOTENCY_CONFLICT' });
    const queues=repository.listRpaQueues(campaign.id);
    if (queues.length!==1) throw new AppError('幂等Campaign的Queue上下文不唯一。',{ code:'OPERATOR_CREATE_IDEMPOTENCY_CONFLICT' });
    return operatorSummary(campaign,queues[0],true);
  }

  function operatorSummary(campaign,queue,idempotentReplay) {
    const requestedNewCount=Number(campaign.config?.operatorCreate?.requestedNewCount ?? 0);
    return { campaignId:campaign.id,categoryKey:campaign.categoryKey,categoryProfileVersion:campaign.categoryProfileVersion,
      campaignName:campaign.name,baselineCount:campaign.baselinePoolCount,requestedNewCount,targetCount:campaign.targetCount,
      captureMode:MANUAL_PASSIVE_CAPTURE_MODE,currentUnique:campaign.nonElectronicUniqueCount,
      remaining:Math.max(0,campaign.targetCount-campaign.nonElectronicUniqueCount),status:campaign.status,
      bindingStatus:queue.checkpoint?.runner_state ?? 'UNBOUND',idempotentReplay };
  }

  function transitionCampaign(campaignId,status,options={}) {
    const campaign=requireCampaign(campaignId);
    if (campaign.status===status) return campaign;
    if (!CAMPAIGN_TRANSITIONS[campaign.status]?.includes(status)) throw new AppError(
      `Catalog Campaign状态 ${campaign.status} 不允许转为 ${status}。`,
      { code:'CATALOG_CAMPAIGN_INVALID_TRANSITION',details:{ campaignId,currentStatus:campaign.status,nextStatus:status } }
    );
    return repository.transitionCampaign(campaignId,status,options);
  }

  function updateBrowserContext(campaignId,browserContext={}) {
    const campaign=requireCampaign(campaignId);
    if (['completed','failed','cancelled'].includes(campaign.status)) throw new AppError(
      '终态Campaign不能修改浏览器控制上下文。',{ code:'CATALOG_CAMPAIGN_TERMINAL' }
    );
    return repository.setCampaignBrowserContext(campaign.id,{
      profileName:optionalString(browserContext.profileName,'profileName',128),
      profileDirectory:optionalString(browserContext.profileDirectory,'profileDirectory',256),
      controlMode:requiredString(browserContext.controlMode,'controlMode',128)
    });
  }

  function createSource(campaignId,input) {
    const campaign=requireCampaign(campaignId);
    if (['completed','failed','cancelled'].includes(campaign.status)) throw new AppError('终态Campaign不能新增来源。',{ code:'CATALOG_CAMPAIGN_TERMINAL' });
    if (!['category','search','product_family'].includes(input.sourceType)) throw new AppError('Catalog Source类型无效。',{ code:'CATALOG_SOURCE_INVALID' });
    if (!String(input.sourceKey ?? '').trim()) throw new AppError('Catalog Source缺少source_key。',{ code:'CATALOG_SOURCE_INVALID' });
    return transaction(db,() => repository.createSource(campaign,{ ...input,sortOrder:input.sortOrder ?? campaign.config?.categoryProfile?.sort_order }));
  }

  function captureBatch({ campaignId,sourceId,batchId,pageUrl=null,pageTitle=null,capturedAt=now(),cards=[],
    categoryKey=null,categoryProfileVersion=null,pageContext=null }) {
    const campaign=requireCampaign(campaignId);
    const source=requireSource(sourceId);
    if (source.campaignId!==campaign.id || source.categoryKey!==campaign.categoryKey) throw new AppError('Source不属于当前Category Campaign。',{ code:'CATALOG_SOURCE_CAMPAIGN_MISMATCH' });
    if (!['running','pending'].includes(campaign.status)) throw new AppError('当前Campaign状态不能接收批次。',{ code:'CATALOG_CAMPAIGN_INVALID_TRANSITION' });
    if (!String(batchId ?? '').trim()) throw new AppError('Catalog batch缺少batch_id。',{ code:'CATALOG_BATCH_INVALID' });
    if (!Array.isArray(cards)) throw new AppError('Catalog batch cards必须是数组。',{ code:'CATALOG_BATCH_INVALID' });
    const payloadHash=hash({ campaignId,sourceId,batchId,pageUrl,pageTitle,cards,categoryKey,categoryProfileVersion,pageContext });
    return transaction(db,() => {
      const registered=repository.registerBatch({ campaignId,sourceId,batchId:String(batchId),pageUrl,pageTitle,
        capturedAt,payloadHash,receivedCount:cards.length });
      if (!registered.inserted) {
        if (registered.batch.payloadHash!==payloadHash) throw new AppError('相同batch_id收到不同内容，已拒绝。',{
          code:'CATALOG_BATCH_IDEMPOTENCY_CONFLICT',details:{ campaignId,sourceId,batchId }
        });
        return { idempotentReplay:true,batch:registered.batch,campaign:repository.getCampaign(campaignId) };
      }
      let stagingCount=0,excludedCount=0,duplicateCount=0;
      let serviceObserved=0,electronicExcluded=0,otherBusinessExcluded=0,eligibleGoods=0,acceptedGoods=0;
      let stoppedDueToTarget=0,targetGateStopped=false;
      let acceptedNonElectronic=campaign.nonElectronicUniqueCount;
      for (const raw of cards) {
        serviceObserved+=1;
        const goodsId=normalizeGoodsId(raw.goods_id ?? raw.goodsId);
        const platform='temu';
        const screening=screenElectronicRisk(raw);
        const previouslyExcluded=repository.hasCampaignExclusion(campaignId,goodsId);
        const screeningDecision=screening.decision==='exclude' || previouslyExcluded ? 'exclude':screening.decision;
        repository.recordSourceObservation({ campaignId,sourceId,batchId:String(batchId),goodsId,
          screeningDecision,observedAt:capturedAt,raw });
        if (screeningDecision==='exclude') {
          for (let index=0;index<screening.codes.length;index+=1) repository.recordExclusion({
            campaignId,sourceId,batchId:String(batchId),goodsId,title:raw.title ?? null,
            exclusionCode:screening.codes[index],exclusionReason:screening.reasons[index] ?? '电子硬排除',
            classifierVersion:screening.classifierVersion,confidence:screening.confidence,detectedAt:capturedAt
          });
          repository.removeStagingForExclusion(campaignId,goodsId);
          excludedCount+=1;electronicExcluded+=1;
          continue;
        }
        if (screening.decision==='passed') eligibleGoods+=1;
        const baselineItem=campaign.campaignType==='expansion' && repository.isCampaignBaselineItem(campaign.id,platform,goodsId);
        const existingStaging=campaign.campaignType==='expansion' && repository.hasCampaignStagingItem(campaign.id,platform,goodsId);
        if ((campaign.campaignType==='refresh' || campaign.campaignType==='expansion') && screening.decision==='passed'
          && acceptedNonElectronic>=campaign.targetCount && (campaign.campaignType==='refresh' || (!baselineItem && !existingStaging))) {
          stoppedDueToTarget+=1;targetGateStopped=true;break;
        }
        const result=repository.upsertStaging(campaign,source,String(batchId),normalizeCard(raw,goodsId,capturedAt),screening.decision);
        if (result.inserted) {
          stagingCount+=1;
          if (screening.decision==='passed' && (campaign.campaignType!=='expansion' || !baselineItem)) {
            acceptedNonElectronic+=1;acceptedGoods+=1;
          }
        } else duplicateCount+=1;
      }
      const batch=repository.completeBatch(registered.batch.id,{ stagingCount,excludedCount,duplicateCount });
      const refreshedCampaign=repository.refreshCampaignCounts(campaignId);
      const audit={ campaignTarget:campaign.targetCount,targetReached:refreshedCampaign.nonElectronicUniqueCount>=campaign.targetCount,
        serviceObserved,electronicExcluded,otherBusinessExcluded,eligibleGoods,acceptedGoods,stoppedDueToTarget,
        unprocessedAfterTarget:targetGateStopped ? Math.max(0,cards.length-serviceObserved):0,failed:0,
        campaignStagingDeduped:duplicateCount };
      return { idempotentReplay:false,batch,campaign:refreshedCampaign,audit };
    });
  }

  function getCaptureContext(campaignId,sourceId) {
    const campaign=requireCampaign(campaignId);
    const source=requireSource(sourceId);
    if (source.campaignId!==campaign.id || source.categoryKey!==campaign.categoryKey) throw new AppError('Source不属于当前Category Campaign。',{ code:'CATALOG_SOURCE_CAMPAIGN_MISMATCH' });
    if (campaign.status!=='running') throw new AppError('Catalog Campaign当前未运行。',{ code:'CAMPAIGN_NOT_ACTIVE' });
    const profile=validateCategoryProfile(campaign.config?.categoryProfile);
    const activePool=db.prepare("SELECT id FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get(campaign.categoryKey);
    return { campaign:{ id:campaign.id,status:campaign.status,categoryKey:campaign.categoryKey,
      categoryProfileVersion:campaign.categoryProfileVersion,targetGate:campaign.targetGate,targetCount:campaign.targetCount,
      browserProfileName:campaign.browserProfileName,browserProfileDirectory:campaign.browserProfileDirectory,
      browserControlMode:campaign.browserControlMode,baselinePoolCount:campaign.baselinePoolCount,
      cdpRequired:!LOCAL_EXTENSION_MODES.has(campaign.browserControlMode),
      extensionPassiveRequired:LOCAL_EXTENSION_MODES.has(campaign.browserControlMode),
      localServerEndpoint:LOCAL_EXTENSION_MODES.has(campaign.browserControlMode)?'http://127.0.0.1:37821':null,
      rawObservedCount:campaign.rawObservedCount,electronicExcludedCount:campaign.electronicExcludedCount,
      nonElectronicUniqueCount:campaign.nonElectronicUniqueCount,businessEligibleCount:campaign.businessEligibleCount },
    source,profile,poolVersionId:activePool?.id??null };
  }

  function captureExtensionBatch(input) {
    plainObject(input,'Catalog batch');
    const campaignId=requiredString(input.campaign_id,'campaign_id',128);
    const sourceId=requiredString(input.source_id,'source_id',128);
    const context=getCaptureContext(campaignId,sourceId);
    const profile=context.profile;
    const categoryKey=requiredString(input.category_key,'category_key',128);
    const profileVersion=requiredString(input.category_profile_version,'category_profile_version',128);
    if (categoryKey!==profile.category_key || categoryKey!==context.source.categoryKey) throw new AppError('Catalog批次Category与Campaign不一致。',{ code:'CATEGORY_MISMATCH' });
    if (profileVersion!==profile.category_profile_version) throw new AppError('Catalog批次Category Profile版本不一致。',{ code:'CATEGORY_MISMATCH' });
    const batchId=requiredString(input.batch_id,'batch_id',128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(batchId)) throw new AppError('Catalog batch_id格式无效。',{ code:'CATALOG_BATCH_INVALID' });
    const pageUrl=validatePageUrl(input.page_url);
    if (profile.site_country==='DE' && profile.language==='en' && !new URL(pageUrl).pathname.toLowerCase().includes('/de-en/')) throw new AppError('Catalog页面不是Germany / English站点路径。',{ code:'CATALOG_CONTEXT_MISMATCH' });
    const capturedAt=isoTimestamp(input.captured_at,'captured_at');
    const pageContext=validatePageContext(input.page_context,profile);
    if (!Array.isArray(input.cards) || input.cards.length===0) throw new AppError('当前页面没有有效商品卡。',{ code:'NO_PRODUCT_CARDS' });
    if (input.cards.length>500) throw new AppError('Catalog batch商品卡数量超过500。',{ code:'CATALOG_BATCH_INVALID' });
    const cards=input.cards.map((card,index) => validateExtensionCard(card,index));
    if (MANUAL_PASSIVE_CAPTURE_ALIASES.has(context.campaign.browserControlMode)) validateManualPassiveBatch(input.capture_mode,cards,input.page_binding,{pageUrl,pageContext,context});
    if (context.campaign.browserControlMode===FULL_REFRESH_EXTENSION_MODE && cards.some(card =>
      !card.raw_sales_text || card.parsed_sales_count===null || card.final_sales_count===null || card.sales_count===null
    )) throw new AppError('Full Refresh批次只接受保留原始销量文本且成功解析的商品。',{ code:'FULL_REFRESH_SALES_EVIDENCE_REQUIRED' });
    const result=captureBatch({ campaignId,sourceId,batchId,pageUrl,pageTitle:optionalString(input.page_title,'page_title',500),
      capturedAt,cards,categoryKey,categoryProfileVersion:profileVersion,pageContext });
    return { ...result,campaign:{ ...result.campaign,manualReviewCount:null,
      refreshProgress:result.campaign.campaignType==='refresh' ? repository.getRefreshComparison(result.campaign.id):null } };
  }

  function getStatus(campaignId) {
    const campaign=requireCampaign(requiredString(campaignId,'campaign_id',128));
    return { campaign,queues:repository.listRpaQueues(campaign.id),sourceContributions:repository.listSourceContributions(campaign.id),
      qualityMetrics:repository.getQualityMetrics(campaign.id),
      refreshComparison:campaign.campaignType==='refresh' ? repository.getRefreshComparison(campaign.id):null,
      navigationRiskMetrics:campaign.campaignType==='refresh' ? repository.getNavigationRiskMetrics(campaign.id):null,
      expansionComparison:campaign.campaignType==='expansion' ? repository.getExpansionComparison(campaign.id):null,
      expansionQualityMetrics:campaign.campaignType==='expansion' ? repository.getExpansionQualityMetrics(campaign.id):null,
      expansionCheckpoints:campaign.campaignType==='expansion' ? repository.listExpansionCheckpoints(campaign.id):[],
      materialization:campaign.campaignType==='expansion' ? repository.getExpansionMaterialization(campaign.id):repository.getRefreshMaterialization(campaign.id),
      refreshAudit:repository.getRefreshAudit(campaign.id),expansionAudit:repository.getExpansionAudit(campaign.id) };
  }

  function recordExpansionCheckpoint(campaignId,milestoneCount) {
    return transaction(db,() => {
      const campaign=requireCampaign(campaignId);const milestone=Number(milestoneCount);
      if (campaign.campaignType!=='expansion' || campaign.status!=='running') throw new AppError(
        '只有运行中的Expansion Campaign可以记录中间checkpoint。',{ code:'CATALOG_EXPANSION_REQUIRED' });
      if (!Number.isInteger(milestone) || milestone<=campaign.baselinePoolCount || milestone>=campaign.targetCount) throw new AppError(
        'Expansion checkpoint必须位于baseline与最终target之间。',{ code:'CATALOG_EXPANSION_CHECKPOINT_INVALID' });
      const comparison=repository.getExpansionComparison(campaign.id);const quality=repository.getExpansionQualityMetrics(campaign.id);
      if (comparison.activeCandidateCount<milestone) throw new AppError('Expansion checkpoint尚未达到。',{
        code:'CATALOG_EXPANSION_CHECKPOINT_NOT_REACHED',retriable:true,
        details:{ milestone,actual:comparison.activeCandidateCount }
      });
      if (quality.duplicateGoodsIdCount!==0 || quality.distinctGoodsIdCount!==comparison.activeCandidateCount) throw new AppError(
        'Expansion checkpoint唯一性检查失败。',{ code:'CATALOG_EXPANSION_CHECKPOINT_INVALID' });
      const checkpoint=repository.recordExpansionCheckpoint(campaign.id,milestone);
      if (checkpoint.integrityCheck!=='ok') throw new AppError('Expansion checkpoint SQLite完整性检查失败。',{
        code:'CATALOG_EXPANSION_CHECKPOINT_INVALID' });
      return checkpoint;
    });
  }

  function claimNextSource(campaignId) {
    return transaction(db,() => {
      const campaign=requireCampaign(campaignId);
      if (campaign.status!=='running') throw new AppError('Catalog Campaign当前未运行。',{ code:'CAMPAIGN_NOT_ACTIVE' });
      if (repository.listActiveRpaQueues().some(queue => queue.campaignId===campaign.id)) throw new AppError('当前Campaign已有活跃Catalog RPA来源。',{ code:'CATALOG_RPA_CLAIM_CONFLICT',retriable:true });
      const pending=repository.getNextRpaQueue(campaign.id);
      if (!pending) return { idle:true,campaignId:campaign.id,queue:null };
      const queue=repository.claimRpaQueue(pending.id,createId('catalog_claim'));
      if (!queue) throw new AppError('Catalog RPA Queue已被其他流程领取。',{ code:'CATALOG_RPA_CLAIM_CONFLICT',retriable:true });
      repository.createSourceRun(queue.sourceId,queue.attemptCount);
      return { idle:false,...rpaContext(queue) };
    });
  }

  function currentRpaContext() {
    const queues=repository.listActiveRpaQueues().filter(queue => ['running','manual_required'].includes(requireCampaign(queue.campaignId).status));
    if (!queues.length) throw new AppError('没有已领取的Catalog RPA来源。',{ code:'CATALOG_RPA_NOT_CLAIMED' });
    if (queues.length>1) throw new AppError('存在多个活跃Catalog RPA来源，拒绝猜测当前上下文。',{ code:'CATALOG_RPA_CONTEXT_AMBIGUOUS' });
    return rpaContext(queues[0],{ exposeClaimToken:false });
  }

  function sourceOpened(input) {
    const queue=requireClaim(input);
    const checkpoint=mergeCheckpoint(queue,input.checkpoint,{ phase:'waiting_page_ready',pageUrl:optionalString(input.page_url,'page_url',2048),openedAt:now() });
    repository.transitionSource(queue.sourceId,'waiting_page_ready');
    return repository.transitionRpaQueue(queue.id,'waiting_page_ready',{ checkpoint,clearError:true });
  }

  function saveRpaCheckpoint(input) {
    const queue=requireClaim(input);
    if (!['opening','waiting_page_ready','capturing','waiting_load_more'].includes(queue.status)) throw new AppError('当前Catalog RPA状态不能保存运行checkpoint。',{ code:'CATALOG_RPA_INVALID_TRANSITION' });
    const nextStatus=input.status==='waiting_load_more' ? 'waiting_load_more':'capturing';
    validateLoadStateCheckpoint(input.checkpoint);
    const checkpoint=mergeCheckpoint(queue,input.checkpoint,{ phase:nextStatus,lastCheckpointAt:now() });
    repository.transitionSource(queue.sourceId,nextStatus);
    return repository.transitionRpaQueue(queue.id,nextStatus,{ checkpoint,clearError:true });
  }

  function markRpaManualRequired(input) {
    const queue=requireClaim(input);
    const errorCode=requiredString(input.error_code,'error_code',128);
    const loadState=errorCode==='CAPTCHA_OR_LOGIN' || errorCode==='BGN_VERIFICATION'
      ? 'MANUAL_VERIFICATION_REQUIRED':errorCode==='LISTING_CONTEXT_UNHEALTHY' ? 'LISTING_CONTEXT_UNHEALTHY':
        errorCode==='LOAD_MORE_RETRYABLE_EXHAUSTED' ? 'LOAD_MORE_RETRYABLE':null;
    const checkpoint=mergeCheckpoint(queue,input.checkpoint,{ phase:'manual_required',...(loadState ? { load_state:loadState }:{}),
      manualGate:{ errorCode,message:optionalString(input.error_message,'error_message',1000),at:now() } });
    repository.transitionSource(queue.sourceId,'manual_required',{ errorCode });
    repository.transitionCampaign(queue.campaignId,'manual_required');
    return repository.transitionRpaQueue(queue.id,'manual_required',{ checkpoint,errorCode,errorMessage:optionalString(input.error_message,'error_message',1000) });
  }

  function resumeRpa(input) {
    const queue=requireClaim(input);
    if (queue.status!=='manual_required') throw new AppError('只有manual_required队列可以恢复。',{ code:'CATALOG_RPA_INVALID_TRANSITION' });
    const checkpoint=mergeCheckpoint(queue,input.checkpoint,{ phase:'opening',resumedAt:now(),manualGateResolved:true });
    repository.transitionCampaign(queue.campaignId,'running');
    repository.transitionSource(queue.sourceId,'opening');
    return repository.transitionRpaQueue(queue.id,'opening',{ checkpoint,clearError:true });
  }

  function saveExtensionCheckpoint(input) {
    const queue=requireExtensionQueue(input);
    if (!['opening','waiting_page_ready','capturing','waiting_load_more'].includes(queue.status)) throw new AppError(
      '当前Catalog Extension状态不能保存运行checkpoint。',{ code:'CATALOG_RPA_INVALID_TRANSITION' });
    validateLoadStateCheckpoint(input.checkpoint);
    const nextStatus=input.status==='waiting_load_more' ? 'waiting_load_more':'capturing';
    const campaign=requireCampaign(queue.campaignId);
    const checkpoint=mergeCheckpoint(queue,input.checkpoint,{ phase:nextStatus,
      controlMode:campaign.browserControlMode ?? 'extension_auto_runner',lastCheckpointAt:now() });
    repository.transitionSource(queue.sourceId,nextStatus);
    return withoutClaimToken(repository.transitionRpaQueue(queue.id,nextStatus,{ checkpoint,clearError:true }));
  }

  function markExtensionManualRequired(input) {
    const queue=requireExtensionQueue(input);
    return withoutClaimToken(markRpaManualRequired({ ...input,queue_id:queue.id,claim_token:queue.claimToken }));
  }

  function resumeExtensionRunner(input) {
    const queue=requireExtensionQueue(input);
    return withoutClaimToken(resumeRpa({ ...input,queue_id:queue.id,claim_token:queue.claimToken }));
  }

  function completeRpaSource(input) {
    return transaction(db,() => {
      const queue=requireClaim(input);
      if (!['capturing','waiting_load_more','waiting_page_ready','opening'].includes(queue.status)) throw new AppError('当前Catalog RPA状态不能完成source。',{ code:'CATALOG_RPA_INVALID_TRANSITION' });
      const contribution=repository.listSourceContributions(queue.campaignId).find(item => item.sourceId===queue.sourceId) ?? {};
      validateLoadStateCheckpoint(input.checkpoint);
      const stopReason=requiredString(input.stop_reason ?? 'SOURCE_COMPLETE','stop_reason',128);
      const candidate=mergeCheckpoint(queue,input.checkpoint);
      if (stopReason==='SOURCE_EXHAUSTED' && NON_EXHAUSTING_LOAD_STATES.has(candidate.load_state)) {
        throw new AppError('当前加载状态不能判定Source Exhausted，必须保留checkpoint并等待恢复。',{
          code:'CATALOG_SOURCE_EXHAUSTION_NOT_PROVEN',retriable:true,
          details:{ loadState:candidate.load_state,stopReason }
        });
      }
      const checkpoint={ ...candidate,phase:'completed',stopReason,completedAt:now() };
      const metrics={ ...normalizeRpaMetrics(checkpoint),...contribution,stopReason:checkpoint.stopReason };
      repository.finishSourceRun(queue.sourceId,metrics);
      repository.transitionSource(queue.sourceId,'completed');
      const result=repository.transitionRpaQueue(queue.id,'completed',{ checkpoint,clearError:true });
      let updated=repository.refreshCampaignCounts(queue.campaignId);let skippedPendingSources=0;
      if (updated.campaignType==='expansion' && updated.nonElectronicUniqueCount>=updated.targetCount) {
        skippedPendingSources=repository.completePendingSources(queue.campaignId);
        updated=repository.refreshCampaignCounts(queue.campaignId);
      }
      return { queue:result,campaign:updated,contribution,skippedPendingSources };
    });
  }

  function submitQa(campaignId,{ passed,summary={} }) {
    const campaign=requireCampaign(campaignId);
    if (campaign.status==='running') transitionCampaign(campaignId,'qa_pending');
    const current=requireCampaign(campaignId);
    if (current.status!=='qa_pending') throw new AppError('Campaign不在qa_pending。',{ code:'CATALOG_CAMPAIGN_INVALID_TRANSITION' });
    return repository.transitionCampaign(campaignId,passed ? 'completed':'qa_failed',{
      qaStatus:passed ? 'passed':'failed',qaSummary:summary,finished:passed
    });
  }

  function recordNavigationRisk(campaignId,input) {
    const campaign=requireCampaign(campaignId);
    if (campaign.campaignType!=='refresh') throw new AppError('导航风险观察只允许写入refresh Campaign。',{ code:'CATALOG_REFRESH_REQUIRED' });
    const allowedHistorical=new Set(['not_checked','available','sold_out','context_mismatch','unreachable']);
    const allowedFresh=new Set(['not_checked','recovered','available','not_resolved']);
    const historicalUrlStatus=input.historicalUrlStatus ?? 'not_checked';
    const freshNavigationStatus=input.freshNavigationStatus ?? 'not_checked';
    if (!allowedHistorical.has(historicalUrlStatus) || !allowedFresh.has(freshNavigationStatus)) {
      throw new AppError('导航风险状态无效。',{ code:'CATALOG_NAVIGATION_RISK_INVALID' });
    }
    return transaction(db,() => {
      repository.recordNavigationRisk(campaign.id,{ ...input,historicalUrlStatus,freshNavigationStatus });
      return repository.getNavigationRiskMetrics(campaign.id);
    });
  }

  function materializeRefresh(campaignId) {
    return transaction(db,() => {
      const campaign=requireCampaign(campaignId);
      if (campaign.campaignType!=='refresh') throw new AppError('只有refresh Campaign可以生成刷新snapshot。',{ code:'CATALOG_REFRESH_REQUIRED' });
      if (campaign.status!=='running') throw new AppError('Refresh Campaign必须处于running才能生成snapshot。',{ code:'CATALOG_CAMPAIGN_INVALID_TRANSITION' });
      if (repository.listRpaQueues(campaign.id).some(queue => queue.status!=='completed')) {
        throw new AppError('所有Catalog RPA来源完成后才能生成refresh snapshot。',{ code:'CATALOG_REFRESH_SOURCES_INCOMPLETE' });
      }
      return repository.materializeRefresh(campaign);
    });
  }

  function evaluateRefreshQa(campaignId) {
    return transaction(db,() => {
      const campaign=requireCampaign(campaignId);
      if (campaign.campaignType!=='refresh') throw new AppError('只有refresh Campaign可以执行Refresh QA。',{ code:'CATALOG_REFRESH_REQUIRED' });
      if (campaign.status!=='running') throw new AppError('Refresh QA要求Campaign处于running。',{ code:'CATALOG_CAMPAIGN_INVALID_TRANSITION' });
      const materialization=repository.getRefreshMaterialization(campaign.id);
      if (!materialization) throw new AppError('Refresh QA前必须先生成products与snapshot。',{ code:'CATALOG_REFRESH_NOT_MATERIALIZED' });
      const comparison=repository.getRefreshComparison(campaign.id);
      const navigation=repository.getNavigationRiskMetrics(campaign.id);
      const quality=repository.getQualityMetrics(campaign.id);
      const checks={
        targetGate:campaign.nonElectronicUniqueCount>=campaign.targetCount,
        baselineFrozen:comparison.old_active_count===campaign.baselinePoolCount,
        comparisonBalanced:comparison.intersection_count+comparison.new_goods_count===comparison.new_observed_unique_count
          && comparison.intersection_count+comparison.not_seen_count===comparison.old_active_count,
        snapshotsExact:materialization.snapshotsInserted===comparison.new_observed_unique_count,
        reviewsUnchanged:materialization.reviewsBefore===materialization.reviewsAfter,
        duplicateGoodsId:quality.duplicateGoodsIdCount===0,
        electronicInStaging:quality.electronicInStagingCount===0,
        goodsIdCoverage:quality.total===comparison.new_observed_unique_count,
        titleCoverage:quality.titleCoverage>=0.95,priceCoverage:quality.priceCoverage>=0.95,
        imageCoverage:quality.imageCoverage>=0.95,salesCoverage:quality.salesCoverage>=0.90,
        ratingCoverage:quality.ratingCoverage>=0.90,reviewCountCoverage:quality.reviewCountCoverage>=0.90
      };
      const passed=Object.values(checks).every(Boolean);
      const audit={ oldActiveCount:comparison.old_active_count,newObservedUniqueCount:comparison.new_observed_unique_count,
        intersectionCount:comparison.intersection_count,newGoodsCount:comparison.new_goods_count,notSeenCount:comparison.not_seen_count,
        historicalUrlAvailableCount:navigation.historical_url_available_count,
        historicalUrlSoldOutCount:navigation.historical_url_sold_out_count,
        freshNavigationRecoveredCount:navigation.fresh_navigation_recovered_count,
        categoryCardAvailableCount:navigation.category_card_available_count,
        searchContextMismatchCount:navigation.search_context_mismatch_count,
        navigationNotResolvedCount:navigation.navigation_not_resolved_count,
        duplicateGoodsIdCount:quality.duplicateGoodsIdCount,electronicInStagingCount:quality.electronicInStagingCount,
        manualReviewCount:quality.manualReviewCount,titleCoverage:quality.titleCoverage,priceCoverage:quality.priceCoverage,
        imageCoverage:quality.imageCoverage,salesCoverage:quality.salesCoverage,ratingCoverage:quality.ratingCoverage,
        reviewCountCoverage:quality.reviewCountCoverage,qaPassed:passed,
        qaDetails:{ checks,materialization,targetGate:campaign.targetGate,targetCount:campaign.targetCount,
          actual:gateValue(campaign),notSeenSemantics:'observation_only_membership_preserved' } };
      repository.saveRefreshAudit(campaign.id,audit);
      repository.transitionCampaign(campaign.id,'qa_pending');
      const completed=repository.transitionCampaign(campaign.id,passed ? 'completed':'qa_failed',{
        qaStatus:passed ? 'passed':'failed',qaSummary:audit.qaDetails,finished:passed
      });
      return { campaign:completed,audit:repository.getRefreshAudit(campaign.id),comparison,navigation,quality,materialization };
    });
  }

  function materializeExpansion(campaignId) {
    return transaction(db,() => {
      const campaign=requireCampaign(campaignId);
      if (campaign.campaignType!=='expansion') throw new AppError('只有expansion Campaign可以生成扩容snapshot。',{ code:'CATALOG_EXPANSION_REQUIRED' });
      if (campaign.status!=='running') throw new AppError('Expansion Campaign必须处于running才能物化。',{ code:'CATALOG_CAMPAIGN_INVALID_TRANSITION' });
      if (campaign.baselinePoolCount<=0 || campaign.targetCount<=campaign.baselinePoolCount) throw new AppError('Expansion baseline/target无效。',{ code:'CATALOG_EXPANSION_BASELINE_INVALID' });
      if (campaign.nonElectronicUniqueCount<campaign.targetCount) throw new AppError('Expansion Gate尚未达到。',{ code:'CATALOG_POOL_SAFETY_REJECTED',retriable:true });
      if (repository.listRpaQueues(campaign.id).some(queue => queue.status!=='completed')) {
        throw new AppError('所有Expansion来源完成后才能生成snapshot。',{ code:'CATALOG_EXPANSION_SOURCES_INCOMPLETE' });
      }
      return repository.materializeExpansion(campaign);
    });
  }

  function evaluateExpansionQa(campaignId) {
    return transaction(db,() => {
      const campaign=requireCampaign(campaignId);
      if (campaign.campaignType!=='expansion') throw new AppError('只有expansion Campaign可以执行扩容QA。',{ code:'CATALOG_EXPANSION_REQUIRED' });
      if (!['running','qa_failed'].includes(campaign.status)) throw new AppError('Expansion QA要求Campaign处于running或qa_failed。',{ code:'CATALOG_CAMPAIGN_INVALID_TRANSITION' });
      if (campaign.status==='qa_failed') repository.transitionCampaign(campaign.id,'running');
      const materialization=repository.getExpansionMaterialization(campaign.id);
      if (!materialization) throw new AppError('Expansion QA前必须先物化新增products与snapshot。',{ code:'CATALOG_EXPANSION_NOT_MATERIALIZED' });
      const comparison=repository.getExpansionComparison(campaign.id);const quality=repository.getExpansionQualityMetrics(campaign.id);
      const checks={ targetGate:campaign.nonElectronicUniqueCount>=campaign.targetCount,
        baselineFrozen:comparison.baselineCount===campaign.baselinePoolCount,
        newUniqueExact:comparison.newNonElectronicCount===comparison.newUniqueNeeded,
        activeCandidateExact:comparison.activeCandidateCount===campaign.targetCount,
        snapshotsExact:materialization.snapshotsInserted===comparison.newUniqueNeeded,
        reviewsUnchanged:materialization.reviewsBefore===materialization.reviewsAfter,
        duplicateGoodsId:quality.duplicateGoodsIdCount===0,distinctGoodsId:quality.distinctGoodsIdCount===campaign.targetCount,
        electronicInCandidate:quality.electronicInCandidateCount===0,
        manualReviewExcluded:comparison.manualReviewCount===quality.manualReviewCount,
        titleCoverage:quality.titleCoverage>=0.95,priceCoverage:quality.priceCoverage>=0.95,imageCoverage:quality.imageCoverage>=0.95,
        salesCoverage:quality.salesCoverage>=0.90,ratingCoverage:quality.ratingCoverage>=0.90,reviewCountCoverage:quality.reviewCountCoverage>=0.90 };
      const passed=Object.values(checks).every(Boolean);
      const audit={ ...comparison,duplicateGoodsIdCount:quality.duplicateGoodsIdCount,
        electronicInCandidateCount:quality.electronicInCandidateCount,manualReviewCount:quality.manualReviewCount,
        titleCoverage:quality.titleCoverage,priceCoverage:quality.priceCoverage,imageCoverage:quality.imageCoverage,
        salesCoverage:quality.salesCoverage,ratingCoverage:quality.ratingCoverage,reviewCountCoverage:quality.reviewCountCoverage,
        qaPassed:passed,qaDetails:{ checks,materialization,targetGate:campaign.targetGate,targetCount:campaign.targetCount,
          actual:gateValue(campaign),baselineSemantics:'active_pool_frozen_and_carried_forward' } };
      repository.saveExpansionAudit(campaign.id,audit);repository.transitionCampaign(campaign.id,'qa_pending');
      const completed=repository.transitionCampaign(campaign.id,passed?'completed':'qa_failed',{
        qaStatus:passed?'passed':'failed',qaSummary:audit.qaDetails,finished:passed
      });
      return { campaign:completed,audit:repository.getExpansionAudit(campaign.id),comparison,quality,materialization };
    });
  }

  function failCampaign(campaignId,summary={}) {
    const campaign=requireCampaign(campaignId);
    if (['completed','failed','cancelled'].includes(campaign.status)) throw new AppError('终态Campaign不能再次失败。',{ code:'CATALOG_CAMPAIGN_TERMINAL' });
    return repository.transitionCampaign(campaignId,'failed',{ qaStatus:'failed',qaSummary:summary,finished:true });
  }

  function activatePoolVersion(campaignId,{ qaSummary={} }={}) {
    return transaction(db,() => {
      const campaign=requireCampaign(campaignId);
      if (campaign.status!=='completed' || campaign.qaStatus!=='passed') throw new AppError('只有QA通过的已完成Campaign可以激活Pool Version。',{ code:'CATALOG_POOL_QA_REQUIRED' });
      const actual=gateValue(campaign);
      if (actual<campaign.targetCount) throw new AppError('Campaign数量未达到目标，拒绝激活Pool Version。',{
        code:'CATALOG_POOL_SAFETY_REJECTED',retriable:true,
        details:{ targetGate:campaign.targetGate,targetCount:campaign.targetCount,actual }
      });
      if (campaign.campaignType==='refresh') {
        const audit=repository.getRefreshAudit(campaign.id);
        const materialization=repository.getRefreshMaterialization(campaign.id);
        if (!audit || Number(audit.qa_passed)!==1 || !materialization || materialization.reviewsBefore!==materialization.reviewsAfter) {
          throw new AppError('Refresh审计或数据物化未通过，拒绝激活Pool Version。',{ code:'CATALOG_POOL_SAFETY_REJECTED' });
        }
      }
      if (campaign.campaignType==='expansion') {
        const audit=repository.getExpansionAudit(campaign.id);const materialization=repository.getExpansionMaterialization(campaign.id);
        if (!audit || Number(audit.qa_passed)!==1 || !materialization || materialization.reviewsBefore!==materialization.reviewsAfter
          || Number(audit.active_candidate_count)!==campaign.targetCount || Number(audit.duplicate_goods_id_count)!==0
          || Number(audit.electronic_in_candidate_count)!==0) {
          throw new AppError('Expansion审计或数据物化未通过，拒绝激活Pool Version。',{ code:'CATALOG_POOL_SAFETY_REJECTED' });
        }
      }
      return repository.activatePoolVersion(campaign,qaSummary);
    });
  }

  function recordNotSeenInCampaign(campaignId,products) {
    requireCampaign(campaignId);
    return transaction(db,() => {
      for (const product of products) repository.recordCampaignObservation(campaignId,product,'not_seen_in_campaign',{
        meaning:'campaign observation only; product and active membership are preserved'
      });
      return { campaignId,notSeenCount:products.length };
    });
  }

  function requireCampaign(id) {
    const campaign=repository.getCampaign(String(id ?? ''));
    if (!campaign) throw new AppError('Catalog Campaign不存在。',{ code:'CATALOG_CAMPAIGN_NOT_FOUND' });
    return campaign;
  }
  function requireSource(id) {
    const source=repository.getSource(String(id ?? ''));
    if (!source) throw new AppError('Catalog Source不存在。',{ code:'CATALOG_SOURCE_NOT_FOUND' });
    return source;
  }

  function currentOperatorManualContext() {
    const queues=repository.listActiveRpaQueues().filter(queue => ['running','manual_required'].includes(requireCampaign(queue.campaignId).status));
    if (!queues.length) return null;
    if (queues.length>1) throw new AppError('存在多个活跃Catalog RPA来源，拒绝猜测当前上下文。',{
      code:'CATALOG_RPA_CONTEXT_AMBIGUOUS' });
    const context=rpaContext(queues[0],{ exposeClaimToken:false });
    if (context.campaign.browserControlMode!==MANUAL_PASSIVE_CAPTURE_MODE) throw new AppError(
      '当前Catalog RPA上下文不是Operator Manual Bind模式。',{ code:'OPERATOR_MANUAL_CONTEXT_MISMATCH' });
    return context;
  }

  return { createCampaign,describeOperatorProfile,createOperatorManualCampaign,currentOperatorManualContext,transitionCampaign,updateBrowserContext,createSource,captureBatch,submitQa,failCampaign,
    recordNavigationRisk,materializeRefresh,evaluateRefreshQa,materializeExpansion,evaluateExpansionQa,activatePoolVersion,
    recordExpansionCheckpoint,recordNotSeenInCampaign,
    getBaselineConsistency:repository.getBaselineConsistency,getBaselineAudit:repository.getBaselineAudit,
    reconcileActiveMembershipsToPool:categoryKey => transaction(db,() => repository.reconcileActiveMembershipsToPool(categoryKey)),
    getCampaign:repository.getCampaign,getSource:repository.getSource,
    createSourceRun:repository.createSourceRun,getRpaQueueForSource:repository.getRpaQueueForSource,
    getCaptureContext,captureExtensionBatch,getStatus,claimNextSource,currentRpaContext,sourceOpened,
    saveRpaCheckpoint,markRpaManualRequired,resumeRpa,saveExtensionCheckpoint,markExtensionManualRequired,resumeExtensionRunner,
    completeRpaSource };

  function requireClaim(input) {
    plainObject(input,'Catalog RPA request');
    const queue=repository.getRpaQueue(requiredString(input.queue_id,'queue_id',128));
    if (!queue) throw new AppError('Catalog RPA Queue不存在。',{ code:'CATALOG_RPA_QUEUE_NOT_FOUND' });
    const claimToken=requiredString(input.claim_token,'claim_token',128);
    if (!queue.claimToken || queue.claimToken!==claimToken) throw new AppError('Catalog RPA claim_token不匹配。',{ code:'CATALOG_RPA_CLAIM_MISMATCH' });
    return queue;
  }

  function requireExtensionQueue(input) {
    plainObject(input,'Catalog Extension checkpoint');
    const queue=repository.getRpaQueue(requiredString(input.queue_id,'queue_id',128));
    if (!queue) throw new AppError('Catalog RPA Queue不存在。',{ code:'CATALOG_RPA_QUEUE_NOT_FOUND' });
    if (!queue.claimToken) throw new AppError('Catalog RPA Queue尚未领取。',{ code:'CATALOG_RPA_NOT_CLAIMED' });
    if (requiredString(input.campaign_id,'campaign_id',128)!==queue.campaignId
      || requiredString(input.source_id,'source_id',128)!==queue.sourceId) throw new AppError(
      'Extension checkpoint与当前Campaign/Source不匹配。',{ code:'CATALOG_RPA_CLAIM_MISMATCH' });
    return queue;
  }

  function rpaContext(queue,{ exposeClaimToken=true }={}) {
    const campaign=requireCampaign(queue.campaignId);
    const source=requireSource(queue.sourceId);
    if (source.campaignId!==campaign.id || source.categoryKey!==campaign.categoryKey) throw new AppError(
      'Source不属于当前Category Campaign。',{ code:'CATALOG_SOURCE_CAMPAIGN_MISMATCH' });
    const profile=validateCategoryProfile(campaign.config?.categoryProfile);
    return { queue:{ ...queue,claimToken:exposeClaimToken ? queue.claimToken:undefined },
      campaign:{ id:campaign.id,status:campaign.status,categoryKey:campaign.categoryKey,
        campaignType:campaign.campaignType,baselinePoolCount:campaign.baselinePoolCount,
        categoryProfileVersion:campaign.categoryProfileVersion,targetGate:campaign.targetGate,targetCount:campaign.targetCount,
        rawObservedCount:campaign.rawObservedCount,electronicExcludedCount:campaign.electronicExcludedCount,
        nonElectronicUniqueCount:campaign.nonElectronicUniqueCount,businessEligibleCount:campaign.businessEligibleCount,
        reviewableUniqueCount:campaign.reviewableUniqueCount,manualReviewCount:null,
        browserProfileName:campaign.browserProfileName,browserProfileDirectory:campaign.browserProfileDirectory,
        browserControlMode:campaign.browserControlMode,
        cdpRequired:!LOCAL_EXTENSION_MODES.has(campaign.browserControlMode),
        extensionPassiveRequired:LOCAL_EXTENSION_MODES.has(campaign.browserControlMode),
        localServerEndpoint:LOCAL_EXTENSION_MODES.has(campaign.browserControlMode)?'http://127.0.0.1:37821':null,
        refreshProgress:campaign.campaignType==='refresh' ? repository.getRefreshComparison(campaign.id):null },source,profile };
  }
}

function normalizeCard(raw,goodsId,capturedAt) {
  const salesCount=integerOrNull(raw.sales_count ?? raw.salesCount);
  const evidence={ ...raw,raw_sales_text:raw.raw_sales_text ?? null,
    parsed_sales_count:integerOrNull(raw.parsed_sales_count ?? salesCount),final_sales_count:salesCount,
    sales_provenance:raw.sales_provenance ?? raw.field_provenance?.sales_count ?? (salesCount===null?'missing':'dom') };
  return { platform:'temu',goodsId,title:raw.title ?? null,sourceUrl:raw.source_url ?? raw.sourceUrl ?? raw.href ?? null,
    canonicalUrl:canonicalProductUrl(goodsId),imageUrl:raw.image_url ?? raw.imageUrl ?? null,
    priceAmount:numberOrNull(raw.price_amount ?? raw.priceAmount),currency:raw.currency ?? null,
    salesCount,rating:numberOrNull(raw.rating),
    reviewCount:integerOrNull(raw.review_count ?? raw.reviewCount),businessEligible:raw.business_eligible ?? raw.businessEligible,
    reviewable:raw.reviewable,qualityStatus:raw.quality_status ?? 'pending',capturedAt,raw:evidence };
}
function normalizeGoodsId(value) { const result=String(value ?? '').trim();if (!/^\d+$/.test(result)) throw new AppError('Catalog card缺少有效goods_id。',{ code:'INVALID_GOODS_ID' });return result; }
function numberOrNull(value) { const result=Number(value);return value===null || value===undefined || value==='' || !Number.isFinite(result) ? null:result; }
function integerOrNull(value) { const result=numberOrNull(value);return result===null?null:Math.trunc(result); }
function gateValue(campaign) { return campaign.targetGate==='business_eligible_count' ? campaign.businessEligibleCount:
  campaign.targetGate==='reviewable_unique_count' ? campaign.reviewableUniqueCount:campaign.nonElectronicUniqueCount; }
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function validatePageUrl(value) {
  const raw=requiredString(value,'page_url',2048);
  let url;
  try { url=new URL(raw); } catch { throw new AppError('Catalog page_url无效。',{ code:'CATALOG_CONTEXT_MISMATCH' }); }
  if (url.protocol!=='https:' || url.hostname!=='www.temu.com') throw new AppError('Catalog页面不是允许的Temu站点。',{ code:'CATALOG_CONTEXT_MISMATCH' });
  return url.href;
}
function validatePageContext(value,profile) {
  plainObject(value,'page_context');
  const context={ siteCountry:requiredString(value.site_country,'page_context.site_country',16),
    language:requiredString(value.language,'page_context.language',16),currency:requiredString(value.currency,'page_context.currency',8),
    categoryKey:requiredString(value.category_key,'page_context.category_key',128),
    categoryProfileVersion:requiredString(value.category_profile_version,'page_context.category_profile_version',128),
    sortOrder:requiredString(value.sort_order,'page_context.sort_order',128) };
  if (context.categoryKey!==profile.category_key || context.categoryProfileVersion!==profile.category_profile_version) throw new AppError('页面Category上下文不匹配。',{ code:'CATEGORY_MISMATCH' });
  if (context.sortOrder!==profile.sort_order) throw new AppError('页面排序方式不匹配。',{ code:'SORT_ORDER_MISMATCH' });
  if (context.siteCountry!==profile.site_country || context.language!==profile.language || context.currency!==profile.currency) throw new AppError('页面国家、语言或币种上下文不匹配。',{ code:'CATALOG_CONTEXT_MISMATCH' });
  return context;
}
function validateExtensionCard(value,index) {
  plainObject(value,`cards[${index}]`);
  const goodsId=normalizeGoodsId(value.goods_id);
  const result={ goods_id:goodsId,href:optionalString(value.href,'href',2048),title:optionalString(value.title,'title',1000),
    image_url:optionalString(value.image_url,'image_url',2048),price_amount:optionalNumber(value.price_amount,'price_amount',{ min:0 }),
    original_price_amount:optionalNumber(value.original_price_amount,'original_price_amount',{ min:0 }),
    sales_count:optionalInteger(value.sales_count,'sales_count'),rating:optionalNumber(value.rating,'rating',{ min:0,max:5 }),
    review_count:optionalInteger(value.review_count,'review_count'),listing_rank:optionalPositiveInteger(value.listing_rank,'listing_rank'),
    dom_sequence:optionalPositiveInteger(value.dom_sequence,'dom_sequence'),badge_text:optionalString(value.badge_text,'badge_text',1000),
    raw_card_text:optionalString(value.raw_card_text,'raw_card_text',10_000),capture_transport:optionalString(value.capture_transport,'capture_transport',64),
    raw_sales_text:optionalString(value.raw_sales_text,'raw_sales_text',128),parsed_sales_count:optionalInteger(value.parsed_sales_count,'parsed_sales_count'),
    final_sales_count:optionalInteger(value.final_sales_count,'final_sales_count'),sales_provenance:optionalString(value.sales_provenance,'sales_provenance',64),
    network_observed:value.network_observed===true,network_endpoint:optionalString(value.network_endpoint,'network_endpoint',1000),
    network_observed_at:value.network_observed_at ? isoTimestamp(value.network_observed_at,'network_observed_at'):null,
    bound_url:optionalString(value.bound_url,'bound_url',2048),bound_at:value.bound_at?isoTimestamp(value.bound_at,'bound_at'):null,
    bound_category:optionalString(value.bound_category,'bound_category',256),bound_sort:optionalString(value.bound_sort,'bound_sort',128),
    field_provenance:value.field_provenance && typeof value.field_provenance==='object' && !Array.isArray(value.field_provenance) ? value.field_provenance:null };
  if (result.href) validatePageUrl(result.href);if(result.bound_url)result.bound_url=validatePageUrl(result.bound_url);
  return result;
}
function validateManualPassiveBatch(captureMode,cards,pageBinding,{pageUrl,pageContext,context}) {
  if (captureMode!==MANUAL_PASSIVE_CAPTURE_MODE) throw new AppError('Manual Passive Campaign只接受被动Network批次。',{ code:'MANUAL_PASSIVE_CAPTURE_REQUIRED' });
  if(!pageBinding)throw new AppError('Manual Capture 必须先绑定当前页面。',{code:'PAGE_BINDING_REQUIRED'});
  plainObject(pageBinding,'page_binding');const profile=context.profile;const binding={ status:requiredString(pageBinding.status,'page_binding.status',32),
    binding_version:requiredString(pageBinding.binding_version,'page_binding.binding_version',64),binding_generation:optionalPositiveInteger(pageBinding.binding_generation,'page_binding.binding_generation'),
    campaign_id:requiredString(pageBinding.campaign_id,'page_binding.campaign_id',128),source_id:requiredString(pageBinding.source_id,'page_binding.source_id',128),
    category_key:requiredString(pageBinding.category_key,'page_binding.category_key',128),category_profile_version:requiredString(pageBinding.category_profile_version,'page_binding.category_profile_version',128),
    site_country:requiredString(pageBinding.site_country,'page_binding.site_country',32),language:requiredString(pageBinding.language,'page_binding.language',32),currency:requiredString(pageBinding.currency,'page_binding.currency',32),
    sort_order:requiredString(pageBinding.sort_order,'page_binding.sort_order',128),bound_url:validatePageUrl(pageBinding.bound_url),bound_at:isoTimestamp(pageBinding.bound_at,'page_binding.bound_at'),
    bound_category:requiredString(pageBinding.bound_category,'page_binding.bound_category',256),bound_sort:requiredString(pageBinding.bound_sort,'page_binding.bound_sort',128),
    bound_goods_count:optionalPositiveInteger(pageBinding.bound_goods_count,'page_binding.bound_goods_count'),context_fingerprint:requiredString(pageBinding.context_fingerprint,'page_binding.context_fingerprint',128) };
  const expectedFingerprint=fingerprint([binding.bound_url,binding.site_country,binding.language,binding.currency,binding.category_key,binding.bound_category,binding.bound_sort]);
  if(binding.status!=='BOUND'||binding.binding_version!=='manual-bind-v1'||binding.campaign_id!==context.campaign.id||binding.source_id!==context.source.id
    ||binding.category_key!==profile.category_key||binding.category_profile_version!==profile.category_profile_version
    ||binding.site_country!==profile.site_country||binding.language!==profile.language||binding.currency!==profile.currency
    ||binding.sort_order.toLowerCase()!==profile.sort_order.toLowerCase()||binding.bound_sort.toLowerCase()!==profile.sort_order.toLowerCase()
    ||!profile.page_health.category_names.includes(binding.bound_category)||binding.bound_url!==pageUrl||binding.context_fingerprint!==expectedFingerprint
    ||pageContext.categoryKey!==binding.category_key||pageContext.categoryProfileVersion!==binding.category_profile_version||!binding.bound_goods_count)throw new AppError(
    'Manual Passive页面绑定上下文无效或已经丢失。',{code:'PAGE_CONTEXT_LOST'});
  for (const card of cards) {
    if (card.network_observed!==true || card.network_endpoint!=='/api/poppy/v1/opt' || !card.network_observed_at
      || !['DOM','NETWORK_ENRICHED'].includes(card.capture_transport)||card.bound_url!==binding.bound_url||card.bound_at!==binding.bound_at
      || card.bound_category!==binding.bound_category||card.bound_sort?.toLowerCase()!==binding.bound_sort.toLowerCase()) throw new AppError(
      `goods_id ${card.goods_id} 缺少合格的被动Network证据。`,{ code:'MANUAL_PASSIVE_EVIDENCE_REQUIRED' });
  }
}
function fingerprint(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');}
function plainObject(value,label) { if (!value || typeof value!=='object' || Array.isArray(value)) throw new AppError(`${label}必须是对象。`,{ code:'CATALOG_BATCH_INVALID' }); }
function requiredString(value,field,maxLength) { const result=String(value ?? '').trim();if (!result || result.length>maxLength) throw new AppError(`${field}无效。`,{ code:'CATALOG_BATCH_INVALID' });return result; }
function optionalString(value,field,maxLength) { if (value===undefined || value===null || value==='') return null;if (typeof value!=='string' || value.length>maxLength) throw new AppError(`${field}类型或长度无效。`,{ code:'CATALOG_BATCH_INVALID' });return value.trim() || null; }
function optionalNumber(value,field,{ min=-Infinity,max=Infinity }={}) { if (value===undefined || value===null) return null;if (typeof value!=='number' || !Number.isFinite(value) || value<min || value>max) throw new AppError(`${field}必须是有效数字。`,{ code:'CATALOG_BATCH_INVALID' });return value; }
function optionalInteger(value,field) { const result=optionalNumber(value,field,{ min:0 });if (result!==null && !Number.isInteger(result)) throw new AppError(`${field}必须是非负整数。`,{ code:'CATALOG_BATCH_INVALID' });return result; }
function optionalPositiveInteger(value,field) { const result=optionalNumber(value,field,{ min:1 });if (result!==null && !Number.isInteger(result)) throw new AppError(`${field}必须是正整数。`,{ code:'CATALOG_BATCH_INVALID' });return result; }
function isoTimestamp(value,field) { const result=requiredString(value,field,64);if (!Number.isFinite(Date.parse(result))) throw new AppError(`${field}不是有效时间。`,{ code:'CATALOG_BATCH_INVALID' });return new Date(result).toISOString(); }
function mergeCheckpoint(queue,value,extra={}) { if (value!==undefined) plainObject(value,'checkpoint');return { ...(queue.checkpoint ?? {}),...(value ?? {}),...extra }; }
function normalizeRpaMetrics(checkpoint) { return { rawObservationCount:nonNegativeMetric(checkpoint.raw_observation_count),
  loadMoreCount:nonNegativeMetric(checkpoint.load_more_count),scrollRounds:nonNegativeMetric(checkpoint.scroll_rounds) }; }
function nonNegativeMetric(value) { const result=Number(value ?? 0);return Number.isInteger(result) && result>=0 ? result:0; }
function withoutClaimToken(queue) { return queue ? { ...queue,claimToken:undefined }:queue; }
function validateLoadStateCheckpoint(checkpoint) {
  if (checkpoint===undefined || checkpoint===null || checkpoint.load_state===undefined) return;
  plainObject(checkpoint,'checkpoint');
  if (!CATALOG_LOAD_STATES.includes(checkpoint.load_state)) throw new AppError('Catalog load_state无效。',{
    code:'CATALOG_LOAD_STATE_INVALID',details:{ loadState:checkpoint.load_state }
  });
  if (checkpoint.load_state==='LOAD_MORE_PROGRESS' && Number(checkpoint.new_goods_count ?? 0)<=0) {
    throw new AppError('LOAD_MORE_PROGRESS必须记录正数new_goods_count。',{ code:'CATALOG_LOAD_STATE_INVALID' });
  }
}
