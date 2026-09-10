// Executes synchronously inside the VMLogin Temu tab; no CDP connection or extension messages.
export function reviewPageStep(goodsId, action) {
  const visible=n=>n instanceof HTMLElement && n.getClientRects().length && getComputedStyle(n).visibility!=='hidden';
  const id=u=>{try{return new URL(u).searchParams.get('goods_id')||u.match(/-g-(\d+)\.html/i)?.[1];}catch{return null;}};
  if(location.hostname!=='www.temu.com'||id(location.href)!==goodsId)throw Error('商品页面已变化，请重新开始该商品');
  const body=document.body?.innerText||'';
  if(/security verification|verify (?:that )?you are human|access denied|too many requests|slide to complete|sign in to continue/i.test(body)||[...document.querySelectorAll('iframe')].some(n=>visible(n)&&/captcha|challenge/i.test(n.src+' '+n.title)))throw Error('需要人工完成验证或登录，已保存进度');
  if(/something went wrong|try again|currently unavailable|item is sold out/i.test(body))throw Error('商品页出现加载或可用性提示，请人工检查后继续');
  const controls=root=>[...root.querySelectorAll('button,a,[role="button"],span,div')].filter(visible).sort((a,b)=>a.innerText.length-b.innerText.length);
  const panel=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find(n=>visible(n)&&/item reviews|customer reviews|product reviews/i.test(n.innerText));
  if(!panel){
    if(action==='open'){
      const button=controls(document).find(n=>/^(?:see all|view all|all)\s+reviews?\b/i.test(n.innerText.trim()));
      if(button){button.scrollIntoView({block:'center'});button.click();return {phase:'OPENING'};}
    }
    return {phase:'MISSING',message:'未识别完整评论弹窗，请在 VMLogin 商品页点击 See all reviews 后重试'};
  }
  if(action.startsWith('filter:')){
    const rating=Number(action.split(':')[1]);if(![1,2].includes(rating))throw Error('无效星级筛选');
    const choice=controls(panel).find(n=>n.innerText.trim()===rating+' star');
    if(choice){choice.click();return {phase:'FILTER_APPLIED',rating};}
    const trigger=controls(panel).find(n=>n.innerText.trim()==='Rating filters');
    if(!trigger)throw Error('未找到星级筛选入口，已保留进度');
    (trigger.closest('[role="button"],button')||trigger).click();return {phase:'FILTER_MENU'};
  }
  const candidates=[...panel.querySelectorAll('[data-review-id],[data-testid*="review-item" i],[class*="review-item" i],[class*="reviewItem"]')];
  const dates=[...panel.querySelectorAll('time,div,span,p')].filter(n=>visible(n)&&/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/i.test(n.innerText));
  for(const date of dates){let n=date;for(let depth=0;n&&n!==panel&&depth<7;depth++,n=n.parentElement){const text=n.innerText||'';const ds=text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/ig)||[];if(ds.length>1)break;if(ds.length===1&&n.querySelector('[aria-label*="star" i],[aria-label*="out of 5" i],[data-rating]')){candidates.push(n);break;}}}
  const nodes=[...new Set(candidates)].filter(n=>visible(n)&&n.innerText.length<6000).filter(n=>!candidates.some(other=>other!==n&&n.contains(other)));
  const cards=nodes.map(n=>{
    const star=n.querySelector('[aria-label*="star" i],[aria-label*="out of 5" i],[data-rating]');
    const evidence=star?.getAttribute('aria-label')||star?.getAttribute('data-rating')||'';
    const rating=/^([1-5])$/.exec(evidence)?.[1]||/\b([1-5])(?:\.0)?\s*(?:out of (?:5|five)|stars?)\b/i.exec(evidence)?.[1];
    const date=n.querySelector('[role="text"][aria-label*=" on "],time,[class*="date" i],[data-testid*="date" i]');
    const dateLabel=date?.getAttribute('aria-label')||date?.getAttribute('datetime')||date?.innerText||n.innerText;
    const content=n.querySelector('[data-testid*="review-content" i],[class*="review-content" i],[class*="reviewContent"],section');
    const translated=[...n.querySelectorAll('div')].find(e=>e.children.length===0&&e.innerText.startsWith('Review before translation:'))?.innerText||null;
    return {reviewId:n.getAttribute('data-review-id'),ratingText:rating?rating+' out of 5 stars':'',ratingEvidence:evidence,dateText:dateLabel,
      contentText:content?.innerText?.trim()||'',originalText:translated?.replace(/^Review before translation:\s*/, '')||null,
      reviewer:n.querySelector('[role="link"]:not([aria-label="avatar"])')?.innerText||null,rawText:n.innerText,
      sku:[...n.querySelectorAll('div')].find(e=>e.children.length===0&&/^Purchased:/.test(e.innerText))?.innerText.replace(/^Purchased:\s*/,'')||null,
      country:/^in (.+?) on /.exec(dateLabel)?.[1]||null,imageUrls:[...n.querySelectorAll('img[alt="Reviews image"]')].map(i=>i.currentSrc||i.src).filter(Boolean)};
  });
  if(action==='advance'){
    const more=controls(panel).find(n=>/^(?:(?:load|see|show) more(?: reviews?)?|more reviews?)$/i.test(n.innerText.trim())&&!n.disabled&&n.getAttribute('aria-disabled')!=='true');
    if(more){more.click();return {phase:'ADVANCED'};}
    const boxes=[panel,...panel.querySelectorAll('*')].filter(n=>visible(n)&&n.scrollHeight>n.clientHeight+20&&n.clientHeight>100).sort((a,b)=>(/auto|scroll/.test(getComputedStyle(b).overflowY)?100000:0)+b.scrollHeight-b.clientHeight-((/auto|scroll/.test(getComputedStyle(a).overflowY)?100000:0)+a.scrollHeight-a.clientHeight));
    const box=boxes[0];if(box){const before=box.scrollTop;box.scrollTop=Math.min(box.scrollHeight-box.clientHeight,before+Math.max(100,box.clientHeight*.7));box.dispatchEvent(new Event('scroll',{bubbles:true}));return {phase:box.scrollTop>before+1?'ADVANCED':'END'};}
    return {phase:'END'};
  }
  return {phase:'READY',cards,url:location.href,empty:/no reviews yet|no reviews available/i.test(panel.innerText)};
}
