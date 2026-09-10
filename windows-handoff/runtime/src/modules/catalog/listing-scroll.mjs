import { AppError } from '../../shared/errors.mjs';
import { detectChallenge } from '../../browser/challenge-handler.mjs';
import { extractRawCards } from './card-extractor.mjs';
import { extractionQuality, normalizeProduct } from './product-normalizer.mjs';

export async function collectListingProducts(page, config, job, options = {}) {
  const targetCount = Number(options.targetCount ?? job.targetCount ?? config.catalog?.targetCount ?? config.targetCount);
  const catalog = config.catalog ?? config;
  const settings = catalog.capture ?? {};
  const minimumDelayMs = Number(settings.minimumDelayMs ?? config.browser?.minimumDelayMs ?? 1500);
  const maximumDelayMs = Number(settings.maximumDelayMs ?? config.browser?.maximumDelayMs ?? 3000);
  const maxProbeRounds = Number(settings.maxProbeRounds ?? Math.max(200, Math.ceil(targetCount / 10) * 8));
  const found = new Map();
  let totalOccurrences = 0;
  let duplicateOccurrences = 0;
  let staleRounds = 0;
  let expansions = 0;
  let round = 0;
  let finalProbe = null;

  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await delay(randomBetween(minimumDelayMs, maximumDelayMs));

  while (found.size < targetCount) {
    round += 1;
    if (round > maxProbeRounds) {
      throw new AppError('页面持续变化但未达到安全结束条件，请检查 Temu 页面后重试。', {
        code: 'LISTING_SCROLL_LIMIT_REACHED', retriable: true,
        details: { round: round - 1, discovered: found.size, targetCount }
      });
    }
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
    staleRounds = found.size === before ? staleRounds + 1 : 0;

    const scrollState = await readScrollState(page);
    if (scrollState.nearBottom) {
      const loadMore = await (options.activateLoadMore ?? activateLoadMore)(page, {
        minimumDelayMs, maximumDelayMs,
        onEvent: event => options.onLoadMore?.({ ...event, round, discovered: found.size })
      });
      if (loadMore.status === 'completed') {
        expansions += 1;
        finalProbe = null;
        continue;
      }
      if (loadMore.status === 'failed') {
        throw new AppError('自动加载没有产生新商品。请在采集 Chrome 底部人工点击 Try again，看到新商品出现后回运营台点击“继续”。', {
          code: 'LOAD_MORE_MANUAL_REQUIRED', retriable: true,
          details: { reason: loadMore.errorCode ?? 'LOAD_MORE_CLICK_FAILED',label: loadMore.label }
        });
      }

      const stableHeight = finalProbe && scrollState.scrollHeight === finalProbe.scrollHeight;
      const noNewProducts = found.size === before;
      if (stableHeight && noNewProducts) break;
      finalProbe = { scrollHeight: scrollState.scrollHeight, discovered: found.size, round };
      await scrollToTrueBottom(page);
      await delay(randomBetween(minimumDelayMs, maximumDelayMs));
      continue;
    }

    finalProbe = null;
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

export async function activateLoadMore(page, options = {}) {
  const readState = options.readListingState ?? readListingDomState;
  const before = await readState(page);
  if (!isHealthyListingState(before)) return { status: 'none', label: null, blocked: true };
  const pattern = /^(?:Try again|Try more|Load more|See more|Show more)(?: items| products)?$/i;
  const groups = [
    page.getByRole?.('button', { name: pattern }),
    page.locator?.('button, [role="button"], a').filter?.({ hasText: pattern })
  ].filter(Boolean);
  for (const group of groups) {
    const count = Math.min(await group.count().catch(() => 0), 12);
    for (let index = 0; index < count; index += 1) {
      const button = group.nth(index);
      if (!await button.isVisible().catch(() => false)) continue;
      if (!await button.isEnabled().catch(() => true)) continue;
      const label = String(await button.innerText().catch(() => 'load more')).trim();
      options.onEvent?.({ eventType: 'load_more_detected', status: 'detected', label });
      try {
        await button.scrollIntoViewIfNeeded({ timeout: 5_000 });
        await button.click({ timeout: 8_000 });
        options.onEvent?.({ eventType: 'load_more_clicked', status: 'clicked', label });
        await page.waitForLoadState?.('networkidle', { timeout: 8_000 }).catch(() => {});
        const progress = await waitForListingProgress(page,before,{
          readState,timeoutMs:options.progressTimeoutMs ?? 12_000,pollMs:options.progressPollMs ?? 500
        });
        if (!progress) {
          options.onEvent?.({ eventType: 'load_more_failed', status: 'failed', label,
            errorCode: 'LOAD_MORE_NO_PROGRESS' });
          return { status: 'failed', label, errorCode: 'LOAD_MORE_NO_PROGRESS' };
        }
        await delay(randomBetween(options.minimumDelayMs ?? 1500, options.maximumDelayMs ?? 3000));
        options.onEvent?.({ eventType: 'load_more_completed', status: 'completed', label,
          beforeCount: before.productLinkCount,afterCount: progress.productLinkCount });
        return { status: 'completed', label, progress };
      } catch (error) {
        options.onEvent?.({ eventType: 'load_more_failed', status: 'failed', label,
          errorCode: error?.code ?? error?.name ?? 'LOAD_MORE_CLICK_FAILED' });
        return { status: 'failed', label };
      }
    }
  }
  return { status: 'none', label: null };
}

export async function hasHealthyListingContext(page) {
  return isHealthyListingState(await readListingDomState(page));
}

async function readListingDomState(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const goodsIds = [...new Set([...document.querySelectorAll("a[href*='-g-'],a[href*='goods_id']")]
      .map(anchor => anchor.href.match(/-g-(\d+)\.html|[?&]goods_id=(\d+)/)?.slice(1).find(Boolean))
      .filter(Boolean))];
    const blocked = /Oops!\s*The items are gone|Try again to find items|No results for|Please check your network connection and try again/i.test(text);
    const root = document.scrollingElement || document.documentElement;
    return { productLinkCount: goodsIds.length,goodsIds,blocked,scrollHeight:root.scrollHeight };
  }).catch(() => null);
}

function isHealthyListingState(state) {
  return Boolean(state && state.productLinkCount > 0 && !state.blocked);
}

async function waitForListingProgress(page,before,{ readState,timeoutMs,pollMs }) {
  const known = new Set(before.goodsIds ?? []);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await readState(page);
    if (current && !current.blocked && (current.scrollHeight > before.scrollHeight
      || (current.goodsIds ?? []).some(goodsId => !known.has(goodsId)))) return current;
    await delay(pollMs);
  }
  return null;
}

async function readScrollState(page) {
  const state = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const scrollTop = Math.max(root.scrollTop, window.scrollY || 0);
    const clientHeight = Math.max(root.clientHeight, window.innerHeight || 0);
    const scrollHeight = root.scrollHeight;
    return { scrollTop, clientHeight, scrollHeight,
      nearBottom: scrollTop + clientHeight >= scrollHeight - Math.max(120, clientHeight * 0.08) };
  }).catch(() => null);
  return state && Number.isFinite(state.scrollHeight)
    ? state
    : { scrollTop: 0, clientHeight: 0, scrollHeight: 0, nearBottom: false };
}

async function scrollToTrueBottom(page) {
  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    root.scrollTop = root.scrollHeight;
    window.scrollTo(0, root.scrollHeight);
  }).catch(() => {});
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
