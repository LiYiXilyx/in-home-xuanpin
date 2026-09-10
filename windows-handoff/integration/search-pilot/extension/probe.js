function readPriceEvidence(text){
 const num='(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?';
 const price='(?:(?:€|EUR)\\s*('+num+')|('+num+')\\s*(?:€|EUR))';
 const value=m=>{let t=m.replace(/\s/g,'');const d=t.match(/[.,](\d{1,2})$/);return Number(d?t.slice(0,d.index).replace(/[.,]/g,'')+'.'+d[1]:t.replace(/[.,]/g,''));};
 const refs=[],matches=[];let remaining=String(text||'');
 const labelled=new RegExp('(RRP|Lowest recent price|Was|Original price)\\s*:?\\s*'+price,'gi');remaining=remaining.replace(labelled,(all,label,a,b)=>{refs.push({label,amount:value(a||b),currency:'EUR',text:all});return ' ';});
 for(const m of remaining.matchAll(new RegExp(price,'gi')))matches.push({amount:value(m[1]||m[2]),text:m[0]});const unique=[...new Set(matches.map(m=>m.amount))];return {price:unique.length===1?unique[0]:null,currency:matches.length||refs.length?'EUR':null,price_status:unique.length===1?'READ':'NEEDS_REVIEW',price_candidates:unique,reference_prices:refs,price_evidence:matches};
}
function inspectPilot(query,capturedIds=[]){
 const captured=new Set(capturedIds.map(String));let nearestAdjustment=null;
 inspectPilot.lastReason="未找到完整可见的商品卡片";inspectPilot.scrollAdjustment=null;inspectPilot.diagnostic={scrollY,viewportHeight:innerHeight,pageHeight:document.documentElement.scrollHeight,atBottom:scrollY+innerHeight>=document.documentElement.scrollHeight-3,cards:[]};
 const u=new URL(location.href);if(u.hostname!=='www.temu.com')throw Error('搜索离开 Temu，已停止');
 const text=document.body?.innerText||'';if(/captcha|verify you are human|security verification|access denied|too many requests|try again/i.test(text))throw Error('页面验证或加载限制，已停止队列；请人工检查');if(/Oops! The items are gone|No results (?:found|for\b)/i.test(text)){inspectPilot.lastReason='搜索结果为空或商品不可用';return null;}
 if(u.searchParams.get('search_key')!==query)throw Error('页面搜索词与试跑不一致，已停止');if(!/€|\bEUR\b/.test(text)){inspectPilot.lastReason='页面未识别到 EUR 价格';return null;}
 const selector='a[href*="goods_id="],a[href*="-g-"]',links=[...document.querySelectorAll(selector)];
 const linkIds=new Map(),firstLinkById=new Map(),parentIds=new WeakMap();for(const link of links){const id=TemuCatalogParser.extractGoodsId(link.href);linkIds.set(link,id);if(id&&!firstLinkById.has(id))firstLinkById.set(id,link);}
 let safeTop=0;for(const el of document.querySelectorAll('body *')){const s=getComputedStyle(el);if(!['fixed','sticky'].includes(s.position))continue;const r=el.getBoundingClientRect();if(s.display!=='none'&&s.visibility!=='hidden'&&r.width>innerWidth*.5&&r.top<innerHeight/3&&r.bottom>0&&r.height<innerHeight/3)safeTop=Math.max(safeTop,r.bottom+3);}
 function cardFor(link,id){let card=link;for(let parent=link.parentElement,n=0;parent&&parent!==document.body&&n<7;parent=parent.parentElement,n++){let ids=parentIds.get(parent);if(!ids){ids=new Set([...parent.querySelectorAll(selector)].map(a=>linkIds.has(a)?linkIds.get(a):TemuCatalogParser.extractGoodsId(a.href)).filter(Boolean));parentIds.set(parent,ids);}if(ids.size!==1||!ids.has(id))break;card=parent;}return card;}
 const rows=TemuCatalogParser.parseDocument(document,{enrich:false}),items=[],rects=[],seen=new Set();let waitingImages=0,partialCards=0;
 for(const row of rows){if(items.length===12)break;if(seen.has(row.goods_id))continue;const link=firstLinkById.get(row.goods_id);if(!link)continue;const card=cardFor(link,row.goods_id),r=card.getBoundingClientRect();
 inspectPilot.diagnostic.safeTop=safeTop;if(r.bottom>0&&r.top<innerHeight)inspectPilot.diagnostic.cards.push({goods_id:row.goods_id,top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right,alreadyCaptured:captured.has(String(row.goods_id)),clippedTop:r.top<safeTop,clippedBottom:r.bottom>innerHeight,tooTall:r.height>innerHeight-safeTop-16});
 // Recover an unseen last row above the viewport or clipped by the sticky header.
 if(!captured.has(String(row.goods_id))&&r.width>=80&&r.height>=100&&r.height<=innerHeight-safeTop-16&&r.left>=0&&r.right<=innerWidth&&r.top<safeTop&&scrollY>0){const delta=Math.round(r.top-safeTop-8);if(Math.abs(delta)<=innerHeight*1.5&&(nearestAdjustment===null||Math.abs(delta)<Math.abs(nearestAdjustment)))nearestAdjustment=delta;}
 if(r.width<80||r.height<100||r.bottom<=safeTop||r.top>=innerHeight)continue;
 if(r.top<safeTop||r.bottom>innerHeight||r.left<0||r.right>innerWidth){partialCards++;if(inspectPilot.scrollAdjustment===null&&r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight-safeTop-16&&r.top>=safeTop){inspectPilot.scrollAdjustment=Math.round(r.top-safeTop-8);}continue;}
 const images=[...card.querySelectorAll('img')].filter(i=>{const a=i.getBoundingClientRect();return a.width>80&&a.height>80;});if(!images.some(i=>i.complete&&i.naturalWidth>80)){waitingImages++;continue;}
 const price=readPriceEvidence(row.raw_card_text);items.push({goods_id:row.goods_id,title:row.title,...price,raw_sales_text:row.raw_sales_text??null,sales_count:row.sales_count,rating:row.rating,review_count:row.review_count});rects.push(r);seen.add(row.goods_id);}
 if(nearestAdjustment!==null&&!items.some(item=>!captured.has(String(item.goods_id))))inspectPilot.scrollAdjustment=nearestAdjustment;
 if(!items.length||waitingImages){inspectPilot.lastReason=waitingImages?'仍有 '+waitingImages+' 张商品图片未加载完成':'完整可见商品为 0，半截卡片 '+partialCards+' 张';return null;}
 const x=Math.max(0,Math.floor(Math.min(...rects.map(r=>r.left)))),y=Math.max(Math.ceil(safeTop),Math.floor(Math.min(...rects.map(r=>r.top)))),right=Math.min(innerWidth,Math.ceil(Math.max(...rects.map(r=>r.right)))),bottom=Math.min(innerHeight,Math.ceil(Math.max(...rects.map(r=>r.bottom))));
 const region={x,y,width:right-x,height:bottom-y,viewportWidth:innerWidth,viewportHeight:innerHeight};if(region.width<100||region.height<100){inspectPilot.lastReason='可截图商品区域过小';return null;}
 items.forEach((item,index)=>{const r=rects[index];item.shot_rect={x:(r.left-x)/region.width,y:(r.top-y)/region.height,width:r.width/region.width,height:r.height/region.height};});
 return {query,items,region,coverage:{complete_cards:items.length,partial_cards_skipped:partialCards,safe_top:safeTop},scroll_y:scrollY,page_url:u.origin+u.pathname+'?search_key='+encodeURIComponent(query)};
}

// Navigate by the next unseen product row, never by a fixed viewport fraction.
function nextPilotRow(capturedIds){
 const captured=new Set(capturedIds.map(String)),selector='a[href*="goods_id="],a[href*="-g-"]';
 let safeTop=0;for(const el of document.querySelectorAll('body *')){const style=getComputedStyle(el),r=el.getBoundingClientRect();if(['fixed','sticky'].includes(style.position)&&style.display!=='none'&&style.visibility!=='hidden'&&r.width>innerWidth*.5&&r.top<innerHeight/3&&r.bottom>0&&r.height<innerHeight/3)safeTop=Math.max(safeTop,r.bottom+3);}
 const parsed=new Set(TemuCatalogParser.parseDocument(document,{enrich:false}).map(r=>String(r.goods_id))),seen=new Set(),candidates=[];
 for(const link of document.querySelectorAll(selector)){const id=TemuCatalogParser.extractGoodsId(link.href);if(!id||captured.has(String(id))||seen.has(id)||!parsed.has(String(id)))continue;seen.add(id);let card=link;
  for(let parent=link.parentElement,n=0;parent&&parent!==document.body&&n<7;parent=parent.parentElement,n++){const ids=new Set([...parent.querySelectorAll(selector)].map(a=>TemuCatalogParser.extractGoodsId(a.href)).filter(Boolean));if(ids.size!==1||!ids.has(id))break;card=parent;}
  const r=card.getBoundingClientRect();if(r.width<80||r.height<100||getComputedStyle(card).display==='none')continue;
  candidates.push({id,top:scrollY+r.top,height:r.height});
 }
 candidates.sort((a,b)=>a.top-b.top);if(!candidates.length)return null;
 const next=candidates[0],target=Math.max(0,Math.min(document.documentElement.scrollHeight-innerHeight,Math.round(next.top-safeTop-12)));
 return {goods_id:next.id,target,delta:target-scrollY,safeTop,cardHeight:next.height};
}
