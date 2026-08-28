'use strict';

(() => {
  const ALLOWED_PATHS=Object.freeze([
    /^\/api\/poppy\/v1\/search(?:\/|$)/i,
    /^\/api\/poppy\/v1\/opt(?:\/|$)/i,
    /^\/api\/alexa\/homepage\/goods_list(?:\/|$)/i,
    /^\/api\/poppy\/v1\/goods_detail(?:\/|$)/i,
    /^\/api\/market\/domino\/batch\/query_goods(?:\/|$)/i
  ]);
  const DIAGNOSTIC_CANDIDATE_PATHS=Object.freeze([/^\/[a-z]{2}(?:-[a-z]{2})?\/api\/poppy\/v1\/opt(?:\/|$)/i]);
  function normalizeTemuApiPath(pathname) {
    return String(pathname??'').replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/api\/)/i,'');
  }
  function isCatalogProductEndpoint(value,base='https://www.temu.com/') {
    try { const url=new URL(String(value),base),path=normalizeTemuApiPath(url.pathname);return url.protocol==='https:'&&url.hostname==='www.temu.com'&&ALLOWED_PATHS.some(pattern=>pattern.test(path)); }
    catch { return false; }
  }
  function isDiagnosticCandidateEndpoint(value,base='https://www.temu.com/') {
    try { const url=new URL(String(value),base);return url.protocol==='https:'&&url.hostname==='www.temu.com'&&DIAGNOSTIC_CANDIDATE_PATHS.some(pattern=>pattern.test(url.pathname)); }
    catch { return false; }
  }
  function captureMode(value,base='https://www.temu.com/') {
    try { const url=new URL(String(value),base);return isDiagnosticCandidateEndpoint(url.href,base)?'diagnostic_parse':isCatalogProductEndpoint(url.href,base)?'allowlist':null; }
    catch { return null; }
  }
  globalThis.TemuCatalogNetworkEndpoints=Object.freeze({ALLOWED_PATHS,DIAGNOSTIC_CANDIDATE_PATHS,normalizeTemuApiPath,isCatalogProductEndpoint,isDiagnosticCandidateEndpoint,captureMode});
})();
