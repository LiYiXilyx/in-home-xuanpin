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
  assert.match(script,/openVisibleReviews/);
  assert.match(script,/hasReviewGuidelineDialog/);
  assert.match(script,/collectDateBasedReviewCards/);
  assert.match(script,/inferRatingText/);
  assert.match(script,/未发现已显示的具体评论/);
  assert.match(script,/See all \/ View all reviews/);
});
