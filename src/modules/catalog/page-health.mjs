import { classifyPageSignals } from '../../browser/challenge-handler.mjs';
import { isTemuUrl } from '../../browser/operator-page.mjs';

const SEARCH_NO_RESULTS_PATTERN=/No results for\s*[“"']?[^\n”"']+[”"']?/i;
const STALE_CATEGORY_PATTERN=/Oops!\s*The items are gone\.?[\s\S]{0,120}Try again to find items/i;
const NETWORK_ERROR_PATTERN=/Please check your network connection and try again|network error|connection timed out|err_(?:connection|network)/i;
const CATEGORY_PATTERN=/motorcycl|motocross|powersport/i;
const TOP_SALES_PATTERN=/(?:sort\s*by\s*:?\s*)?top\s*sales/i;

export async function inspectCurrentPageHealth(page,config,job=config.catalog.jobs[0]) {
  const selector=config.catalog?.selectors?.productLinks ?? "a[href*='goods.html'], a[href*='-g-']";
  const bodyText=await page.locator('body').innerText({ timeout:10_000 }).catch(() => '');
  const productLinkCount=await page.locator(selector).count().catch(() => 0);
  const evidence=await page.evaluate(() => ({
    htmlLang:document.documentElement.lang || '',title:document.title || '',
    urlHost:location.host,urlPath:location.pathname,
    queryParamNames:[...new Set([...new URL(location.href).searchParams.keys()])].slice(0,30),
    documentReadyState:document.readyState,bodyTextLength:document.body?.innerText?.length ?? 0,
    navigatorOnline:navigator.onLine,navigatorLanguage:navigator.language || '',
    navigatorLanguages:Array.from(navigator.languages ?? []).slice(0,8),
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || '',visibilityState:document.visibilityState,
    serviceWorkerControlled:Boolean(navigator.serviceWorker?.controller),
    navigation:(() => { const item=performance.getEntriesByType('navigation')[0];return item ? {
      type:item.type,responseStartMs:Math.round(item.responseStart),domContentLoadedMs:Math.round(item.domContentLoadedEventEnd),
      loadEventEndMs:Math.round(item.loadEventEnd),transferSize:Number(item.transferSize ?? 0)
    }:null; })(),
    selectedLabels:[...document.querySelectorAll('[aria-selected="true"], [aria-checked="true"], option:checked')]
      .map(node => `${node.textContent || ''} ${node.getAttribute?.('aria-label') || ''}`.trim()).slice(0,30),
    loginFormVisible:Boolean(document.querySelector("input[type='password'], input[autocomplete='username'], input[autocomplete='current-password']"))
  })).catch(() => ({ htmlLang:'',title:'',selectedLabels:[],loginFormVisible:false }));
  return evaluatePageHealth({
    url:page.url(),bodyText:bodyText.slice(0,80_000),productLinkCount,frameUrls:page.frames().map(frame => frame.url()),...evidence
  },{
    siteCountry:config.catalog.siteCountry,language:config.catalog.language,currency:config.catalog.currency,
    primaryCategory:job?.primaryCategory,subcategory:job?.subcategory,sortOrder:job?.sortOrder,browserLocale:config.browser?.locale
  });
}

export function evaluatePageHealth(evidence,expected={}) {
  const text=`${evidence.title ?? ''} ${evidence.bodyText ?? ''}`;
  const selected=`${evidence.selectedLabels?.join(' ') ?? ''} ${text}`;
  const temuPage=isTemuUrl(evidence.url);
  const loggedInEvidence=/Orders\s*&\s*Account|Hello\s*[,，]/i.test(text);
  const challenge=classifyPageSignals({
    url:evidence.url,text,frameUrls:evidence.frameUrls ?? [],loginFormVisible:Boolean(evidence.loginFormVisible),loggedInEvidence
  });
  const productListVisible=Number(evidence.productLinkCount ?? 0)>0;
  const categoryConfirmed=CATEGORY_PATTERN.test(`${evidence.url ?? ''} ${text}`);
  const topSalesConfirmed=TOP_SALES_PATTERN.test(selected);
  const countryConfirmed=countryPattern(expected.siteCountry).test(text);
  const languageConfirmed=languageMatches(evidence.htmlLang,expected.language);
  const currencyConfirmed=currencyPattern(expected.currency).test(text);
  let code='READY';
  if (!temuPage) code='WRONG_SITE';
  else if (challenge?.code) code=challenge.code;
  else if (NETWORK_ERROR_PATTERN.test(text)) code='NETWORK_ERROR';
  else if (SEARCH_NO_RESULTS_PATTERN.test(text)) code='SEARCH_NO_RESULTS';
  else if (STALE_CATEGORY_PATTERN.test(text)) code='STALE_CATEGORY_PAGE';
  else if (!productListVisible) code='LISTING_NOT_FOUND';
  else if (!categoryConfirmed) code='CATEGORY_NOT_CONFIRMED';
  else if (!topSalesConfirmed) code='SORT_NOT_CONFIRMED';
  else if (!countryConfirmed) code='COUNTRY_NOT_CONFIRMED';
  else if (!languageConfirmed) code='LANGUAGE_NOT_CONFIRMED';
  else if (!currencyConfirmed) code='CURRENCY_NOT_CONFIRMED';
  const status=code === 'READY' ? 'READY':'NOT_READY';
  return {
    status,code,
    checks:{
      CDP_CONNECTED:true,TEMU_PAGE:temuPage,
      LOGIN_STATUS:challenge?.code === 'CAPTCHA_OR_LOGIN' ? 'LOGIN_REQUIRED':loggedInEvidence ? 'LOGGED_IN':'UNKNOWN',
      COUNTRY:countryConfirmed ? String(expected.siteCountry ?? 'CONFIRMED'):'UNKNOWN',
      LANGUAGE:languageConfirmed ? String(expected.language ?? evidence.htmlLang):String(evidence.htmlLang || 'UNKNOWN'),
      CURRENCY:currencyConfirmed ? String(expected.currency ?? 'CONFIRMED'):'UNKNOWN',
      PRODUCT_LIST_VISIBLE:productListVisible,CATEGORY_CONFIRMED:categoryConfirmed,
      TOP_SALES_CONFIRMED:topSalesConfirmed,PAGE_HEALTH:code
    },
    productLinkCount:Number(evidence.productLinkCount ?? 0),query:searchQuery(evidence.url,text),
    diagnostics:buildDiagnostics(evidence,expected,text),
    homeHealthy:temuPage && productListVisible && !categoryConfirmed && isHomePage(evidence.url) && !challenge
  };
}

function buildDiagnostics(evidence,expected,text) {
  const url=safeUrl(evidence.url);
  const queryParamNames=Array.from(new Set(evidence.queryParamNames ?? (url ? [...url.searchParams.keys()]:[]))).slice(0,30);
  return {
    urlHost:evidence.urlHost || url?.host || '',urlPath:evidence.urlPath || url?.pathname || '',queryParamNames,
    sessionParamNames:queryParamNames.filter(name => /sess|refer|token|sign|trace|scene/i.test(name)),
    pageTitle:String(evidence.title ?? '').slice(0,160),documentReadyState:evidence.documentReadyState ?? 'UNKNOWN',
    bodyTextLength:Number(evidence.bodyTextLength ?? String(evidence.bodyText ?? '').length),
    navigatorOnline:evidence.navigatorOnline ?? null,navigatorLanguage:evidence.navigatorLanguage || evidence.htmlLang || 'UNKNOWN',
    navigatorLanguages:Array.isArray(evidence.navigatorLanguages) ? evidence.navigatorLanguages:[],timezone:evidence.timezone || 'UNKNOWN',
    visibilityState:evidence.visibilityState || 'UNKNOWN',serviceWorkerControlled:Boolean(evidence.serviceWorkerControlled),
    navigation:evidence.navigation ?? null,productLinkCount:Number(evidence.productLinkCount ?? 0),
    markers:{ searchNoResults:SEARCH_NO_RESULTS_PATTERN.test(text),staleCategory:STALE_CATEGORY_PATTERN.test(text),networkError:NETWORK_ERROR_PATTERN.test(text),
      sessionParamsPresent:queryParamNames.some(name => /sess|refer|token|sign|trace|scene/i.test(name)),
      navigatorLanguageMismatch:Boolean(evidence.navigatorLanguage && expected.language && !languageMatches(evidence.navigatorLanguage,expected.language)),
      targetCountryTimezoneMismatch:['德国','Germany'].includes(String(expected.siteCountry)) && Boolean(evidence.timezone) && !/^Europe\/(?:Berlin|Busingen)$/i.test(evidence.timezone) },
    expected:{ country:String(expected.siteCountry ?? ''),language:String(expected.language ?? ''),currency:String(expected.currency ?? ''),
      primaryCategory:String(expected.primaryCategory ?? ''),subcategory:String(expected.subcategory ?? ''),sortOrder:String(expected.sortOrder ?? ''),
      browserLocale:String(expected.browserLocale ?? '') }
  };
}

export function profileHealthWarning(observations) {
  const homeHealthy=observations.some(item => item.homeHealthy);
  const failedQueries=new Set(observations.filter(item => item.code === 'SEARCH_NO_RESULTS' && item.query).map(item => item.query.toLowerCase()));
  return homeHealthy && failedQueries.size >= 3
    ? '当前独立 Chrome profile 可能存在异常的 Temu 会话或地区状态。建议创建新的独立采集 Chrome 后重新登录。'
    : null;
}

function searchQuery(value,text) {
  try {
    const url=new URL(value);
    for (const key of ['search_key','q','query','keyword']) { const found=url.searchParams.get(key);if (found) return found.trim(); }
  } catch {}
  return text.match(/No results for\s*[“"']?([^\n”"']+)/i)?.[1]?.trim() ?? null;
}
function safeUrl(value) { try { return new URL(value); } catch { return null; } }
function isHomePage(value) { try { return /^\/(?:[a-z]{2}-[a-z]{2}\/?)?$/i.test(new URL(value).pathname); } catch { return false; } }
function currencyPattern(currency) { return ({ EUR:/€|\bEUR\b/i,USD:/\$|\bUSD\b/i,GBP:/£|\bGBP\b/i })[String(currency).toUpperCase()] ?? /$a/; }
function countryPattern(country) { return ['德国','Germany'].includes(String(country)) ? /\bGermany\b|\bDeutschland\b|ship(?:ping)?\s+to\s+DE\b/i : new RegExp(escapeRegex(country ?? ''),'i'); }
function languageMatches(actual,expected) { return Boolean(actual && expected) && actual.toLowerCase().split('-')[0] === String(expected).toLowerCase().split('-')[0]; }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
