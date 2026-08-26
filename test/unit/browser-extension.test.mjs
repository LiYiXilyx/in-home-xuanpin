import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');

test('Day9.5 extension is Manifest V3 with only the intended hosts and active-tab access',() => {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'browser-extension/manifest.json'),'utf8'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['activeTab']);
  assert.deepEqual(manifest.host_permissions,['https://www.temu.com/*','http://127.0.0.1:37821/*']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://www.temu.com/*']);
  assert.deepEqual(manifest.content_scripts[0].js,['review-loader.js','content-script.js']);
  assert.equal(manifest.background.service_worker,'background.js');
  assert.equal(manifest.action.default_popup,'popup.html');
});

test('extension does not request or access browser secrets',() => {
  const files=['manifest.json','background.js','content-script.js','popup.js'].map(name => fs.readFileSync(path.join(root,'browser-extension',name),'utf8')).join('\n');
  assert.doesNotMatch(files,/\b(?:cookies|localStorage|sessionStorage|chrome\.history|chrome\.identity)\b/i);
  assert.doesNotMatch(files,/credentials\s*:\s*['"]include['"]/i);
  assert.match(files,/credentials\s*:\s*['"]omit['"]/i);
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
