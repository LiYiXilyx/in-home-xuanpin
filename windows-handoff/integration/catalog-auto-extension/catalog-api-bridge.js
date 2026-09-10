'use strict';
// This independent extension reads/saves products; VMLogin owns navigation and clicks.
(()=>{
 const channel='TEMU_CATALOG_VM_V1',mod=globalThis.TemuCatalogManualPassiveRunnerModule;
 let runner=null,boundUrl=null,campaign=null,busy=false;
 const receipts=new Map();
 const category=()=>location.hostname==='www.temu.com'&&/-o3-\d+\.html$/i.test(location.pathname);
 const visible=n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(n).visibility!=='hidden';};
 function snapshot(){
  const scan=mod.scanDom(),cards=scan.rawCards??[];
  const text=String(document.body?.innerText||'');
  return {url:location.href,hidden:document.hidden,category:category(),captcha:Boolean(scan.captchaBlocking),blocked:/access denied|too many requests|temporarily blocked/i.test(text),retry:[...document.querySelectorAll('button,a,[role="button"]')].some(n=>visible(n)&&/^try again$/i.test((n.innerText||'').trim())),empty:Boolean(scan.searchNoResults),loading:[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].some(visible),ids:cards.map(c=>String(c.goods_id)),signature:JSON.stringify(cards.map(c=>[c.goods_id,c.title,c.price_amount,c.image_url,c.raw_card_text])),y:scrollY,height:document.documentElement.scrollHeight,viewport:innerHeight,more:[...document.querySelectorAll('button,a,[role="button"]')].some(n=>visible(n)&&/^see more$/i.test((n.innerText||'').trim())&&!n.disabled&&n.getAttribute('aria-disabled')!=='true'),campaignId:runner?.context?.campaign?.id,count:Number(runner?.context?.campaign?.nonElectronicUniqueCount||0),runnerState:runner?.state};
 }
 async function execute(action,expected){
  if(!category())throw Error('请打开 Temu 类目页面，搜索页不能用于类目采集');
  const s=snapshot();if(s.captcha||s.blocked)throw Error('验证码或访问限制，请人工检查');
  if(action==='inspect')return s;
  if(action==='prepare'){
   if(s.retry||s.empty)throw Error('页面加载失败，请恢复页面后检测');
   runner=new mod.ManualPassiveRunner(mod.realDependencies());await runner.restore();await runner.detectCurrentPage();
   if(runner.state!=='PAGE_READY'){const d=runner.detection;if(d?.health?.checks?.sort===false||d?.health?.code==='sort')throw Error('排序检查未通过：当前识别为「'+(d?.observed?.sortOrder||'未读取到')+'」，任务要求「'+runner.context.profile.sort_order+'」。请确认 Temu 页面排序。');throw Error('页面检测未通过：'+(d?.health?.code||runner.state));}
   await runner.bindCurrentPage();boundUrl=location.href;campaign=runner.context.campaign.id;return snapshot();
  }
  if(action!=='capture')throw Error('未知采集操作');
  if(!runner||location.href!==boundUrl||expected!==campaign)throw Error('页面或绑定任务已变化，请重新检测');
  await runner.refreshContext();if(runner.context.campaign.id!==campaign)throw Error('采集任务已变化，已停止');
  if(s.retry||s.empty)throw Error('商品尚未加载完成');
  await runner.captureCurrentPage();return snapshot();
 }
 window.addEventListener('message',async e=>{
  const m=e.data;if(e.source!==window||e.origin!==location.origin||m?.channel!==channel||m.kind!=='request'||typeof m.id!=='string'||m.id.length>80||!['inspect','prepare','capture'].includes(m.action))return;
  const reply=result=>window.postMessage({channel,kind:'response',id:m.id,...result},location.origin);
  if(receipts.has(m.id)){const result=receipts.get(m.id);if(result)reply(result);return;}
  if(busy){reply({ok:false,error:'采集插件正在处理上一个请求'});return;}
  busy=true;receipts.set(m.id,null);let result;
  try{result={ok:true,result:await execute(m.action,m.campaignId)};}catch(e){result={ok:false,error:e.message};}finally{busy=false;}
  receipts.set(m.id,result);if(receipts.size>100)receipts.delete(receipts.keys().next().value);reply(result);
 });
})();
