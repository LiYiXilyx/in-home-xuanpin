import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../shared/errors.mjs';

export function chromeCandidates(env = process.env) {
  return [
    path.join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(candidate => path.isAbsolute(candidate));
}

export async function findInstalledChrome(config, { access = fs.access, env = process.env } = {}) {
  const configured = String(config.browser?.executablePath ?? '').trim();
  const candidates = configured ? [path.resolve(configured)] : chromeCandidates(env);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new AppError(configured
    ? `browser.executablePath 不存在：${path.resolve(configured)}`
    : '未找到 Google Chrome。请在 config.json 的 browser.executablePath 中填写 chrome.exe 完整路径。', {
    code: 'CHROME_NOT_FOUND', retriable: false, details: { configured: Boolean(configured) }
  });
}
