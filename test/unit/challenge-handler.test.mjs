import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyPageSignals, detectChallenge } from '../../src/browser/challenge-handler.mjs';
import { findInstalledChrome } from '../../src/browser/chrome-locator.mjs';
import { findCurrentOperatorTemuPage, requireCurrentOperatorTemuPage } from '../../src/browser/operator-page.mjs';
import { connectOperatorSession } from '../../src/browser/cdp-session.mjs';

test('challenge handler returns stable operator-facing error codes', () => {
  assert.equal(classifyPageSignals({ url: 'https://www.temu.com/bgn_verification.html', text: 'Verify you are human' }).code, 'CAPTCHA_OR_LOGIN');
  assert.equal(classifyPageSignals({ url: 'https://www.temu.com/login.html', text: 'Sign in / Register' }).code, 'CAPTCHA_OR_LOGIN');
  assert.equal(classifyPageSignals({ url: 'https://www.temu.com/', text: 'Network error, connection timed out' }).code, 'NETWORK_ERROR');
  assert.equal(classifyPageSignals({ url: 'https://www.temu.com/', text: 'Access denied: unusual traffic' }).code, 'ACCESS_RESTRICTED');
  assert.equal(classifyPageSignals({ url: 'https://www.temu.com/category.html', text: 'Top Sales products', loggedInEvidence: true }), null);
});

test('chrome locator honors configured path and emits CHROME_NOT_FOUND without probing profiles', async () => {
  const configured = path.resolve('C:/portable/chrome.exe');
  const seen = [];
  const result = await findInstalledChrome({ browser: { executablePath: configured } }, {
    access: async candidate => { seen.push(candidate); }
  });
  assert.equal(result, configured);
  assert.deepEqual(seen, [configured]);
  await assert.rejects(findInstalledChrome({ browser: { executablePath: configured } }, {
    access: async () => { throw new Error('missing'); }
  }), error => error.code === 'CHROME_NOT_FOUND');
});

test('operator page prefers the visible Temu tab and classifies wrong pages', async () => {
  const page = (url, visible) => ({
    url: () => url, isClosed: () => false,
    evaluate: async () => visible
  });
  const hiddenTemu = page('https://www.temu.com/old', false);
  const visibleTemu = page('https://www.temu.com/category.html', true);
  assert.equal(await findCurrentOperatorTemuPage({ pages: () => [hiddenTemu, visibleTemu] }), visibleTemu);
  await assert.rejects(requireCurrentOperatorTemuPage({ pages: () => [page('https://example.com', true)] }), error => error.code === 'WRONG_PAGE');
  await assert.rejects(requireCurrentOperatorTemuPage({ pages: () => [] }), error => error.code === 'NO_TEMU_PAGE');
});

test('CDP and closed-browser failures use retriable stable codes', async () => {
  await assert.rejects(connectOperatorSession({ browser: { cdpEndpoint: 'http://127.0.0.1:65530' } }, {
    fetchImpl: async () => ({ ok: false })
  }), error => error.code === 'CDP_UNREACHABLE' && error.retriable === true);
  assert.deepEqual(await detectChallenge({ isClosed: () => true }), { code: 'BROWSER_CLOSED', retriable: true });
});
