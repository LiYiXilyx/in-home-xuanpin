import { openBrowserSession, closeBrowserSession } from '../../browser/cdp-session.mjs';
import { findCurrentOperatorTemuPage } from '../../browser/operator-page.mjs';
import { inspectCurrentPageHealth } from '../../modules/catalog/page-health.mjs';
import { validateListingDetailAvailability } from '../../jobs/review-job-runner.mjs';

export async function runBrowserOpenCommand(config, { smoke = false } = {},{
  openSession=openBrowserSession,closeSession=closeBrowserSession,findPage=findCurrentOperatorTemuPage,
  inspectPage=inspectCurrentPageHealth,inspectDetailAvailability=validateListingDetailAvailability
}={}) {
  const session = await openSession(config);
  try {
    const page = await findPage(session.context);
    const listingHealth = page ? await inspectPage(page,config,config.catalog.jobs?.[0]) : null;
    const health = listingHealth?.status === 'READY'
      ? await inspectDetailAvailability(page,session.context,config,listingHealth):listingHealth;
    const result = {
      connected: true,
      endpoint: session.endpoint ?? null,
      temuPageFound: Boolean(page),
      pageUrl: page ? sanitizeUrl(page.url()) : null,
      status:health?.status ?? 'NOT_READY',
      pageState: health?.code ?? 'NO_TEMU_PAGE',
      checks:health?.checks ?? { CDP_CONNECTED:true,TEMU_PAGE:false,PAGE_HEALTH:'NO_TEMU_PAGE' },
      productLinkCount:health?.productLinkCount ?? 0,
      smokeOnly: smoke
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await closeSession(session, config);
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
