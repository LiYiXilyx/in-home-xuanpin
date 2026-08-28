import { classifyOpportunityProduct } from './opportunity-classifier.mjs';

export function enrichOpportunityGrouping(item) {
  const classified=classifyOpportunityProduct(item);
  return {
    ...item,
    level1Scene:item.level1Scene ?? classified.level1Scene,
    productType:item.productType ?? classified.productType,
    level3Segment:item.level3Segment ?? classified.level3Segment,
    similarProductCluster:item.similarProductCluster ?? classified.similarProductCluster,
    sortingGroup:item.sortingGroup ?? classified.sortingGroup,
    clusteringEvidence:item.clusteringEvidence ?? classified.clusteringEvidence,
    classificationEvidence:item.classificationEvidence ?? classified.classificationEvidence,
    titleEvidence:item.titleEvidence ?? classified.titleEvidence,
    imageEvidence:item.imageEvidence ?? classified.imageEvidence,
    evidenceConflict:item.evidenceConflict ?? classified.evidenceConflict,
    evidenceAgreement:item.evidenceAgreement ?? null,
    classificationConfidence:item.classificationConfidence ?? classified.confidence,
    classificationReasons:item.classificationReasons ?? classified.reasons,
    classificationReason:item.classificationReason ?? null,
    similarProductGroup:item.similarProductGroup ?? (item.similarProductCluster ?? classified.similarProductCluster),
    manualReviewRequired:Boolean(item.manualReviewRequired ?? classified.manualReviewRequired),
  };
}

export function compareOpportunityGrouping(a,b,{salesDescending=true}={}) {
  return text(a.level1Scene).localeCompare(text(b.level1Scene),'zh-CN')
    || text(a.productType).localeCompare(text(b.productType),'zh-CN')
    || text(a.level3Segment).localeCompare(text(b.level3Segment),'zh-CN')
    || text(a.similarProductCluster).localeCompare(text(b.similarProductCluster),'zh-CN')
    || text(a.similarProductGroup).localeCompare(text(b.similarProductGroup),'zh-CN')
    || (salesDescending ? number(b.salesCount)-number(a.salesCount) : 0)
    || text(a.goodsId).localeCompare(text(b.goodsId),'en',{numeric:true});
}

export function sortOpportunityItems(items,options={}) {
  return items.map(enrichOpportunityGrouping).sort((a,b)=>compareOpportunityGrouping(a,b,options));
}

export function buildGroupingQa(items,options={}) {
  const sorted=sortOpportunityItems(items,options);
  const waiting=sorted.filter(isWaiting);
  const knownClusters=new Set(sorted.map(x=>x.similarProductCluster).filter(x=>x&&x!=='未知'));
  const clusteredWaiting=waiting.filter(x=>x.similarProductCluster&&x.similarProductCluster!=='未知');
  return {
    similarClusterCount:knownClusters.size,
    waitingCount:waiting.length,
    waitingClusteredCount:clusteredWaiting.length,
    unclusteredWaitingCount:waiting.length-clusteredWaiting.length,
    sameLevel2Contiguous:isContiguous(sorted,x=>`${x.level1Scene}\u001f${x.productType}`),
    sameLevel3Contiguous:isContiguous(sorted,x=>`${x.level1Scene}\u001f${x.productType}\u001f${x.level3Segment}`),
    sameSimilarClusterContiguous:isContiguous(sorted,x=>`${x.level1Scene}\u001f${x.productType}\u001f${x.level3Segment}\u001f${x.similarProductCluster}`),
    auditSamples:{
      covers:sample(sorted,x=>x.similarProductCluster==='车罩'),
      fasteners:sample(sorted,x=>/螺丝|螺栓|螺母|垫片|紧固件/.test(x.similarProductCluster)),
      brackets:sample(sorted,x=>x.similarProductCluster==='安装支架/转接件'),
      bags:sample(sorted,x=>/包/.test(x.similarProductCluster)),
    },
  };
}

function sample(items,predicate) {
  return items.filter(predicate).sort((a,b)=>stableHash(a.goodsId)-stableHash(b.goodsId)).slice(0,10).map(x=>({
    goodsId:String(x.goodsId),title:x.title,level1Scene:x.level1Scene,productType:x.productType,
    level3Segment:x.level3Segment,similarProductCluster:x.similarProductCluster,
  }));
}

function isContiguous(items,keyOf) {
  const closed=new Set();let previous=null;
  for(const item of items){const key=keyOf(item);if(key!==previous){if(closed.has(key))return false;if(previous!==null)closed.add(previous);previous=key;}}
  return true;
}
function isWaiting(item){return item.productType==='其它/待细分'||item.level3Segment==='其它/待细分';}
function stableHash(value){let hash=2166136261;for(const ch of String(value??'')){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}
function text(value){return String(value??'');}
function number(value){const n=Number(value);return Number.isFinite(n)?n:0;}
