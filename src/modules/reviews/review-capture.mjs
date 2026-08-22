import { detectChallenge } from '../../browser/challenge-handler.mjs';
import { AppError } from '../../shared/errors.mjs';
import { parseReviewCard,verifyProductIdentity } from './review-parser.mjs';

const DEFAULT_SELECTORS={
  reviewOpen:"button:has-text('See all reviews'), button:has-text('View all reviews'), button:has-text('All reviews')",
  reviewSort:"button:has-text('Most recent'), [role='button']:has-text('Most recent')",
  reviewCard:"[data-testid*='review-item'], [data-testid*='comment-item'], [class*='reviewItem'], [class*='review-item']",
  reviewDate:"time, [class*='date'], [data-testid*='date']",
  reviewText:"[data-testid*='review-content'], [class*='review-content'], [class*='reviewContent']",
  reviewRating:"[aria-label*='out of 5'], [aria-label*='star'], [class*='star']",
  reviewLoadMore:"button:has-text('Load more'), button:has-text('Show more')"
};

export async function captureRecentReviews(page,target,config,hooks={}) {
  const selectors={ ...DEFAULT_SELECTORS,...config.catalog?.selectors,...config.selectors };
  const cutoffDate=target.cutoffDate;
  const maxPages=Math.max(1,Number(config.reviews?.maxPagesPerProduct ?? 200));
  await safeGoto(page,target.productUrl);
  await assertPageReady(page,target);
  const canonicalUrl=await page.locator("link[rel='canonical']").first().getAttribute('href').catch(() => null);
  const identity=verifyProductIdentity({ expectedGoodsId:target.goodsId,currentUrl:page.url(),canonicalUrl });
  if (!identity.valid) throw reviewError('GOODS_ID_MISMATCH','详情页 goods_id 与目标商品不一致。',false,identity);

  const section=await revealAndSortRecent(page,selectors,target);
  if (section.noReview) return finalResult('no_review','no_review','NO_MORE_REVIEWS',0,0,[],{});
  if (!section.found) throw reviewError('REVIEW_SECTION_MISSING','未找到商品评论区域。',true);
  if (!section.sorted) throw reviewError('PAGE_CHANGED','无法确认评论已切换为 Most recent。',true);

  const collected=new Map();let pagesScanned=0,staleRounds=0,parseErrorCount=0;
  let newest=null,oldest=null,lastSignature='';
  for (let pageIndex=1;pageIndex<=maxPages;pageIndex+=1) {
    await assertPageReady(page,target);
    const cards=await extractReviewCards(page,selectors);
    pagesScanned=pageIndex;let insertedThisPage=0;
    for (const card of cards) {
      const parsed=parseReviewCard(card,{ productId:target.productId,goodsId:target.goodsId,sourceUrl:target.productUrl,now:target.runDate,capturedAt:hooks.now?.() ?? new Date().toISOString() });
      if (!parsed.valid) { parseErrorCount+=1;continue; }
      const review=parsed.review;
      if (!oldest || review.reviewDate < oldest) oldest=review.reviewDate;
      if (!newest || review.reviewDate > newest) newest=review.reviewDate;
      if (review.reviewDate < cutoffDate || collected.has(review.dedupeKey)) continue;
      collected.set(review.dedupeKey,review);insertedThisPage+=1;
    }
    const pageReviews=[...collected.values()];
    if (insertedThisPage && hooks.onReviews) await hooks.onReviews(pageReviews.slice(-insertedThisPage));
    const checkpoint={ pageIndex,cutoffDate,reviewsCaptured:collected.size,newestCapturedReviewDate:newest,oldestCapturedReviewDate:oldest,
      lastReviewKey:[...collected.keys()].at(-1) ?? null,parseErrorCount };
    if (hooks.onCheckpoint) await hooks.onCheckpoint(checkpoint);
    if (oldest && oldest < cutoffDate) {
      return parseErrorCount ? finalResult('completed_partial','partial','PAGE_CHANGED',collected.size,pagesScanned,[newest,oldest],checkpoint,{ parseErrorCount })
        : finalResult('completed','complete','CUTOFF_REACHED',collected.size,pagesScanned,[newest,oldest],checkpoint);
    }
    const signature=cards.map(card => `${card.reviewId}|${card.dateText}|${card.ratingText}`).join('||');
    staleRounds=signature && signature === lastSignature ? staleRounds+1:0;lastSignature=signature;
    const advanced=await advanceReviews(page,selectors);
    if (!advanced) {
      if (!cards.length && !collected.size) return target.reviewCount === 0 || section.noReview
        ? finalResult('no_review','no_review','NO_MORE_REVIEWS',0,pagesScanned,[],checkpoint)
        : finalResult('failed','failed','REVIEW_SECTION_MISSING',0,pagesScanned,[],checkpoint);
      return parseErrorCount ? finalResult('completed_partial','partial','PAGE_CHANGED',collected.size,pagesScanned,[newest,oldest],checkpoint,{ parseErrorCount })
        : finalResult('completed','complete','NO_MORE_REVIEWS',collected.size,pagesScanned,[newest,oldest],checkpoint);
    }
    if (staleRounds >= 3) return finalResult('completed_partial','partial','PAGE_CHANGED',collected.size,pagesScanned,[newest,oldest],checkpoint,{ staleRounds });
    await page.waitForTimeout(randomDelay(config));
  }
  return finalResult('completed_partial','partial','PAGE_LIMIT_SAFETY',collected.size,pagesScanned,[newest,oldest],{ cutoffDate,pagesScanned });
}

async function safeGoto(page,url) {
  try { await page.goto(url,{ waitUntil:'domcontentloaded',timeout:60_000 }); }
  catch (error) {
    if (isClosed(error,page)) throw reviewError('BROWSER_CLOSED','浏览器或页面已关闭。',true);
    throw reviewError('NETWORK_ERROR',`商品详情页打开失败：${error.message}`,true);
  }
}

async function assertPageReady(page,target) {
  const problem=await detectChallenge(page);
  if (problem?.code === 'CAPTCHA_OR_LOGIN') throw reviewError(problem.login ? 'LOGIN_REQUIRED':'CAPTCHA','页面需要人工登录或验证码。',true,problem);
  if (problem?.code === 'BROWSER_CLOSED') throw reviewError('BROWSER_CLOSED','浏览器或页面已关闭。',true);
  if (problem?.code === 'NETWORK_ERROR' || problem?.code === 'ACCESS_RESTRICTED') throw reviewError('NETWORK_ERROR','详情页出现网络或访问限制。',true,problem);
  const body=await page.locator('body').innerText({ timeout:10_000 }).catch(error => { if (isClosed(error,page)) throw reviewError('BROWSER_CLOSED','浏览器或页面已关闭。',true);return ''; });
  if (/items? (?:are|is) gone|item is sold out|currently unavailable|商品不存在|商品已下架|商品已售罄/i.test(body)) throw reviewError('PRODUCT_NOT_FOUND','商品不存在、已下架或不可用。',false,{ goodsId:target.goodsId });
}

async function revealAndSortRecent(page,selectors,target) {
  const body=await page.locator('body').innerText().catch(() => '');
  if (/\b0\s+(?:reviews?|ratings?)\b|no reviews yet|暂无评论/i.test(body) || target.reviewCount === 0) return { found:true,sorted:true,noReview:true };
  const heading=page.getByText(/^(?:Customer reviews|Reviews|Product reviews)/i).last();
  const headingVisible=await heading.isVisible().catch(() => false);
  if (headingVisible) await heading.scrollIntoViewIfNeeded().catch(() => {});
  await clickFirstVisible(page.locator(selectors.reviewOpen));
  await page.waitForTimeout(700);
  let sorted=await isMostRecentSelected(page);
  if (!sorted) {
    for (const trigger of [page.locator("button:has-text('Recommended')"),page.locator("[role='button']:has-text('Recommended')"),page.locator("button:has-text('Sort by')")]) {
      if (await clickFirstVisible(trigger)) break;
    }
    await page.waitForTimeout(300);
    await clickFirstVisible(page.locator(selectors.reviewSort));
    await page.waitForTimeout(700);sorted=await isMostRecentSelected(page);
  }
  const cards=await page.locator(selectors.reviewCard).count().catch(() => 0);
  const currentBody=await page.locator('body').innerText().catch(() => '');
  const found=headingVisible || cards > 0 || /All reviews are from verified purchases|Most recent|Helpful/i.test(currentBody);
  return { found,sorted,noReview:false };
}

async function isMostRecentSelected(page) {
  const selected=page.locator("[aria-selected='true']:has-text('Most recent'),[aria-checked='true']:has-text('Most recent'),button:has-text('Sort by: Most recent'),[role='button']:has-text('Sort by: Most recent')");
  if (await selected.first().isVisible().catch(() => false)) return true;
  return /Sort by:\s*Most recent/i.test(await page.locator('body').innerText().catch(() => ''));
}

async function extractReviewCards(page,selectors) {
  return page.locator(selectors.reviewCard).evaluateAll((elements,s) => elements.map(element => {
    const rawText=(element.innerText || '').trim();
    const regionLabel=[...element.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label') || '').find(value => /\bin\s+.+\s+on\s+/i.test(value)) || '';
    const ratingNode=element.querySelector(s.reviewRating);const dateNode=element.querySelector(s.reviewDate);const textNode=element.querySelector(s.reviewText);
    return { reviewId:element.getAttribute('data-review-id') || element.getAttribute('data-comment-id') || element.id || null,
      dateText:dateNode?.getAttribute('datetime') || dateNode?.textContent || regionLabel || '',
      ratingText:ratingNode?.getAttribute('aria-label') || ratingNode?.textContent || '',contentText:textNode?.textContent || rawText,
      sku:rawText.match(/Purchased:\s*([^\n]+)/i)?.[1]?.trim() || '',country:regionLabel.match(/\bin\s+(.+?)\s+on\s+/i)?.[1]?.trim() || '',
      imageUrls:[...element.querySelectorAll('img[src]')].map(node => node.src).filter(src => !/avatar/i.test(src)),rawText };
  }),selectors).catch(error => { throw isClosed(error,page) ? reviewError('BROWSER_CLOSED','浏览器或页面已关闭。',true):error; });
}

async function advanceReviews(page,selectors) {
  if (await clickFirstVisible(page.locator(selectors.reviewLoadMore))) return true;
  return page.evaluate(() => {
    const candidates=[...document.querySelectorAll('*')].filter(element => { const style=getComputedStyle(element);return element.scrollHeight>element.clientHeight+100 && /^(auto|scroll)$/.test(style.overflowY) && /Most recent|Helpful|verified purchases/i.test((element.innerText || '').slice(0,3000)); });
    const target=candidates.sort((a,b) => a.clientHeight-b.clientHeight)[0];if (!target) return false;
    const before=target.scrollTop;target.scrollTop=Math.min(target.scrollHeight,before+Math.max(400,target.clientHeight*.85));target.dispatchEvent(new Event('scroll',{ bubbles:true }));return target.scrollTop>before;
  }).catch(() => false);
}
async function clickFirstVisible(locator) { const count=Math.min(await locator.count().catch(() => 0),10);for (let index=0;index<count;index+=1) { const item=locator.nth(index);if (await item.isVisible().catch(() => false)) { await item.click().catch(() => {});return true; } }return false; }
function finalResult(taskStatus,crawlCompleteness,stopReason,reviewsCaptured,pagesScanned,dates=[],checkpoint={},extra={}) { return { taskStatus,crawlCompleteness,stopReason,reviewsCaptured,pagesScanned,newestCapturedReviewDate:dates[0] ?? null,oldestCapturedReviewDate:dates[1] ?? null,checkpoint,...extra }; }
function reviewError(code,message,retriable,details={}) { return new AppError(message,{ code,retriable,details }); }
function isClosed(error,page) { return page?.isClosed?.() || /Target page, context or browser has been closed|browser has been closed/i.test(error?.message ?? ''); }
function randomDelay(config) { const min=Number(config.browser?.minimumDelayMs ?? 1500),max=Math.max(min,Number(config.browser?.maximumDelayMs ?? 3000));return Math.round(min+Math.random()*(max-min)); }
