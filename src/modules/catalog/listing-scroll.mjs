import { AppError } from '../../shared/errors.mjs';
import { detectChallenge } from '../../browser/challenge-handler.mjs';
import { extractRawCards } from './card-extractor.mjs';
import { extractionQuality, normalizeProduct } from './product-normalizer.mjs';

export async function collectListingProducts(page, config, job, options = {}) {
  const targetCount = Number(options.targetCount ?? job.targetCount ?? config.catalog?.targetCount ?? config.targetCount);
  const catalog = config.catalog ?? config;
  const settings = catalog.capture ?? {};
  const maxStaleRounds = Number(settings.maxStaleRounds ?? config.browser?.maxStaleRounds ?? 6);
  const maxExpansions = Number(settings.maxExpansions ?? config.browser?.maxCatalogExpansions ?? 4);
  const minimumDelayMs = Number(settings.minimumDelayMs ?? config.browser?.minimumDelayMs ?? 1500);
  const maximumDelayMs = Number(settings.maximumDelayMs ?? config.browser?.maximumDelayMs ?? 3000);
  const found = new Map();
  let totalOccurrences = 0;
  let duplicateOccurrences = 0;
  let staleRounds = 0;
  let expansions = 0;
  let round = 0;

  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await delay(randomBetween(minimumDelayMs, maximumDelayMs));

  while (found.size < targetCount && staleRounds < maxStaleRounds) {
    round += 1;
    const challenge = await (options.detectChallenge ?? detectChallenge)(page);
    if (challenge) throw new AppError('滚动过程中出现登录、验证码或访问异常。', { code: challenge.code, retriable: true });
    const rawCards = await (options.extractCards ?? extractRawCards)(page, catalog.selectors ?? {});
    const before = found.size;
    for (const raw of rawCards) {
      totalOccurrences += 1;
      const product = normalizeProduct(raw, {
        siteCountry: catalog.siteCountry, language: catalog.language, currency: catalog.currency,
        primaryCategory: job.primaryCategory, subcategory: job.subcategory, sortOrder: job.sortOrder,
        capturedAt: options.capturedAt
      });
      if (!product) continue;
      if (found.has(product.goods_id)) {
        duplicateOccurrences += 1;
        mergeMissingFields(found.get(product.goods_id), product);
        continue;
      }
      product.listing_rank = found.size + 1;
      found.set(product.goods_id, product);
      if (found.size >= targetCount) break;
    }
    options.onRound?.({ round, discovered: found.size, discoveredGoodsIds: [...found.keys()], targetCount,
      staleRounds, expansions, totalOccurrences, lastEvent: 'listing_round_completed' });
    if (found.size >= targetCount) break;
    if (found.size === before && expansions < maxExpansions && await clickSeeMore(page)) {
      expansions += 1;
      staleRounds = 0;
      await delay(randomBetween(minimumDelayMs, maximumDelayMs));
      continue;
    }
    staleRounds = found.size === before ? staleRounds + 1 : 0;
    await page.mouse.wheel(0, randomBetween(1200, 2200));
    await delay(randomBetween(minimumDelayMs, maximumDelayMs));
  }
  if (found.size >= targetCount) {
    // Bring the last accepted identity into view so the final row's lazy images resolve.
    // This enriches only the first-seen target set and never adds later products.
    const lastGoodsId = [...found.keys()][targetCount - 1];
    const positioned = await page.evaluate(goodsId => {
      const anchor = [...document.querySelectorAll("a[href*='-g-'],a[href*='goods_id']")]
        .find(item => item.href.includes(`-g-${goodsId}.html`) || item.href.includes(`goods_id=${goodsId}`));
      anchor?.scrollIntoView({ block: 'center', behavior: 'instant' });
      return Boolean(anchor);
    }, lastGoodsId).catch(() => false);
    if (!positioned) await page.mouse.wheel(0, randomBetween(700, 1100));
    await delay(randomBetween(minimumDelayMs, maximumDelayMs));
    const finalCards = await (options.extractCards ?? extractRawCards)(page, catalog.selectors ?? {});
    for (const raw of finalCards) {
      const product = normalizeProduct(raw, {
        siteCountry: catalog.siteCountry, language: catalog.language, currency: catalog.currency,
        primaryCategory: job.primaryCategory, subcategory: job.subcategory, sortOrder: job.sortOrder,
        capturedAt: options.capturedAt
      });
      if (!product || !found.has(product.goods_id)) continue;
      totalOccurrences += 1;
      duplicateOccurrences += 1;
      mergeMissingFields(found.get(product.goods_id), product);
    }
  }
  return { products: [...found.values()].slice(0, targetCount), totalOccurrences, duplicateOccurrences,
    uniqueGoodsIds: found.size, staleRounds, expansions, rounds: round, targetCount };
}

async function clickSeeMore(page) {
  const candidate = page.getByRole('button', { name: /^See more(?: items| products)?$/i });
  const count = Math.min(await candidate.count().catch(() => 0), 8);
  for (let index = 0; index < count; index += 1) {
    const button = candidate.nth(index);
    if (!await button.isVisible().catch(() => false)) continue;
    if (await button.click({ timeout: 5_000 }).then(() => true).catch(() => false)) return true;
  }
  return false;
}
function randomBetween(minimum, maximum) {
  const low = Math.ceil(Math.min(minimum, maximum));
  const high = Math.floor(Math.max(minimum, maximum));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function mergeMissingFields(existing, incoming) {
  for (const field of ['title', 'image_url', 'price_amount', 'sales_count', 'rating', 'review_count']) {
    if ((existing[field] === null || existing[field] === '') && incoming[field] !== null && incoming[field] !== '') {
      existing[field] = incoming[field];
    }
  }
  existing.extraction_quality = extractionQuality(existing);
}
