function readThreeVisibleProducts() {
 if(location.protocol!=='https:'||location.hostname!=='www.temu.com')return {ok:false,error:'请切回已打开的 www.temu.com 商品列表页，再点击扩展。'};
 const items=[],seen=new Set();
 const selector='a[href*="goods_id="],a[href*="-g-"]';
 function idOf(a){try{const u=new URL(a.getAttribute('href'),location.href);if(u.hostname!=='www.temu.com'||u.protocol!=='https:')return null;const id=u.searchParams.get('goods_id')||u.pathname.match(/-g-(\d+)\.html/i)?.[1];return /^\d{5,20}$/.test(id||'')?id:null;}catch{return null;}}
 function visible(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';}
 function uniqueIds(el){return new Set([...el.querySelectorAll(selector)].map(idOf).filter(Boolean));}
 function prices(text){
  const n='(?:\\d{1,3}(?:[. ,\\u00a0]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?';
  const re=new RegExp('(?:€|EUR|USD|GBP|\\$|£)\\s*('+n+')(?![\\d.,])|('+n+')\\s*(?:€|EUR|USD|GBP|\\$|£)','gi');const out=[];
  for(const match of text.matchAll(re)){
   const token=match[0].trim();let v=(match[1]||match[2]).replace(/[\s\u00a0]/g,'');const decimal=v.match(/[.,](\d{1,2})$/);
   v=decimal?v.slice(0,decimal.index).replace(/[.,]/g,'')+'.'+decimal[1]:v.replace(/[.,]/g,'');const amount=Number(v);
   const currency=/€|EUR/i.test(token)?'EUR':/USD/i.test(token)?'USD':/GBP|£/i.test(token)?'GBP':null;
   if(Number.isFinite(amount)&&amount>=0&&amount<=1000000&&!out.some(x=>x.amount===amount&&x.currency===currency))out.push({amount,currency});
   if(out.length===4)break;
  }
  return out;
 }
 for(const link of document.querySelectorAll(selector)){
  if(items.length===3)break;const id=idOf(link);if(!id||seen.has(id)||!visible(link))continue;
  let card=link;
  for(let p=link.parentElement,depth=0;p&&p!==document.body&&depth<7;p=p.parentElement,depth++){
   const ids=uniqueIds(p);if(ids.size!==1||!ids.has(id))break;card=p;
   if(p.matches('[data-product-card],article,li'))break;
  }
  const candidates=prices(String(card.innerText||'').slice(0,2500));const ready=candidates.length===1&&candidates[0].currency!==null;
  items.push({goods_id:id,price_amount:ready?candidates[0].amount:null,currency:ready?candidates[0].currency:null,price_status:ready?'READY':candidates.length?'AMBIGUOUS':'MISSING',price_candidates:candidates});seen.add(id);
 }
 return {ok:true,kind:'visible_dom_three',page_origin:'https://www.temu.com',items};
}
