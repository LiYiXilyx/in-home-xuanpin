'use strict';
const routes={GET_CATALOG_CURRENT:'/api/catalog-rpa/current-context',SAVE_CATALOG_BATCH:'/api/catalog/batches',SAVE_CATALOG_CHECKPOINT:'/api/catalog-extension/checkpoint'};
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(!s.tab||!s.url?.startsWith('https://www.temu.com/'))return false;(async()=>{
 if(m.type==='LOCAL_MOUSE_COMMAND'){
  if(!['resume','stop'].includes(m.action))throw Error('操作无效');
  const status=await (await fetch('http://127.0.0.1:37823/status',{cache:'no-store'})).json();
  if(status.id!==m.id)throw Error('任务已变化，请刷新控制页');
  const r=await fetch('http://127.0.0.1:37823/command',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Control':status.control_token},body:JSON.stringify({id:m.id,action:m.action})});
  const result=await r.json();if(!r.ok)throw Error(result.message||'指令未接收');return result;
 }
 if(m.type==='AUTO_LOCK'){const {owner}=await chrome.storage.session.get('owner');if(owner&&owner!==s.tab.id)throw Error('另一个页面正在运行自动采集');await chrome.storage.session.set({owner:s.tab.id});return {ok:true};}
 if(m.type==='AUTO_UNLOCK'){const {owner}=await chrome.storage.session.get('owner');if(owner===s.tab.id)await chrome.storage.session.remove('owner');return {ok:true};}
 let route=routes[m.type];if(m.type==='GET_CATALOG_CONTEXT')route='/api/catalog/context?campaign_id='+encodeURIComponent(m.campaignId)+'&source_id='+encodeURIComponent(m.sourceId);if(!route)throw Error('自动插件不支持此操作');
 const post=m.type.startsWith('SAVE_');const r=await fetch('http://127.0.0.1:37821'+route,{method:post?'POST':'GET',headers:post?{'Content-Type':'application/json'}:{},body:post?JSON.stringify(m.payload):undefined,signal:AbortSignal.timeout(15000),cache:'no-store'});const body=await r.json();if(!r.ok||body.ok===false)throw Error(body.error?.message||'本地接口失败');return body;
})().then(reply).catch(e=>reply({ok:false,error:{message:e.message}}));return true;});
chrome.tabs.onRemoved.addListener(async id=>{const {owner}=await chrome.storage.session.get('owner');if(owner===id)await chrome.storage.session.remove('owner');});
