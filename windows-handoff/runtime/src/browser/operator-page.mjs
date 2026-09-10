import { AppError } from '../shared/errors.mjs';

export async function findCurrentOperatorTemuPage(context) {
  const pages = context.pages().filter(page => !page.isClosed());
  const temuPages = pages.filter(page => isTemuUrl(page.url()));
  const candidates=[];
  for (const [index,page] of temuPages.entries()) {
    const visible=await page.evaluate(() => document.visibilityState === 'visible').catch(() => false);
    candidates.push({ page,index,visible,listingPriority:listingPagePriority(page.url()) });
  }
  candidates.sort((left,right) => right.listingPriority-left.listingPriority
    || Number(right.visible)-Number(left.visible)
    || right.index-left.index);
  return candidates[0]?.page ?? null;
}

export async function requireCurrentOperatorTemuPage(context) {
  const page = await findCurrentOperatorTemuPage(context);
  if (page) return page;
  const hasOpenPages = context.pages().some(item => !item.isClosed());
  throw new AppError(hasOpenPages
    ? '当前可见页面不是 Temu。请人工打开目标 Temu 页面。'
    : '采集 Chrome 中没有可用页面。请先打开 Temu。', {
    code: hasOpenPages ? 'WRONG_PAGE' : 'NO_TEMU_PAGE', retriable: true
  });
}

export function isTemuUrl(value) {
  try { return /(^|\.)temu\.com$/i.test(new URL(value).hostname); } catch { return false; }
}

function listingPagePriority(value) {
  try {
    const url=new URL(value);
    const location=`${url.pathname} ${url.search}`;
    if (/goods\.html|(?:^|[-/])g-\d+\.html/i.test(url.pathname)) return -1;
    if (/category\.html|search_result\.html|motorcycl|powersport|opt_level=|leaf_type=/i.test(location)) return 1;
  } catch {}
  return 0;
}
