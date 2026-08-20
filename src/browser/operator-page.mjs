import { AppError } from '../shared/errors.mjs';

export async function findCurrentOperatorTemuPage(context) {
  const pages = context.pages().filter(page => !page.isClosed());
  const temuPages = pages.filter(page => isTemuUrl(page.url()));
  for (const page of [...temuPages].reverse()) {
    if (await page.evaluate(() => document.visibilityState === 'visible').catch(() => false)) return page;
  }
  return temuPages.at(-1) ?? null;
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
