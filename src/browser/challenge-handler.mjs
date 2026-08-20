import { AppError } from '../shared/errors.mjs';
import { waitForOperatorConfirmation } from './manual-gate.mjs';

const CHALLENGE_PATTERN = /captcha|verify you are human|security verification|slide to verify|验证码|安全验证/i;
const LOGIN_PATTERN = /sign in\s*\/\s*register|email or phone number|登录|注册/i;
const NETWORK_PATTERN = /network error|connection timed out|err_(?:connection|network)|网络异常|连接超时/i;
const RESTRICTED_PATTERN = /access denied|unusual traffic|temporarily restricted|too many requests|service unavailable in your region|访问受限/i;

export function classifyPageSignals({ url = '', text = '', frameUrls = [], loginFormVisible = false, loggedInEvidence = false }) {
  if (RESTRICTED_PATTERN.test(`${url} ${text}`)) return { code: 'ACCESS_RESTRICTED', retriable: true };
  if (NETWORK_PATTERN.test(`${url} ${text}`)) return { code: 'NETWORK_ERROR', retriable: true };
  const verification = CHALLENGE_PATTERN.test(text) || /\/(?:bgn_verification)\.html/i.test(url)
    || frameUrls.some(frameUrl => /\/bgn_verification\.html/i.test(frameUrl));
  const login = /\/login\.html/i.test(url) || (!loggedInEvidence && (loginFormVisible || LOGIN_PATTERN.test(text)));
  if (verification || login) return { code: 'CAPTCHA_OR_LOGIN', retriable: true, verification, login };
  return null;
}

export async function detectChallenge(page) {
  try {
    if (page.isClosed?.()) return { code: 'BROWSER_CLOSED', retriable: true };
    const text = await page.locator('body').innerText({ timeout: 8_000 }).catch(() => '');
    const loginFormVisible = await page.locator("input[type='password'], input[autocomplete='username'], input[autocomplete='current-password']")
      .first().isVisible().catch(() => false);
    return classifyPageSignals({
      url: page.url(), text, frameUrls: page.frames().map(frame => frame.url()), loginFormVisible,
      loggedInEvidence: /Orders\s*&\s*Account|Hello\s*[,，]/i.test(text)
    });
  } catch (error) {
    if (/Target page, context or browser has been closed/i.test(error?.message ?? '')) {
      return { code: 'BROWSER_CLOSED', retriable: true };
    }
    throw error;
  }
}

export async function handleChallenge(page, config, label) {
  let prompted = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const problem = await detectChallenge(page);
    if (!problem) return prompted;
    if (problem.code === 'NETWORK_ERROR' || problem.code === 'ACCESS_RESTRICTED' || problem.code === 'BROWSER_CLOSED') {
      throw challengeError(problem, label);
    }
    if (config.browser.headless) throw challengeError(problem, `${label}（headless 模式无法人工处理）`);
    await waitForOperatorConfirmation({
      config, label, reason: problem.code,
      message: `${label}需要登录或安全验证。请在独立采集 Chrome 中人工完成；程序不会绕过验证。`
    });
    prompted = true;
    await page.waitForTimeout(1_000);
  }
  throw new AppError(`${label}多次人工确认后仍停留在登录或安全验证页面。`, {
    code: 'CAPTCHA_OR_LOGIN', retriable: true
  });
}

function challengeError(problem, label) {
  const messages = {
    CAPTCHA_OR_LOGIN: `${label}需要登录或人工安全验证。`,
    NETWORK_ERROR: `${label}检测到网络异常。`, ACCESS_RESTRICTED: `${label}检测到访问限制。`,
    BROWSER_CLOSED: `${label}浏览器或页面已关闭。`
  };
  return new AppError(messages[problem.code] ?? `${label}页面状态异常。`, {
    code: problem.code, retriable: problem.retriable, details: { label }
  });
}
