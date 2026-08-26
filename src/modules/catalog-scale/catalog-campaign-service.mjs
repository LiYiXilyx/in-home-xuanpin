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
        const result=repository.upsertStaging(campaign,source,String(batchId),normalizeCard(raw,goodsId,capturedAt),screening.decision);
        if (result.inserted) stagingCount+=1; else duplicateCount+=1;
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
    return captureBatch({ campaignId,sourceId,batchId,pageUrl,pageTitle:optionalString(input.page_title,'page_title',500),
      capturedAt,cards,categoryKey,categoryProfileVersion:profileVersion,pageContext });
  }

  function getStatus(campaignId) {
    const campaign=requireCampaign(requiredString(campaignId,'campaign_id',128));
    return { campaign,sourceContributions:repository.listSourceContributions(campaign.id) };
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
    createSourceRun:repository.createSourceRun,getRpaQueueForSource:repository.getRpaQueueForSource,
    getCaptureContext,captureExtensionBatch,getStatus };
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
