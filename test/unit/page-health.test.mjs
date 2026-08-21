import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePageHealth,profileHealthWarning } from '../../src/modules/catalog/page-health.mjs';

const expected={ siteCountry:'德国',language:'en',currency:'EUR',primaryCategory:'Automotive',subcategory:'Motorcycles & Powersports Accessories',sortOrder:'Top Sales' };
const base={ url:'https://www.temu.com/de-en/motorcycles-accessories.html',title:'Motorcycle accessories',htmlLang:'en-DE',
  bodyText:'Hello, operator Germany EUR € Motorcycles & Powersports Accessories Top Sales',selectedLabels:['Top Sales'],productLinkCount:20 };

test('page health detects READY and known empty/error pages',() => {
  assert.equal(evaluatePageHealth(base,expected).status,'READY');
  assert.equal(evaluatePageHealth({ ...base,bodyText:'No results for "phone case"',productLinkCount:0 },expected).code,'SEARCH_NO_RESULTS');
  assert.equal(evaluatePageHealth({ ...base,bodyText:'Oops! The items are gone. Try again to find items',productLinkCount:0 },expected).code,'STALE_CATEGORY_PAGE');
  assert.equal(evaluatePageHealth({ ...base,bodyText:'Please check your network connection and try again.',productLinkCount:0 },expected).code,'NETWORK_ERROR');
  assert.equal(evaluatePageHealth({ ...base,url:'https://www.temu.com/login.html',bodyText:'Sign in / Register',loginFormVisible:true,productLinkCount:0 },expected).code,'CAPTCHA_OR_LOGIN');
});

test('profile warning requires healthy home plus three distinct empty searches',() => {
  const observations=[{ homeHealthy:true,code:'CATEGORY_NOT_CONFIRMED' },...['phone case','shoes','motorcycle accessories'].map(query => ({ code:'SEARCH_NO_RESULTS',query }))];
  assert.match(profileHealthWarning(observations),/profile|独立 Chrome/);
});

test('diagnostics expose URL parameter names but never their values',() => {
  const result=evaluatePageHealth({ ...base,url:'https://www.temu.com/category.html?_x_sessn_id=secret-value&refer_page_name=home',
    queryParamNames:['_x_sessn_id','refer_page_name'],navigatorOnline:true,navigatorLanguage:'en-US',timezone:'Europe/Berlin',
    documentReadyState:'complete',bodyTextLength:1234,navigation:{ type:'navigate',responseStartMs:12 } },expected);
  assert.equal(result.diagnostics.urlPath,'/category.html');
  assert.deepEqual(result.diagnostics.sessionParamNames,['_x_sessn_id','refer_page_name']);
  assert.equal(result.diagnostics.markers.navigatorLanguageMismatch,false);
  assert.equal(result.diagnostics.markers.targetCountryTimezoneMismatch,false);
  assert.equal(JSON.stringify(result.diagnostics).includes('secret-value'),false);
});

test('diagnostics flag browser locale and timezone differences without changing readiness rules',() => {
  const result=evaluatePageHealth({ ...base,navigatorLanguage:'zh-CN',timezone:'Asia/Shanghai' },expected);
  assert.equal(result.status,'READY');
  assert.equal(result.diagnostics.markers.navigatorLanguageMismatch,true);
  assert.equal(result.diagnostics.markers.targetCountryTimezoneMismatch,true);
});
