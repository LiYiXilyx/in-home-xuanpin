const BASE='http://127.0.0.1:37822';let busy=false;
async function api(route,data){const r=await fetch(BASE+route,{method:'POST',headers:{'Content-Type':'application/json','X-Pilot':'search-v1'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw Error(b.error);return b;}
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.type!=='START_SEARCH_PILOT')return;if(busy){reply({error:'已有试跑进行中'});return;}busy=true;reply({ok:true});run(m.prepared_id).finally(()=>busy=false);});
async function run(preparedId){let job;try{job=await api('/start',{prepared_id:preparedId});const [current]=await chrome.tabs.query({active:true,currentWindow:true});let matches=false;try{const u=new URL(current?.url);matches=u.origin==='https://www.temu.com'&&u.searchParams.get('search_key')===job.query;}catch{} const tab=matches?current:await chrome.tabs.create({url:'https://www.temu.com/de-en/search_result.html?search_key='+encodeURIComponent(job.query),active:true});if(!matches)throw Error('搜索页已打开。请留在该页，再点击试跑扩展一次以授权截图；将复用页面，不会重新搜索。');let result,stable='',samples=0;
 for(let i=0;i<16;i++){await new Promise(r=>setTimeout(r,2000));const t=await chrome.tabs.get(tab.id);if(t.status!=='complete')continue;
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:['catalog-parser.js','temu-market-evidence.js','probe.js']});
 const x=await chrome.scripting.executeScript({target:{tabId:tab.id},func:q=>inspectPilot(q),args:[job.query]});result=x[0]?.result;if(!result)continue;const key=JSON.stringify(result.items);samples=key===stable?samples+1:0;stable=key;if(samples>=1)break;result=null;}
 if(!result)throw Error('35秒内未得到稳定可见商品，已停止，无自动重试');
 const [active]=await chrome.tabs.query({active:true,windowId:tab.windowId});if(active?.id!==tab.id)throw Error('搜索页不在前台，已停止截图');
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:['screenshot-overlays.js']});
 const leases=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>TemuScreenshotOverlayGuard('hide')});let png;
 try{await new Promise(r=>setTimeout(r,150));png=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});}
 finally{await chrome.scripting.executeScript({target:{tabId:tab.id},func:lease=>TemuScreenshotOverlayGuard('restore',lease),args:[leases[0].result]}).catch(()=>{});}
 const crop=await chrome.scripting.executeScript({target:{tabId:tab.id},func:(png,region)=>TemuMarketEvidence.cropVisibleScreenshot(png,region),args:[png,result.region]});
 const [stillActive]=await chrome.tabs.query({active:true,windowId:tab.windowId});if(stillActive?.id!==tab.id)throw Error('截图期间切换了标签页，已丢弃截图');
 await api('/result',{id:job.id,token:job.token,...result,screenshot:crop[0].result});
 await chrome.tabs.create({url:BASE+'/?id='+encodeURIComponent(job?.id??''),active:true});
 }catch(e){if(job)await api('/fail',{id:job.id,token:job.token,error:/activeTab|<all_urls>/.test(e.message)?'截图权限未授予。请切回已打开的 Temu 搜索页，在该页点击试跑扩展一次；不会重新搜索。':e.message}).catch(()=>{});await chrome.tabs.create({url:BASE+'/?id='+encodeURIComponent(job?.id??''),active:true});}}
