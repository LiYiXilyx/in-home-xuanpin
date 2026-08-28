import { transaction } from '../../db/client.mjs';
import { createOpportunityAnalysisRepository } from '../../db/repositories/opportunity-analysis-repository.mjs';
import { classifyOpportunityProduct,OPPORTUNITY_TAXONOMY_VERSION } from './opportunity-classifier.mjs';
import { analyzeOpportunitySegments,rankOpportunityProducts,OPPORTUNITY_SCORE_WEIGHTS,PRODUCT_SCORE_WEIGHTS } from './opportunity-metrics.mjs';
import { buildGroupingQa,enrichOpportunityGrouping } from './opportunity-grouping.mjs';

export function createOpportunityAnalysisService(db,{ now=()=>new Date().toISOString() }={}) {
  const repository=createOpportunityAnalysisRepository(db,{ now });

  function freezeAndAnalyze(campaignId) {
    const before=repository.coreCounts();
    const frozen=transaction(db,()=>{
      const sourcePool=repository.freezeSourcePool(campaignId);
      repository.stopCampaignForAnalysis(campaignId);
      const snapshot=repository.createSnapshot({ sourcePoolVersionId:sourcePool.id,sourceCampaignId:campaignId,
        config:{ taxonomyVersion:OPPORTUNITY_TAXONOMY_VERSION,segmentWeights:OPPORTUNITY_SCORE_WEIGHTS,productWeights:PRODUCT_SCORE_WEIGHTS,
          sourceSemantics:'active_pool_1500_plus_day8_true_net_new_at_freeze' } });
      return { sourcePool,snapshot };
    });
    if(frozen.snapshot.status==='awaiting_confirmation')return getResult(frozen.snapshot.id);
    return analyzeSnapshot(frozen.snapshot,before);
  }

  function analyzeSnapshot(snapshot,before=repository.coreCounts()) {
    try {
      transaction(db,()=>{
        const items=repository.listItems(snapshot.id);
        for(const item of items)repository.updateItemAnalysis(snapshot.id,item.goodsId,classifyOpportunityProduct(item));
      });
      const items=repository.listItems(snapshot.id);
      const segments=analyzeOpportunitySegments(items);
      const ranked=rankOpportunityProducts(items,segments,{ limit:5 });
      const summary=buildSummary(snapshot,items,segments,ranked.selected,before,repository.coreCounts());
      transaction(db,()=>{
        repository.saveSegments(snapshot.id,segments);
        repository.saveCandidates(snapshot.id,ranked.selected);
        repository.completeSnapshot(snapshot.id,summary);
      });
      return getResult(snapshot.id);
    } catch(error) { repository.failSnapshot(snapshot.id,error);throw error; }
  }

  function reanalyze(snapshotId=null){const snapshot=snapshotId?repository.getSnapshot(snapshotId):repository.latestSnapshot();if(!snapshot)throw new Error('Opportunity Analysis Snapshot不存在。');return analyzeSnapshot(snapshot);}
  function analyzeActivePool(categoryKey='motorcycle-accessories') {
    const active=db.prepare(`SELECT * FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1`).get(categoryKey);
    if(!active)throw new Error('当前没有Active Pool。');
    const before=repository.coreCounts();
    const snapshot=transaction(db,()=>repository.createSnapshot({sourcePoolVersionId:active.id,sourceCampaignId:active.campaign_id,
      config:{taxonomyVersion:OPPORTUNITY_TAXONOMY_VERSION,ruleVersion:'active-pool-rule-v2',sourceSemantics:'CURRENT_ACTIVE_POOL_ONLY'} }));
    return analyzeSnapshot(snapshot,before);
  }

  function getResult(snapshotId=null) {
    const snapshot=snapshotId?repository.getSnapshot(snapshotId):repository.latestSnapshot();
    if(!snapshot)throw new Error('Opportunity Analysis Snapshot不存在。');
    const storedItems=repository.listItems(snapshot.id);const segments=repository.listSegments(snapshot.id);const candidates=repository.listCandidates(snapshot.id);
    const ranked=rankOpportunityProducts(storedItems,segments,{ limit:5 });const segmentByType=new Map(segments.map(x=>[x.productType,x]));
    const priceBands=new Map();for(const item of storedItems.filter(x=>x.included&&Number.isFinite(x.priceAmount))){const a=priceBands.get(item.productType)??[];a.push(item.priceAmount);priceBands.set(item.productType,a);}
    const items=storedItems.map(enrichOpportunityGrouping);const groupingQa=buildGroupingQa(items);
    return { snapshot,items,segments,candidates:candidates.map(x=>{const prices=priceBands.get(x.productType)??[];return {...x,segment:segmentByType.get(x.productType),priceBand:prices.length?{min:Math.min(...prices),max:Math.max(...prices)}:null};}),candidateUniverse:ranked.scored,
      summary:{...(snapshot.summary??{}),groupingQa},groupingQa,coreCounts:repository.coreCounts() };
  }

  return { freezeAndAnalyze,reanalyze,analyzeActivePool,getResult };
}

function buildSummary(snapshot,items,segments,candidates,before,after) {
  const identities=new Set(items.map(x=>`${x.platform}\u001f${x.goodsId}`));
  const qualityCodes=countCodes(items.flatMap(x=>x.dataQuality));const warningCodes=countCodes(items.flatMap(x=>x.warningCodes));
  const hardCodes=countCodes(items.flatMap(x=>x.hardExclusionCodes));const included=items.filter(x=>x.included);
  const scenes=countCodes(included.map(x=>x.level1Scene));
  const cover=field=>included.filter(x=>x[field]!==null&&x[field]!==undefined&&x[field]!=='').length/included.length;
  const stableCore=before.products===after.products&&before.snapshots===after.snapshots&&before.reviews===after.reviews&&before.activeMemberships===after.activeMemberships;
  return { sourcePoolCount:snapshot.sourcePoolCount,itemRows:items.length,distinctIdentityCount:identities.size,duplicateIdentityCount:items.length-identities.size,
    includedCount:included.length,hardExcludedCount:items.filter(x=>x.hardExclusionCodes.length).length,hardExclusionCodes:hardCodes,
    dataQuality:qualityCodes,warnings:warningCodes,sceneCounts:scenes,manualReviewCount:items.filter(x=>x.manualReviewRequired).length,
    coverage:{ title:cover('title'),price:cover('priceAmount'),sales:cover('salesCount'),rating:cover('rating'),reviews:cover('reviewCount'),image:cover('imageUrl'),sourceUrl:cover('currentSourceUrl') },
    segmentCount:segments.length,rankedSegmentCount:segments.filter(x=>x.sampleStatus==='RANKED').length,
    validationSegmentCount:segments.filter(x=>x.sampleStatus==='VALIDATION_OPPORTUNITY').length,finalCandidateCount:candidates.length,
    coreCountsBefore:before,coreCountsAfter:after,coreDataUnchanged:stableCore,integrity:after.integrity,
    metricCaveats:{ estimatedGmv:'price × cumulative_sales，仅用于当前冻结商品池内部比较',reviewDensity:'sum(review_count) / sum(sales_count)，仅作为评论壁垒信号' },
    gate:'OPPORTUNITY_PRODUCT_CONFIRMATION' };
}
function countCodes(values){const out={};for(const value of values.filter(Boolean))out[value]=(out[value]??0)+1;return out;}
