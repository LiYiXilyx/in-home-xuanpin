import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');

test('Day9.5 extension is Manifest V3 with only the intended hosts and active-tab access',() => {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'browser-extension/manifest.json'),'utf8'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['activeTab']);
  assert.deepEqual(manifest.host_permissions,['https://www.temu.com/*','http://127.0.0.1:37821/*']);
  assert.equal(manifest.content_scripts.length,3);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://www.temu.com/*']);
  assert.equal(manifest.content_scripts[0].world,'MAIN');assert.equal(manifest.content_scripts[0].run_at,'document_start');
  assert.deepEqual(manifest.content_scripts[0].js,['catalog-network-endpoints.js','catalog-network-parser.js','temu-network-interceptor.js']);
  assert.deepEqual(manifest.content_scripts[1].js,['catalog-network-endpoints.js','catalog-network-parser.js','catalog-network-cache.js','catalog-product-merger.js','catalog-network-bridge.js']);
  assert.equal(manifest.content_scripts[1].run_at,'document_start');
  assert.deepEqual(manifest.content_scripts[2].js,['review-loader.js','catalog-parser.js','catalog-capture.js','catalog-overlay-mode.js','catalog-breadcrumbs.js','catalog-operator-view-model.js','catalog-operator-overlay.js','catalog-manual-binding.js','catalog-manual-passive-runner.js','catalog-auto-runner.js','content-script.js']);
  assert.equal(manifest.background.service_worker,'background.js');
  assert.equal(manifest.action.default_popup,'popup.html');
});

test('extension does not request or access browser secrets',() => {
  const files=['manifest.json','background.js','catalog-parser.js','catalog-capture.js','catalog-overlay-mode.js','catalog-breadcrumbs.js','catalog-operator-view-model.js','catalog-operator-overlay.js','catalog-popup-view.js','catalog-manual-binding.js','catalog-manual-passive-runner.js','catalog-auto-runner.js','content-script.js','popup.js','temu-network-interceptor.js','catalog-network-bridge.js'].map(name => fs.readFileSync(path.join(root,'browser-extension',name),'utf8')).join('\n');
  assert.doesNotMatch(files,/\b(?:cookies|localStorage|sessionStorage|chrome\.history|chrome\.identity)\b/i);
  assert.doesNotMatch(files,/credentials\s*:\s*['"]include['"]/i);
  assert.match(files,/credentials\s*:\s*['"]omit['"]/i);
});

test('Catalog Auto Runner is isolated, checkpointed, bounded, and exposes operator controls',() => {
  const script=fs.readFileSync(path.join(root,'browser-extension/catalog-auto-runner.js'),'utf8');
  for (const state of ['IDLE','SCANNING','BATCH_SUBMITTING','SCROLLING','LOAD_MORE_DETECTED','LOAD_MORE_TRIGGERED','WAITING_PROGRESS','MANUAL_REQUIRED','COMPLETED','FAILED']) assert.match(script,new RegExp(state));
  assert.match(script,/attempt<=2/);assert.match(script,/SAVE_CATALOG_CHECKPOINT/);assert.match(script,/CATALOG_MANUAL_REQUIRED/);
  assert.match(script,/首次开始/);assert.match(script,/暂停/);assert.match(script,/恢复当前进度/);assert.match(script,/停止/);
  assert.match(script,/NETWORK_CAPTURE_DEBUG_BUILD='2026-08-27-C'/);assert.match(script,/Network Capture Debug Build:/);
  assert.match(script,/controls\.find\(node=>visible\(node\)/);
  assert.doesNotMatch(script,/\b(?:cookie|localStorage|sessionStorage|authorization|token)\b/i);
});

test('Manual Bind Passive Runner exposes dynamic state and has no automatic capture or navigation controls',() => {
  const script=fs.readFileSync(path.join(root,'browser-extension/catalog-manual-passive-runner.js'),'utf8');
  for (const state of ['UNBOUND','PAGE_READY','PAGE_BOUND','PAGE_CONTEXT_LOST','CAPTURING','PAUSED','TARGET_REACHED','COMPLETED','FAILED']) assert.match(script,new RegExp(state));
  for (const metric of ['Category:','Campaign:','Profile:','页面健康:','Bind:','target:','unique progress:','本次新增/重复/失败:','CAPTCHA/error:']) assert.match(script,new RegExp(metric));
  assert.match(script,/MANUAL_BIND_PASSIVE_CAPTURE/);assert.match(script,/qa_50_status/);assert.match(script,/qa_300_status/);
  assert.match(script,/capturePassive/);assert.match(script,/records\.has\(String\(card\.goods_id\)\)/);assert.match(script,/检测当前页面/);assert.match(script,/绑定当前页面/);assert.match(script,/采集当前页面/);assert.match(script,/导出影刀任务/);
  assert.doesNotMatch(script,/setInterval|clearInterval/);
  const binding=fs.readFileSync(path.join(root,'browser-extension/catalog-manual-binding.js'),'utf8');
  assert.match(binding,/bound_url/);assert.match(binding,/bound_at/);assert.match(binding,/bound_category/);assert.match(binding,/bound_sort/);assert.match(binding,/context_fingerprint/);
  assert.doesNotMatch(script,/location\.(?:assign|replace|reload)/);assert.doesNotMatch(script,/\.click\s*\(/);assert.doesNotMatch(script,/scrollTo\s*\(/);assert.doesNotMatch(script,/scrollTop\s*=/);
});

test('operator popup renders the shared dynamic Manual Bind model and no independent target state',()=>{
  const html=fs.readFileSync(path.join(root,'browser-extension/popup.html'),'utf8'),script=fs.readFileSync(path.join(root,'browser-extension/popup.js'),'utf8'),view=fs.readFileSync(path.join(root,'browser-extension/catalog-popup-view.js'),'utf8');
  assert.match(html,/catalog-operator-view-model\.js/);assert.match(html,/catalog-popup-view\.js/);
  for(const label of ['当前已采集','页面检查','绑定状态','检测当前页面','绑定当前页面','采集当前页面','技术详情'])assert.match(view,new RegExp(label));
  assert.match(script,/TemuCatalogOperatorViewModel\.build/);assert.match(script,/TemuCatalogPopupView\.renderMarkup/);assert.doesNotMatch(`${html}\n${script}\n${view}`,/target \/ unique|0 \/ 0|2147483647/);
  assert.doesNotMatch(`${html}\n${script}`,/德国站·摩托配件·Top Sales|D:\\工作项目/);
});

test('accepted Extension-First build no longer loads the temporary A/B harness',() => {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'browser-extension/manifest.json'),'utf8'));
  const scripts=manifest.content_scripts.flatMap(item=>item.js);
  assert.equal(scripts.includes('catalog-load-ab.js'),false);
  assert.equal(scripts.includes('catalog-auto-runner.js'),true);
  assert.equal(scripts.includes('catalog-manual-passive-runner.js'),true);
});

test('Catalog extension is isolated from Review and routes only localhost batch messages',() => {
  const background=fs.readFileSync(path.join(root,'browser-extension/background.js'),'utf8');
  const content=fs.readFileSync(path.join(root,'browser-extension/content-script.js'),'utf8');
  const capture=fs.readFileSync(path.join(root,'browser-extension/catalog-capture.js'),'utf8');
  assert.match(background,/GET_CATALOG_CONTEXT/);
  assert.match(background,/SAVE_CATALOG_BATCH/);
  assert.match(background,/GET_CATALOG_CURRENT/);
  assert.match(background,/127\.0\.0\.1:37821\/api\/catalog/);
  assert.match(content,/START_CATALOG_CAPTURE/);
  assert.match(content,/START_CURRENT_PAGE_CAPTURE/);
  assert.match(capture,/CATALOG_CONTEXT_MISMATCH/);
  assert.match(capture,/CATEGORY_MISMATCH/);
  assert.match(capture,/SORT_ORDER_MISMATCH/);
  assert.match(capture,/NO_PRODUCT_CARDS/);
  assert.match(capture,/temu-catalog-capture-button/);
  assert.match(capture,/采集当前商品列表/);
  assert.match(capture,/YINGDAO_CAPTURED/);
  assert.match(capture,/SAVE_CATALOG_CHECKPOINT/);
});

test('Catalog capture splits large DOM card sets below the localhost 500-card safety limit',() => {
  const source=fs.readFileSync(path.join(root,'browser-extension/catalog-capture.js'),'utf8');
  const sandbox=vm.createContext({ console,URL,location:{ href:'https://www.temu.com/de-en/motorcycles.html' },
    document:{ getElementById:() => ({}) } });vm.runInContext(source,sandbox);
  const capture=sandbox.TemuCatalogCapture;const chunks=capture.splitCards(Array.from({ length:820 },(_,index)=>index));
  assert.deepEqual(Array.from(chunks,chunk=>chunk.length),[300,300,220]);assert.equal(capture.MAX_CARDS_PER_BATCH,300);
});

test('OPEN_ENDED null batch limit means one bounded 300-card batch, never zero',() => {
  const source=fs.readFileSync(path.join(root,'browser-extension/catalog-capture.js'),'utf8');
  const sandbox=vm.createContext({console,URL,location:{href:'https://www.temu.com/de-en/girls-sets.html'},document:{getElementById:()=>({})}});vm.runInContext(source,sandbox);
  const resolve=sandbox.TemuCatalogCapture.resolvePassiveBatchLimit;
  assert.equal(resolve(null),300);assert.equal(resolve(undefined),300);assert.equal(resolve(40),40);assert.equal(resolve(350),300);assert.equal(resolve(10),10);
  for(const invalid of [0,-1,Number.NaN,1.5])assert.throws(()=>resolve(invalid),error=>error.code==='INVALID_PASSIVE_BATCH_LIMIT');
});

test('extension prompts the operator instead of submitting an empty review page',() => {
  const script=fs.readFileSync(path.join(root,'browser-extension/content-script.js'),'utf8');
  assert.match(script,/TemuReviewLoader/);
  assert.match(script,/SAVE_REVIEW_BATCH/);
  assert.match(script,/startPageIndex/);
  assert.match(script,/评论加载器未就绪/);
  assert.match(script,/GET_CURRENT_PAGE/);
});

test('Day9.6 review loader expands, loads more, scrolls, and exposes the batch loader without secrets',() => {
  const loader=fs.readFileSync(path.join(root,'browser-extension/review-loader.js'),'utf8');
  assert.match(loader,/findReviewOpenControl/);
  assert.match(loader,/findLoadMoreControl/);
  assert.match(loader,/scrollReviewPanel/);
  assert.match(loader,/loadReviews/);
  assert.match(loader,/CUTOFF_REACHED/);
  assert.match(loader,/NO_MORE_REVIEWS/);
  assert.match(loader,/waitForGuidelineClose/);
  assert.match(loader,/waitForReviewPanel/);
  assert.match(loader,/ensureMostRecent/);
  assert.match(loader,/waitForOperatorReviewPanel/);
  assert.match(loader,/hasSecurityVerification/);
  assert.match(loader,/waitForSecurityVerification/);
  assert.match(loader,/MANUAL_VERIFICATION_REQUIRED/);
  assert.match(loader,/安全验证已通过，正在继续评论采集/);
  assert.match(loader,/findTextControl/);
  assert.match(loader,/scrollScore/);
  assert.match(loader,/resetReviewScroll/);
  assert.match(loader,/reviewSignature/);
  assert.doesNotMatch(loader,/\b(?:cookie|localStorage|sessionStorage|authorization|token)\b/i);
});

test('Day9.7 extension reports queue capture completion and failure through localhost only',() => {
  const background=fs.readFileSync(path.join(root,'browser-extension/background.js'),'utf8');
  const content=fs.readFileSync(path.join(root,'browser-extension/content-script.js'),'utf8');
  assert.match(background,/FAIL_REVIEW_CAPTURE/);
  assert.match(background,/capture-failed/);
  assert.match(content,/FINISH_REVIEW_SCROLL/);
  assert.match(content,/FAIL_REVIEW_CAPTURE/);
  assert.match(content,/MANUAL_VERIFICATION_REQUIRED/);
  assert.match(content,/errorCode:errorCode|errorCode,errorMessage/);
  assert.doesNotMatch(`${background}\n${content}`,/credentials\s*:\s*['"]include['"]/i);
});
