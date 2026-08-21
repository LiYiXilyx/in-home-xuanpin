import { AppError } from '../../shared/errors.mjs';
import { isTemuUrl } from '../../browser/operator-page.mjs';
import { detectChallenge } from '../../browser/challenge-handler.mjs';
import { evaluatePageHealth } from './page-health.mjs';

const CATEGORY_PATTERN = /motorcycl|motocross|powersport/i;
const TOP_SALES_PATTERN = /(?:sort\s*by\s*:?\s*)?top\s*sales/i;

export async function validateListingPage(page, config, job) {
  const challenge = await detectChallenge(page);
  if (challenge) throw new AppError('当前 Temu 页面需要人工处理后才能采集。', { code: challenge.code, retriable: true });
  const evidence = await collectListingEvidence(page, config);
  return validateListingEvidence(evidence, {
    siteCountry: config.catalog?.siteCountry ?? config.siteCountry, language: config.catalog?.language ?? config.language,
    currency: config.catalog?.currency ?? config.currency, primaryCategory: job.primaryCategory,
    subcategory: job.subcategory, sortOrder: job.sortOrder
  });
}

export async function collectListingEvidence(page, config) {
  const selector = config.catalog?.selectors?.productLinks ?? config.selectors?.productLinks ?? "a[href*='goods.html'], a[href*='-g-']";
  const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  const productLinkCount = await page.locator(selector).count().catch(() => 0);
  const documentEvidence = await page.evaluate(() => ({
    htmlLang: document.documentElement.lang || '', title: document.title || '',
    selectedLabels: [...document.querySelectorAll('[aria-selected="true"], [aria-checked="true"], option:checked')]
      .map(node => `${node.textContent || ''} ${node.getAttribute?.('aria-label') || ''}`.trim()).slice(0, 30)
  })).catch(() => ({ htmlLang: '', title: '', selectedLabels: [] }));
  return { url: page.url(), bodyText: bodyText.slice(0, 80_000), productLinkCount,
    htmlLang: documentEvidence.htmlLang, title: documentEvidence.title, selectedLabels: documentEvidence.selectedLabels };
}

export function validateListingEvidence(evidence, expected) {
  if (!isTemuUrl(evidence.url)) fail('WRONG_SITE', '当前页面不是 temu.com，采集已停止。');
  const health=evaluatePageHealth(evidence,expected);
  if (['SEARCH_NO_RESULTS','STALE_CATEGORY_PAGE','NETWORK_ERROR','CAPTCHA_OR_LOGIN'].includes(health.code)) {
    fail(health.code,'当前页面处于空结果、过期类目、网络错误或人工登录验证状态，采集已停止。');
  }
  if (!Number.isInteger(evidence.productLinkCount) || evidence.productLinkCount < 1) fail('LISTING_NOT_FOUND', '当前页面没有发现 Temu 商品列表，采集已停止。');
  const searchable = `${evidence.url} ${evidence.title} ${evidence.bodyText}`;
  if (!CATEGORY_PATTERN.test(searchable)) fail('CATEGORY_NOT_CONFIRMED', '当前页面不能确认属于摩托配件类目，采集已停止。');
  const selected = `${evidence.selectedLabels?.join(' ') ?? ''} ${evidence.bodyText}`;
  if (/^top\s*sales$/i.test(expected.sortOrder?.trim() ?? '') && !TOP_SALES_PATTERN.test(selected)) {
    fail('SORT_NOT_CONFIRMED', '当前页面不能确认 Top Sales 排序，采集已停止。');
  }
  if (!currencyPattern(expected.currency).test(searchable)) fail('CURRENCY_NOT_CONFIRMED', `当前页面不能确认币种 ${expected.currency}，采集已停止。`);
  if (!languageMatches(evidence.htmlLang, expected.language)) {
    fail('LANGUAGE_NOT_CONFIRMED', `当前页面语言 ${evidence.htmlLang || '未知'} 与配置 ${expected.language} 不一致，采集已停止。`);
  }
  if (!countryPattern(expected.siteCountry).test(searchable)) fail('COUNTRY_NOT_CONFIRMED', `当前页面不能确认站点 ${expected.siteCountry}，采集已停止。`);
  return { ...evidence, expected, valid: true };
}
function fail(code, message) { throw new AppError(message, { code, retriable: true }); }
function currencyPattern(currency) {
  const patterns = { EUR: /€|\bEUR\b/i, USD: /\$|\bUSD\b/i, GBP: /£|\bGBP\b/i };
  return patterns[String(currency).toUpperCase()] ?? new RegExp(`\\b${escapeRegex(currency)}\\b`, 'i');
}
function countryPattern(country) {
  const patterns = { '德国': /\bGermany\b|\bDeutschland\b|ship(?:ping)?\s+to\s+DE\b/i, Germany: /\bGermany\b|\bDeutschland\b|ship(?:ping)?\s+to\s+DE\b/i };
  return patterns[country] ?? new RegExp(escapeRegex(country), 'i');
}
function languageMatches(actual, expected) { return Boolean(actual && expected) && actual.toLowerCase().split('-')[0] === String(expected).toLowerCase().split('-')[0]; }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
