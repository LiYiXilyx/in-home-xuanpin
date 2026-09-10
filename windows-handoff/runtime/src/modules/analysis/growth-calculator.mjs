export const LIFECYCLE_RULE_VERSION='week2-lifecycle-v1';

export function calculateReviewActivity(reviewDates,{ asOfDate }={}) {
  const asOf=parseDateOnly(asOfDate ?? new Date());
  const start7=shiftDays(asOf,-6);
  const start30=shiftDays(asOf,-29);
  const normalized=reviewDates.map(parseDateOnly).filter(date => date && date <= asOf).sort((a,b) => a-b);
  const recent7=normalized.filter(date => date >= start7).length;
  const recent30=normalized.filter(date => date >= start30).length;
  const prior23=recent30-recent7;
  const reviewVelocity=round(recent7/7,4);
  const priorReviewVelocity=round(prior23/23,4);
  const velocityRatio=priorReviewVelocity > 0 ? round(reviewVelocity/priorReviewVelocity,4) : null;
  return {
    firstReviewDate:normalized[0] ? formatDate(normalized[0]) : null,
    recent7dReviews:recent7,
    recent30dReviews:recent30,
    prior23dReviews:prior23,
    reviewVelocity,
    priorReviewVelocity,
    velocityRatio
  };
}

export function classifyProductStage(activity,{ snapshotReviewCount=null,coverageStatus=null }={}) {
  const stored=activity.recent30dReviews;
  const supportedCoverage=['complete','partial'].includes(String(coverageStatus ?? ''));
  if (!activity.firstReviewDate || !supportedCoverage) {
    return { productStage:null,dataStatus:'insufficient',reasons:['评论覆盖尚未完成，暂不判定生命周期。'] };
  }
  const dataStatus=coverageStatus === 'complete' ? 'sufficient':'partial';
  const reasons=[];
  let productStage;
  if (snapshotReviewCount !== null && snapshotReviewCount !== undefined && Number(snapshotReviewCount) <= 50 && stored > 0) {
    productStage='new';
    reasons.push('当前页面累计评论不超过50，且最近30天已有评论，判定为新品。');
  } else if (stored >= 5 && (activity.prior23dReviews === 0 ? activity.recent7dReviews >= 2 : activity.velocityRatio >= 1.25)) {
    productStage='growth';
    reasons.push('最近7天评论日均速度相对前23天明显上升，判定为增长期。');
  } else if (stored === 0 || (activity.prior23dReviews >= 3 && activity.velocityRatio !== null && activity.velocityRatio <= 0.6)) {
    productStage='decline';
    reasons.push('最近评论活跃度明显低于前段窗口，判定为衰退期。');
  } else {
    productStage='mature';
    reasons.push('评论活跃度稳定，未达到新品、增长或衰退阈值，判定为成熟期。');
  }
  if (dataStatus === 'partial') reasons.push('评论覆盖为partial，阶段结论需结合后续补采复核。');
  return { productStage,dataStatus,reasons };
}

export function stageLabel(stage) {
  return ({ new:'新品',growth:'增长',mature:'成熟',decline:'衰退' })[stage] ?? '数据不足';
}

function parseDateOnly(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate()));
  const match=String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}
function shiftDays(date,days) { return new Date(date.getTime()+days*86400000); }
function formatDate(date) { return date.toISOString().slice(0,10); }
function round(value,digits) { const factor=10**digits;return Math.round(value*factor)/factor; }
