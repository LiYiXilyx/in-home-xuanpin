'use strict';

(() => {
  const DATE_PATTERN=/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b/i;
  const REVIEW_OPEN_PATTERN=/^(?:see all|view all|all)\s+reviews?\b/i;
  const LOAD_MORE_PATTERN=/^(?:(?:load|see|show)\s+more(?:\s+reviews?)?|more\s+reviews?)$/i;
  const SECURITY_VERIFICATION_PATTERN=/\bsecurity verification\b|slide to complete the puzzle|complete the security check|verify (?:that )?you are human/i;
  const MANUAL_VERIFICATION_TIMEOUT_MS=150_000;

  async function loadReviews({ onStatus=() => {},onBatch,cutoffDate,startPageIndex=1,maxRounds=60,maxIdleRounds=3 }={}) {
    if (typeof onBatch !== 'function') throw new Error('评论批次处理器不可用。');
    let panel=await ensureReviewPanel(onStatus);await ensureMostRecent(panel,onStatus);panel=findReviewPanel() ?? panel;await resetReviewScroll(panel);const seen=new Set();let pageIndex=Math.max(1,Number(startPageIndex) || 1);let idleRounds=0;
    const totals={ received:0,inserted:0,deduplicated:0,valid:0,invalid:0,pagesLoaded:0,cutoffReached:false,stopReason:null };
    for (let round=1;round<=maxRounds;round+=1) {
      panel=findReviewPanel() ?? panel;
      const cards=collectReviewCards(panel).filter(card => { const key=stableCardKey(card);if (seen.has(key)) return false;seen.add(key);return true; });
      if (cards.length) {
        onStatus(`正在保存第 ${pageIndex} 批评论（${cards.length} 条）…`);const result=await onBatch(cards,pageIndex);pageIndex+=1;idleRounds=0;totals.pagesLoaded+=1;
        for (const field of ['received','inserted','deduplicated','valid','invalid']) totals[field]+=Number(result?.[field] ?? 0);
        if (result?.cutoffReached) { totals.cutoffReached=true;totals.stopReason='CUTOFF_REACHED';break; }
      }
      const loadMore=findLoadMoreControl(panel);
      if (loadMore) { onStatus('正在点击 Load more…');await clickAndWait(loadMore);continue; }
      const moved=await scrollReviewPanel(panel);
      if (moved) { onStatus('正在滚动加载更多评论…');await wait(900);continue; }
      idleRounds+=1;if (idleRounds>=maxIdleRounds) { totals.stopReason='NO_MORE_REVIEWS';break; }await wait(500);
    }
    totals.stopReason ??= 'MAX_ROUNDS_REACHED';totals.lastPageIndex=pageIndex-1;return totals;
  }

  async function ensureReviewPanel(onStatus) {
    await waitForSecurityVerification(onStatus);
    let existing=findReviewPanel();if (existing) return existing;
    if (hasGuidelineDialog()) {
      onStatus('请点击规则说明中的 OK，然后手动点击页面的 See all reviews；采集会自动继续…');
      await waitForGuidelineClose();
      return waitForOperatorReviewPanel(onStatus);
    }
    let control=findReviewOpenControl();
    if (control) {
      onStatus('正在打开 See all reviews…');await clickAndWait(control);
      await waitForSecurityVerification(onStatus);
      if (hasGuidelineDialog()) {
        onStatus('请点击规则说明中的 OK，然后手动点击页面的 See all reviews；采集会自动继续…');
        await waitForGuidelineClose();
        return waitForOperatorReviewPanel(onStatus);
      }
      existing=await waitForReviewPanel();if (existing) return existing;
      if (await waitForSecurityVerification(onStatus)) return ensureReviewPanel(onStatus);
      onStatus('请手动点击页面的 See all reviews；完整评论出现后采集会自动继续…');
      return waitForOperatorReviewPanel(onStatus);
    }
    if (await waitForSecurityVerification(onStatus)) return ensureReviewPanel(onStatus);
    throw new Error('未找到完整评论区域。请确认当前页面已显示评论后重试。');
  }
  function findReviewPanel() {
    const dialog=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find(node => isVisible(node) && /\bitem reviews\b|\bcustomer reviews\b/i.test(node.innerText));
    return dialog ?? null;
  }
  function findReviewOpenControl() { return findTextControl(document,REVIEW_OPEN_PATTERN); }
  async function ensureMostRecent(panel,onStatus) {
    const control=findTextControl(panel,/^most recent$/i) ?? findTextControl(document,/^most recent$/i);
    if (!control) throw new Error('完整评论区域中未找到 Most recent，无法可靠判断最近 30 天评论。');
    onStatus('正在切换为 Most recent 排序…');await clickAndWait(control);await wait(700);
  }
  function findLoadMoreControl(panel) { const control=findTextControl(panel,LOAD_MORE_PATTERN);return control && !control.hasAttribute('disabled') ? control:null; }
  function collectReviewCards(panel) {
    const selectors=['[data-testid*="review" i]','[data-review-id]','[class*="review-item" i]','[class*="comment-item" i]'];const selectorNodes=selectors.flatMap(selector => [...panel.querySelectorAll(selector)]);
    const dateNodes=[...panel.querySelectorAll('div,li,article,span,p')].filter(node => isVisible(node) && DATE_PATTERN.test(node.innerText));
    const nodes=[...new Set([...selectorNodes,...dateNodes.map(node => reviewContainerForDate(node,panel)).filter(Boolean)])].filter(node => isVisible(node) && node.innerText.trim().length>=5).filter(node => !hasSelectorAncestor(node,selectors)).slice(0,200);
    return nodes.map(cardFromNode).filter(card => DATE_PATTERN.test(card.dateText || card.rawText) && /[1-5](?:\.0)?\s+out\s+of\s+5/i.test(card.ratingText));
  }
  function cardFromNode(node) {
    const rawText=node.innerText.trim().slice(0,5000);const ratingNode=node.querySelector('[aria-label*="star" i],[aria-label*="out of 5" i],[data-rating],[class*="star" i]');const contentNode=node.querySelector('[data-testid*="content" i],[class*="content" i],[class*="text" i]');const dateNode=node.querySelector('time,[data-testid*="date" i],[class*="date" i]');
    return { reviewId:node.getAttribute('data-review-id') || node.id || null,ratingText:inferRatingText(ratingNode,rawText),contentText:contentNode?.textContent?.trim() || rawText,dateText:dateNode?.getAttribute('datetime') || dateNode?.textContent?.trim() || rawText,sku:node.querySelector('[class*="sku" i],[class*="variant" i]')?.textContent?.trim() || null,country:node.querySelector('[class*="country" i]')?.textContent?.trim() || null,imageUrls:[...node.querySelectorAll('img[src]')].map(image => image.currentSrc || image.src).filter(Boolean).slice(0,20),rawText };
  }
  function reviewContainerForDate(node,panel) { let current=node;for (let depth=0;current && depth<8;depth+=1,current=current.parentElement) { const text=current.innerText?.trim() ?? '';const matches=text.match(new RegExp(DATE_PATTERN.source,'ig')) ?? [];if (matches.length>1) break;const stars=(text.match(/★/g) ?? []).length;const ratingNode=current.querySelector?.('[aria-label*="star" i],[aria-label*="out of 5" i],[data-rating],[class*="star" i]');if (matches.length===1 && (ratingNode || (stars>=1 && stars<=5)) && text.length>=20 && text.length<=2500) return current;if (current===panel) break; }return null; }
  async function scrollReviewPanel(panel) {
    const containers=[panel,...panel.querySelectorAll('*')].filter(node => node instanceof HTMLElement && isVisible(node) && node.scrollHeight>node.clientHeight+24)
      .sort((left,right) => scrollScore(right)-scrollScore(left));
    for (const container of containers) {
      if (container === document.body || container === document.documentElement) continue;
      const before=container.scrollTop;const beforeHeight=container.scrollHeight;const beforeSignature=reviewSignature(panel);const maximum=Math.max(0,beforeHeight-container.clientHeight);const next=Math.min(maximum,before+Math.max(220,Math.floor(container.clientHeight*.8)));
      if (next<=before+1) {
        container.scrollTop=Math.max(0,maximum-80);container.dispatchEvent(new Event('scroll',{ bubbles:true }));await wait(120);
        container.scrollTop=maximum;container.dispatchEvent(new Event('scroll',{ bubbles:true }));container.dispatchEvent(new WheelEvent('wheel',{ bubbles:true,deltaY:700 }));await wait(1400);
        if (container.scrollHeight>beforeHeight || reviewSignature(panel)!==beforeSignature) return true;
        continue;
      }
      container.scrollTop=next;container.dispatchEvent(new Event('scroll',{ bubbles:true }));await wait(350);
      if (container.scrollTop>before+1) return true;
    }
    if (panel === document.body || panel === document.documentElement) { const before=window.scrollY;window.scrollBy({ top:Math.max(320,Math.floor(window.innerHeight*.75)),behavior:'smooth' });await wait(450);return window.scrollY>before; }
    return false;
  }
  async function resetReviewScroll(panel) {
    const containers=[panel,...panel.querySelectorAll('*')].filter(node => node instanceof HTMLElement && isVisible(node) && node.scrollHeight>node.clientHeight+24).sort((left,right) => scrollScore(right)-scrollScore(left));
    for (const container of containers.slice(0,3)) { if (container !== document.body && container !== document.documentElement) { container.scrollTop=0;container.dispatchEvent(new Event('scroll',{ bubbles:true })); } }
    await wait(500);
  }
  function scrollScore(node) { const overflow=getComputedStyle(node).overflowY;return (/auto|scroll/i.test(overflow) ? 100000:0)+reviewDateCount(node)*1000+(node.scrollHeight-node.clientHeight); }
  function reviewSignature(node) { return (node.innerText.match(new RegExp(DATE_PATTERN.source,'ig')) ?? []).slice(-6).join('|'); }
  function reviewDateCount(node) { return (node.innerText.match(new RegExp(DATE_PATTERN.source,'ig')) ?? []).length; }
  function findTextControl(root,pattern) {
    const candidates=[...root.querySelectorAll('button,[role="button"],a,div,span')]
      .filter(node => isVisible(node) && pattern.test(node.innerText.trim()))
      .sort((left,right) => left.innerText.trim().length-right.innerText.trim().length || left.childElementCount-right.childElementCount);
    const leaf=candidates[0];
    return leaf?.closest('button,[role="button"],a') || leaf || null;
  }
  function isVisible(node) { if (!(node instanceof HTMLElement) || node.getClientRects().length===0) return false;const style=getComputedStyle(node);return style.display!=='none' && style.visibility!=='hidden'; }
  function hasSelectorAncestor(node,selectors) { return selectors.some(selector => node.parentElement?.closest(selector)); }
  function stableCardKey(card) { return String(card.reviewId || `${card.dateText}|${card.ratingText}|${card.contentText}`).normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase(); }
  function inferRatingText(ratingNode,rawText) { const explicit=ratingNode?.getAttribute('aria-label') || ratingNode?.getAttribute('data-rating') || ratingNode?.textContent;const explicitNumber=String(explicit ?? '').match(/(?:^|\D)([1-5](?:\.0)?)(?:\D|$)/)?.[1];if (explicitNumber) return `${Number(explicitNumber)} out of 5 stars`;const stars=(String(rawText).match(/★/g) ?? []).length;if (stars>=1 && stars<=5) return `${stars} out of 5 stars`;const named=String(rawText).match(/\b(excellent|good|average|poor|bad)\b/i)?.[1]?.toLowerCase();const values={ excellent:5,good:4,average:3,poor:2,bad:1 };return named ? `${values[named]} out of 5 stars`:rawText; }
  function hasGuidelineDialog() { return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some(node => isVisible(node) && /all reviews are from customers who have purchased this item from temu/i.test(node.innerText)); }
  async function waitForGuidelineClose(timeoutMs=90_000) {
    const started=Date.now();
    while (hasGuidelineDialog()) {
      if (Date.now()-started>=timeoutMs) throw new Error('等待人工关闭 Temu 评价规则说明超时，请重新点击采集。');
      await wait(300);
    }
    await wait(350);
  }
  async function waitForOperatorReviewPanel(onStatus,timeoutMs=90_000) {
    const started=Date.now();let panel=findReviewPanel();
    while (!panel) {
      if (Date.now()-started>=timeoutMs) throw new Error('等待人工打开完整评论超时，请重新点击采集。');
      if (hasSecurityVerification()) await waitForSecurityVerification(onStatus,Math.max(1,timeoutMs-(Date.now()-started)));
      else if (hasGuidelineDialog()) onStatus('请点击规则说明中的 OK，然后再手动点击 See all reviews…');
      else onStatus('等待你手动点击 See all reviews…');
      await wait(300);panel=findReviewPanel();
    }
    return panel;
  }
  function hasSecurityVerification() {
    const bodyText=String(document.body?.innerText ?? '');
    if (SECURITY_VERIFICATION_PATTERN.test(bodyText)) return true;
    return [...document.querySelectorAll('iframe')].some(frame => {
      const signature=`${frame.title ?? ''} ${frame.name ?? ''} ${frame.src ?? ''}`;
      return /captcha|security[-_ ]?verification|challenge/i.test(signature) && isVisible(frame);
    });
  }
  async function waitForSecurityVerification(onStatus,timeoutMs=MANUAL_VERIFICATION_TIMEOUT_MS) {
    if (!hasSecurityVerification()) return false;
    const started=Date.now();
    onStatus('检测到 Temu 安全验证，请人工完成滑块；验证通过后采集会自动继续…');
    while (hasSecurityVerification()) {
      if (Date.now()-started>=timeoutMs) {
        const error=new Error('等待人工完成 Temu 安全验证超时。请完成验证后重新点击采集，当前任务会保留。');
        error.code='MANUAL_VERIFICATION_REQUIRED';error.recoverable=true;throw error;
      }
      await wait(500);
    }
    onStatus('安全验证已通过，正在继续评论采集…');await wait(750);return true;
  }
  async function waitForReviewPanel(timeoutMs=8_000) {
    const started=Date.now();let panel=findReviewPanel();
    while (!panel && Date.now()-started<timeoutMs) { await wait(250);panel=findReviewPanel(); }
    return panel;
  }
  async function clickAndWait(control) { control.scrollIntoView({ block:'center',behavior:'smooth' });await wait(250);control.click();await wait(1000); }
  function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve,milliseconds)); }
  globalThis.TemuReviewLoader=Object.freeze({ loadReviews,collectReviewCards,findReviewOpenControl,findLoadMoreControl,scrollReviewPanel,hasSecurityVerification,waitForSecurityVerification });
})();
