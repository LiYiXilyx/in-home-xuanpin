import { openBrowserSession, closeBrowserSession } from '../../browser/cdp-session.mjs';
import { findCurrentOperatorTemuPage } from '../../browser/operator-page.mjs';
import { detectChallenge } from '../../browser/challenge-handler.mjs';

export async function runBrowserOpenCommand(config, { smoke = false } = {}) {
  const session = await openBrowserSession(config);
  try {
    const page = await findCurrentOperatorTemuPage(session.context);
    const challenge = page ? await detectChallenge(page) : null;
    const result = {
      connected: true,
      endpoint: session.endpoint ?? null,
      temuPageFound: Boolean(page),
      pageUrl: page ? sanitizeUrl(page.url()) : null,
      pageState: challenge?.code ?? (page ? 'READY' : 'NO_TEMU_PAGE'),
      smokeOnly: smoke
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await closeBrowserSession(session, config);
  }
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
