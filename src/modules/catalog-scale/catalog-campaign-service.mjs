import { createHash } from 'node:crypto';
import { transaction } from '../../db/client.mjs';
import { createCatalogCampaignRepository } from '../../db/repositories/catalog-campaign-repository.mjs';
import { AppError } from '../../shared/errors.mjs';
import { canonicalProductUrl } from '../../shared/ids.mjs';
import { validateCategoryProfile } from './category-profile.mjs';
import { screenCatalogElectronicRisk } from './electronic-screening.mjs';

const CAMPAIGN_TRANSITIONS=Object.freeze({
  pending:['running','cancelled'],running:['paused','qa_pending','failed','cancelled'],paused:['running','failed','cancelled'],
  qa_pending:['completed','qa_failed'],qa_failed:['running','failed','cancelled'],completed:[],failed:[],cancelled:[]
});

export function createCatalogCampaignService(db,{ now=() => new Date().toISOString(),screenElectronicRisk=screenCatalogElectronicRisk }={}) {
  const repository=createCatalogCampaignRepository(db,{ now });

  function createCampaign({ name,campaignType='expansion',profile,baselinePoolCount=0 }) {
    const validated=validateCategoryProfile(profile);
    return repository.createCampaign({ name,campaignType,categoryKey:validated.category_key,
      categoryProfileVersion:validated.category_profile_version,targetGate:validated.business_rules.default_gate,
      targetCount:validated.target_count,baselinePoolCount,config:{ categoryProfile:validated } });
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

  function captureBatch({ campaignId,sourceId,batchId,pageUrl=null,pageTitle=null,capturedAt=now(),cards=[] }) {
    const campaign=requireCampaign(campaignId);
    const source=requireSource(sourceId);
    if (source.campaignId!==campaign.id || source.categoryKey!==campaign.categoryKey) throw new AppError('Source不属于当前Category Campaign。',{ code:'CATALOG_SOURCE_CAMPAIGN_MISMATCH' });
    if (!['running','pending'].includes(campaign.status)) throw new AppError('当前Campaign状态不能接收批次。',{ code:'CATALOG_CAMPAIGN_INVALID_TRANSITION' });
    if (!String(batchId ?? '').trim()) throw new AppError('Catalog batch缺少batch_id。',{ code:'CATALOG_BATCH_INVALID' });
    if (!Array.isArray(cards)) throw new AppError('Catalog batch cards必须是数组。',{ code:'CATALOG_BATCH_INVALID' });
    const payloadHash=hash({ campaignId,sourceId,batchId,pageUrl,pageTitle,cards });
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
      for (const raw of cards) {
        const goodsId=normalizeGoodsId(raw.goods_id ?? raw.goodsId);
        const screening=screenElectronicRisk(raw);
        if (screening.decision==='exclude') {
          for (let index=0;index<screening.codes.length;index+=1) repository.recordExclusion({
            campaignId,sourceId,batchId:String(batchId),goodsId,title:raw.title ?? null,
            exclusionCode:screening.codes[index],exclusionReason:screening.reasons[index] ?? '电子硬排除',
            classifierVersion:screening.classifierVersion,confidence:screening.confidence,detectedAt:capturedAt
          });
          excludedCount+=1;
          continue;
        }
        const result=repository.upsertStaging(campaign,source,String(batchId),normalizeCard(raw,goodsId,capturedAt),screening.decision);
        if (result.inserted) stagingCount+=1; else duplicateCount+=1;
      }
      const batch=repository.completeBatch(registered.batch.id,{ stagingCount,excludedCount,duplicateCount });
      return { idempotentReplay:false,batch,campaign:repository.refreshCampaignCounts(campaignId) };
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
    activatePoolVersion,recordNotSeenInCampaign,getCampaign:repository.getCampaign,getSource:repository.getSource,
    createSourceRun:repository.createSourceRun,getRpaQueueForSource:repository.getRpaQueueForSource };
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
