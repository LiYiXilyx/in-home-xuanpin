import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn as spawnProcess } from 'node:child_process';
import { chromium as defaultChromium } from 'playwright';
import { AppError } from '../shared/errors.mjs';
import { findInstalledChrome } from './chrome-locator.mjs';

export function configuredCdpEndpoint(config) {
  return config.browser?.cdpEndpoint || `http://127.0.0.1:${Number(config.browser?.debugPort ?? 9227)}`;
}

export function browserMode(config) {
  return config.browser?.mode === 'external_cdp' ? 'external_cdp':'managed_profile';
}

export async function isCdpReady(endpoint, { fetchImpl = fetch, timeoutMs = 1_000 } = {}) {
  return fetchImpl(`${endpoint}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    .then(response => response.ok).catch(() => false);
}

export async function connectOperatorSession(config, dependencies = {}) {
  const chromium = dependencies.chromium ?? defaultChromium;
  const endpoint = configuredCdpEndpoint(config);
  const external=browserMode(config) === 'external_cdp';
  if (!await isCdpReady(endpoint, dependencies)) {
    const message=browserMode(config) === 'external_cdp'
      ? '无法连接已有 Chrome。请确认 Chrome 已开启 CDP，并检查 cdpEndpoint。'
      : '采集 Chrome 尚未连接。请先打开独立采集 Chrome，人工登录后再继续。';
    throw new AppError(message, {
      code: 'CDP_UNREACHABLE', retriable: true, details: { endpoint }
    });
  }
  if (external) await verifyFixedBrowserSession(config, dependencies);
  try {
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) {
      if (!external) await browser.close().catch(() => {});
      throw new AppError('CDP 已连接，但没有可用浏览器上下文。', { code: 'NO_TEMU_PAGE', retriable: true });
    }
    return { browser, context, persistent: false, launchedByUs: false,external,endpoint };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('无法连接采集 Chrome 的 CDP 会话。', {
      code: 'CDP_UNREACHABLE', retriable: true, details: { endpoint }, cause: error
    });
  }
}

export async function openBrowserSession(config, dependencies = {}) {
  const chromium = dependencies.chromium ?? defaultChromium;
  const spawn = dependencies.spawn ?? spawnProcess;
  if (browserMode(config) === 'external_cdp') return connectOperatorSession(config, { ...dependencies, chromium });
  await fs.mkdir(config.browser.profileDir ?? config.profileDir, { recursive: true });
  const executablePath = await findInstalledChrome(config, dependencies);
  if (config.browser?.launchViaCdp !== false) {
    const endpoint = configuredCdpEndpoint(config);
    let chromeProcess = null;
    let ready = await isCdpReady(endpoint, dependencies);
    if (!ready) {
      chromeProcess = spawn(executablePath, [
        `--remote-debugging-port=${Number(config.browser.debugPort ?? 9227)}`,
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${config.browser.profileDir ?? config.profileDir}`,
        `--lang=${resolveBrowserLocale(config)}`,
        '--no-first-run', '--no-default-browser-check', '--new-window', 'about:blank'
      ], { detached: true, stdio: 'ignore', windowsHide: false });
      chromeProcess.unref?.();
      for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
        await delay(500);
        ready = await isCdpReady(endpoint, dependencies);
        if (chromeProcess.exitCode != null) break;
      }
    }
    if (!ready) {
      chromeProcess?.kill();
      throw new AppError(`Chrome 已启动，但无法连接本地调试端口 ${config.browser.debugPort ?? 9227}。`, {
        code: 'CDP_UNREACHABLE', retriable: true, details: { endpoint }
      });
    }
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new AppError('Chrome 已连接，但没有可用上下文。', { code: 'NO_TEMU_PAGE', retriable: true });
    return { browser, context, persistent: false, launchedByUs: Boolean(chromeProcess), chromeProcess, endpoint };
  }
  const context = await chromium.launchPersistentContext(config.browser.profileDir ?? config.profileDir, {
    executablePath, headless: Boolean(config.browser.headless), chromiumSandbox: true, timeout: 30_000,
    args: ['--disable-gpu', '--disable-gpu-shader-disk-cache'], locale: resolveBrowserLocale(config), viewport: { width: 1440, height: 900 }
  });
  return { browser: null, context, persistent: true, launchedByUs: true };
}

export async function verifyFixedBrowserSession(config, dependencies = {}) {
  const fixed=config.browser?.fixedProfile;
  if (!fixed?.enabled) return null;
  const baseDir=config.configPath ? path.dirname(config.configPath):process.cwd();
  const sessionFile=path.resolve(baseDir,String(fixed.sessionFile ?? ''));
  const readFile=dependencies.readFile ?? fs.readFile;
  let marker;
  try {
    marker=JSON.parse(await readFile(sessionFile,'utf8'));
  } catch (error) {
    throw fixedSessionError('SESSION_MARKER_MISSING',{ sessionFile },error);
  }
  const expected={
    cdp_endpoint:configuredCdpEndpoint(config),
    chrome_executable:fixed.executablePath ?? config.browser?.executablePath,
    user_data_dir:fixed.userDataDir ?? config.browser?.profileDir,
    profile_directory:fixed.profileDirectory ?? config.browser?.profileDirectory
  };
  for (const [field,value] of Object.entries(expected)) {
    const actual=marker?.[field];
    const matches=field.endsWith('_endpoint')
      ? String(actual ?? '') === String(value ?? '')
      : field === 'profile_directory'
        ? String(actual ?? '') === String(value ?? '')
        : samePath(actual,value);
    if (!matches) throw fixedSessionError('SESSION_MARKER_MISMATCH',{ field,sessionFile });
  }
  const processId=Number(marker?.process_id);
  const isProcessAlive=dependencies.isProcessAlive ?? defaultIsProcessAlive;
  if (!Number.isInteger(processId) || processId < 1 || !isProcessAlive(processId)) {
    throw fixedSessionError('SESSION_PROCESS_NOT_RUNNING',{ sessionFile });
  }
  return { ...marker,session_file:sessionFile };
}

function defaultIsProcessAlive(processId) {
  try { process.kill(processId,0);return true; } catch { return false; }
}

function samePath(left,right) {
  if (!left || !right) return false;
  return path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase();
}

function fixedSessionError(reason,details,cause) {
  return new AppError('9222 不是固定 Temu Chrome launcher 启动的已验证会话。请关闭 Chrome 后运行 npm run browser:temu。',{
    code:'FIXED_BROWSER_SESSION_UNVERIFIED',retriable:true,details:{ reason,...details },cause
  });
}

export function resolveBrowserLocale(config) {
  return String(config.browser?.locale || 'en-DE').trim() || 'en-DE';
}

export async function closeBrowserSession(session, config = {}) {
  if (!session) return;
  if (session.external || browserMode(config) === 'external_cdp') return;
  if (session.persistent) await session.context.close().catch(() => {});
  else if (session.browser) await session.browser.close().catch(() => {});
  if (session.launchedByUs && config.browser?.closeLaunchedBrowserOnExit === true && session.chromeProcess?.exitCode == null) {
    session.chromeProcess.kill();
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
