import { analyzeCategories } from '../analysis/category-analysis.mjs';
import { buildBusinessAlignment } from '../analysis/business-screening.mjs';

const PRIORITY=new Map([['整车防护罩',0],['排气系统部件',1],['车把与横把附件',2]]);

export function buildDay9EligibleQueue(products,{ targetCount=products.length,expectedEligibleCount=512,excludeGoodsIds=[] }={}) {
  const alignment=buildBusinessAlignment(analyzeCategories(products));
  const eligible=alignment.products.filter(item => item.businessEligible === true && !item.manualReviewRequired)
    .sort(queueOrder);
  if (expectedEligibleCount !== null && eligible.length !== expectedEligibleCount) throw new Error(`Day9业务可做输入应为${expectedEligibleCount}，实际${eligible.length}。`);
  const excluded=new Set(excludeGoodsIds.map(String));const available=eligible.filter(item => !excluded.has(item.goodsId));
  const target=Math.min(Number(targetCount),available.length);
  const selected=target === 10 ? acceptanceTen(available):available.slice(0,target);
  return { selected,eligible,summary:alignment.summary,manualReviewExcluded:alignment.summary.pendingFineClassificationCount,
    knownUnavailableExcluded:eligible.length-available.length,
    priorityCounts:Object.fromEntries([...PRIORITY.keys()].map(label => [label,eligible.filter(item => item.level3 === label).length])) };
}

export function mapCaptureFailure(error,coverage={}) {
  const code=String(error?.code ?? 'PAGE_CHANGED').toUpperCase();
  const hasData=Number(coverage.reviewsCaptured ?? 0)>0;
  if (['CAPTCHA','LOGIN_REQUIRED'].includes(code)) return { taskStatus:'blocked',crawlCompleteness:'blocked',stopReason:code,retriable:true };
  if (['SESSION_UNHEALTHY','SESSION_CONTEXT_PROBLEM','STALE_CATEGORY_PAGE','SEARCH_NO_RESULTS','LISTING_NOT_FOUND','DETAIL_AVAILABILITY_MISMATCH','DETAIL_AVAILABILITY_UNVERIFIED'].includes(code)) return { taskStatus:'blocked',crawlCompleteness:'blocked',stopReason:code,retriable:true };
  if (code === 'BROWSER_CLOSED') return { taskStatus:hasData ? 'completed_partial':'failed',crawlCompleteness:hasData ? 'partial':'failed',stopReason:'BROWSER_CLOSED',retriable:true };
  if (code === 'NETWORK_ERROR') return { taskStatus:hasData ? 'completed_partial':'failed',crawlCompleteness:hasData ? 'partial':'failed',stopReason:'NETWORK_ERROR',retriable:true };
  if (code === 'REVIEW_SECTION_MISSING') return { taskStatus:hasData ? 'completed_partial':'failed',crawlCompleteness:hasData ? 'partial':'failed',stopReason:'REVIEW_SECTION_MISSING',retriable:true };
  return { taskStatus:hasData ? 'completed_partial':'failed',crawlCompleteness:hasData ? 'partial':'failed',stopReason:code,retriable:Boolean(error?.retriable) };
}

export function summarizeCoverage(items) {
  const byCompleteness={ complete:0,partial:0,no_review:0,blocked:0,failed:0 };
  const byStatus={};
  for (const item of items) { if (item.crawlCompleteness) byCompleteness[item.crawlCompleteness]+=1;byStatus[item.taskStatus]=(byStatus[item.taskStatus] ?? 0)+1; }
  return { total:items.length,byCompleteness,byStatus,reviewsCaptured:items.reduce((sum,item) => sum+item.reviewsCaptured,0),pagesScanned:items.reduce((sum,item) => sum+item.pagesScanned,0) };
}

function acceptanceTen(eligible) {
  const selected=[];const add=item => { if (item && !selected.some(current => current.productId === item.productId)) selected.push(item); };
  const priority=eligible.filter(item => PRIORITY.has(item.level3));
  const nonPriority=eligible.filter(item => !PRIORITY.has(item.level3));
  add(priority.find(item => Number(item.reviewCount) >= 100));
  add(priority.find(item => item.reviewCount !== null && Number(item.reviewCount) > 0 && Number(item.reviewCount) <= 5));
  add(priority.find(item => Number(item.reviewCount) === 0) ?? eligible.find(item => Number(item.reviewCount) === 0));
  add(nonPriority.find(item => Number(item.reviewCount) >= 20) ?? nonPriority[0]);
  for (const item of eligible) { add(item);if (selected.length === 10) break; }
  return selected.sort(queueOrder);
}
function queueOrder(left,right) { return (PRIORITY.get(left.level3) ?? 3)-(PRIORITY.get(right.level3) ?? 3) || (left.rank ?? Number.MAX_SAFE_INTEGER)-(right.rank ?? Number.MAX_SAFE_INTEGER) || left.goodsId.localeCompare(right.goodsId); }
