import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyPageSignals, detectChallenge } from '../../src/browser/challenge-handler.mjs';
import { findInstalledChrome } from '../../src/browser/chrome-locator.mjs';
import { findCurrentOperatorTemuPage, requireCurrentOperatorTemuPage } from '../../src/browser/operator-page.mjs';
import { closeBrowserSession,connectOperatorSession,openBrowserSession,resolveBrowserLocale } from '../../src/browser/cdp-session.mjs';

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

test('operator page prefers a catalog listing when Chrome reports multiple Temu tabs visible', async () => {
  const page = url => ({ url:() => url,isClosed:() => false,evaluate:async () => true });
  const motorcycleListing=page('https://www.temu.com/de-en/motorcycles--accessories-o3-585.html?opt_level=2&leaf_type=bro');
  const unrelatedProduct=page('https://www.temu.com/de-en/elegant-clutch-g-601099796500465.html');
  assert.equal(await findCurrentOperatorTemuPage({ pages:() => [motorcycleListing,unrelatedProduct] }),motorcycleListing);
});

test('CDP and closed-browser failures use retriable stable codes', async () => {
  await assert.rejects(connectOperatorSession({ browser: { cdpEndpoint: 'http://127.0.0.1:65530' } }, {
    fetchImpl: async () => ({ ok: false })
  }), error => error.code === 'CDP_UNREACHABLE' && error.retriable === true);
  assert.deepEqual(await detectChallenge({ isClosed: () => true }), { code: 'BROWSER_CLOSED', retriable: true });
});

test('independent Chrome launches with the configured target locale',async t => {
  assert.equal(resolveBrowserLocale({ browser:{ locale:'en-DE' } }),'en-DE');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-browser-locale-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  const launches=[];
  let readyCalls=0;
  const session=await openBrowserSession({ browser:{ executablePath:'C:/Chrome/chrome.exe',profileDir:path.join(directory,'fresh'),debugPort:9239,locale:'en-DE' } },{
    access:async () => {},fetchImpl:async () => ({ ok:++readyCalls > 1 }),
    spawn:(file,args) => { launches.push({ file,args });return { exitCode:null,unref() {} }; },
    chromium:{ connectOverCDP:async () => ({ contexts:() => [{ pages:() => [] }] }) }
  });
  assert.ok(launches[0].args.includes('--lang=en-DE'));
  assert.ok(launches[0].args.includes('--remote-debugging-port=9239'));
  assert.equal(session.context.pages().length,0);
});

test('external CDP connects without creating or closing the user browser',async () => {
  let browserCloseCalls=0;
  const context={ pages:() => [] };
  const session=await connectOperatorSession({ browser:{ mode:'external_cdp',cdpEndpoint:'http://127.0.0.1:9333' } },{
    fetchImpl:async () => ({ ok:true }),
    chromium:{ connectOverCDP:async endpoint => {
      assert.equal(endpoint,'http://127.0.0.1:9333');
      return { contexts:() => [context],close:async () => { browserCloseCalls+=1; } };
    } }
  });
  assert.equal(session.external,true);
  assert.equal(session.launchedByUs,false);
  await closeBrowserSession(session,{ browser:{ mode:'external_cdp' } });
  assert.equal(browserCloseCalls,0,'disconnecting the server must not close external Chrome');
});

test('external CDP unavailable is retriable and never tries to launch Chrome',async () => {
  let connectCalls=0;
  await assert.rejects(openBrowserSession({ browser:{ mode:'external_cdp',cdpEndpoint:'http://127.0.0.1:65529' } },{
    fetchImpl:async () => ({ ok:false }),spawn:() => { throw new Error('must not spawn'); },
    chromium:{ connectOverCDP:async () => { connectCalls+=1; } }
  }),error => error.code === 'CDP_UNREACHABLE' && error.retriable === true);
  assert.equal(connectCalls,0);
});

test('external CDP with no context still never closes the user browser',async () => {
  let closeCalls=0;
  await assert.rejects(connectOperatorSession({ browser:{ mode:'external_cdp',cdpEndpoint:'http://127.0.0.1:9333' } },{
    fetchImpl:async () => ({ ok:true }),chromium:{ connectOverCDP:async () => ({ contexts:() => [],close:async () => { closeCalls+=1; } }) }
  }),error => error.code === 'NO_TEMU_PAGE');
  assert.equal(closeCalls,0);
});
