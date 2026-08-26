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

export function createCatalogCampaignService(db,{ now=() => new Date().toISOString(),screenElectronicRisk=screenCatalogElectronicRisk }={}) {
  const repository=createCatalogCampaignRepository(db,{ now });

  function createCampaign({ name,campaignType='expansion',profile,baselinePoolCount=0,targetCount=null,browserContext=null }) {
    const validated=validateCategoryProfile(profile);
    return transaction(db,() => {
      let campaign=repository.createCampaign({ name,campaignType,categoryKey:validated.category_key,
        categoryProfileVersion:validated.category_profile_version,targetGate:validated.business_rules.default_gate,
        targetCount:targetCount ?? validated.target_count,baselinePoolCount,config:{ categoryProfile:validated } });
      if (browserContext) campaign=repository.setCampaignBrowserContext(campaign.id,browserContext);
      if (campaignType==='refresh') {
        repository.captureCampaignBaseline(campaign.id);
        campaign=repository.getCampaign(campaign.id);
      }
      return campaign;
    });
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
      let acceptedNonElectronic=campaign.nonElectronicUniqueCount;
      for (const raw of cards) {
        const goodsId=normalizeGoodsId(raw.goods_id ?? raw.goodsId);
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
          excludedCount+=1;
          continue;
        }
        if (campaign.campaignType==='refresh' && screening.decision==='passed' && acceptedNonElectronic>=campaign.targetCount) break;
        const result=repository.upsertStaging(campaign,source,String(batchId),normalizeCard(raw,goodsId,capturedAt),screening.decision);
        if (result.inserted) {
          stagingCount+=1;
          if (screening.decision==='passed') acceptedNonElectronic+=1;
        } else duplicateCount+=1;
      }
      const batch=repository.completeBatch(registered.batch.id,{ stagingCount,excludedCount,duplicateCount });
      return { idempotentReplay:false,batch,campaign:repository.refreshCampaignCounts(campaignId) };
    });
  }

  function getCaptureContext(campaignId,sourceId) {
    const campaign=requireCampaign(campaignId);
    const source=requireSource(sourceId);
    if (source.campaignId!==campaign.id || source.categoryKey!==campaign.categoryKey) throw new AppError('Source不属于当前Category Campaign。',{ code:'CATALOG_SOURCE_CAMPAIGN_MISMATCH' });
    if (campaign.status!=='running') throw new AppError('Catalog Campaign当前未运行。',{ code:'CAMPAIGN_NOT_ACTIVE' });
    const profile=validateCategoryProfile(campaign.config?.categoryProfile);
    return { campaign:{ id:campaign.id,status:campaign.status,categoryKey:campaign.categoryKey,
      categoryProfileVersion:campaign.categoryProfileVersion,targetGate:campaign.targetGate,targetCount:campaign.targetCount },
    source,profile };
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
    const result=captureBatch({ campaignId,sourceId,batchId,pageUrl,pageTitle:optionalString(input.page_title,'page_title',500),
      capturedAt,cards,categoryKey,categoryProfileVersion:profileVersion,pageContext });
    return { ...result,campaign:{ ...result.campaign,manualReviewCount:null } };
  }

  function getStatus(campaignId) {
    const campaign=requireCampaign(requiredString(campaignId,'campaign_id',128));
    return { campaign,queues:repository.listRpaQueues(campaign.id),sourceContributions:repository.listSourceContributions(campaign.id),
      qualityMetrics:repository.getQualityMetrics(campaign.id),
      refreshComparison:campaign.campaignType==='refresh' ? repository.getRefreshComparison(campaign.id):null,
      navigationRiskMetrics:campaign.campaignType==='refresh' ? repository.getNavigationRiskMetrics(campaign.id):null,
      materialization:repository.getRefreshMaterialization(campaign.id),refreshAudit:repository.getRefreshAudit(campaign.id) };
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
    const queues=repository.listActiveRpaQueues();
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
    const checkpoint=mergeCheckpoint(queue,input.checkpoint,{ phase:nextStatus,controlMode:'extension_auto_runner',lastCheckpointAt:now() });
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
      return { queue:result,campaign:repository.refreshCampaignCounts(queue.campaignId),contribution };
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

  return { createCampaign,transitionCampaign,createSource,captureBatch,submitQa,failCampaign,
    recordNavigationRisk,materializeRefresh,evaluateRefreshQa,activatePoolVersion,recordNotSeenInCampaign,
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
        categoryProfileVersion:campaign.categoryProfileVersion,targetGate:campaign.targetGate,targetCount:campaign.targetCount,
        rawObservedCount:campaign.rawObservedCount,electronicExcludedCount:campaign.electronicExcludedCount,
        nonElectronicUniqueCount:campaign.nonElectronicUniqueCount,businessEligibleCount:campaign.businessEligibleCount,
        reviewableUniqueCount:campaign.reviewableUniqueCount,manualReviewCount:null },source,profile };
  }
}

function normalizeCard(raw,goodsId,capturedAt) {
  return { platform:'temu',goodsId,title:raw.title ?? null,sourceUrl:raw.source_url ?? raw.sourceUrl ?? raw.href ?? null,
    canonicalUrl:canonicalProductUrl(goodsId),imageUrl:raw.image_url ?? raw.imageUrl ?? null,
    priceAmount:numberOrNull(raw.price_amount ?? raw.priceAmount),currency:raw.currency ?? null,
    salesCount:integerOrNull(raw.sales_count ?? raw.salesCount),rating:numberOrNull(raw.rating),
    reviewCount:integerOrNull(raw.review_count ?? raw.reviewCount),businessEligible:raw.business_eligible ?? raw.businessEligible,
    reviewable:raw.reviewable,qualityStatus:raw.quality_status ?? 'pending',capturedAt,raw };
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
    raw_card_text:optionalString(value.raw_card_text,'raw_card_text',10_000) };
  if (result.href) validatePageUrl(result.href);
  return result;
}
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
