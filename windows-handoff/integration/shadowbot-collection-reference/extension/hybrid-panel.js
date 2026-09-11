(()=>{
const mod=globalThis.TemuCatalogManualPassiveRunnerModule;
const box=document.createElement('section');box.id='hybrid-test-panel';box.style.cssText='position:fixed;left:12px;top:90px;z-index:2147483647;background:white;border:2px solid #167d9a;padding:12px;width:260px;color:#17324a;font:14px sans-serif';
box.innerHTML='<b>人工绑定＋影刀点击 · 测试版</b><p>① 检测 → ② 绑定 → ③ 在影刀启动测试</p><button id="hybrid-detect">检测页面</button><button id="hybrid-bind" disabled>绑定页面</button><p><button id="hybrid-capture" disabled>测试版：采集当前页面</button></p><button id="hybrid-stop">停止辅助采集</button><p id="hybrid-message">等待人工检测</p>';
const style=document.createElement('style');style.textContent=`
#hybrid-test-panel{box-sizing:border-box!important;width:300px!important;padding:16px!important;background:#fff!important;border:2px solid #167d9a!important;border-radius:10px!important;box-shadow:0 4px 18px #0003!important;color:#17324a!important;text-align:left!important;font:14px/1.5 Arial,sans-serif!important}
#hybrid-test-panel b{display:block!important;font:700 15px/22px Arial,sans-serif!important;color:#17324a!important}
#hybrid-test-panel p{display:block!important;margin:10px 0!important;font:14px/1.5 Arial,sans-serif!important;color:#17324a!important;white-space:normal!important}
#hybrid-test-panel button{appearance:none!important;display:block!important;box-sizing:border-box!important;position:static!important;width:264px!important;height:44px!important;margin:8px 0!important;padding:0 10px!important;border:1px solid #1976d2!important;border-radius:6px!important;background:#e8f2ff!important;color:#124c88!important;font:700 15px/42px Arial,sans-serif!important;text-align:center!important;text-decoration:none!important;white-space:nowrap!important;opacity:1!important;cursor:pointer!important;transition:none!important;transform:none!important}
#hybrid-test-panel #hybrid-capture{height:50px!important;line-height:48px!important;background:#1769d2!important;color:#fff!important;border:2px solid #0e4fa8!important}
#hybrid-test-panel #hybrid-stop{background:#fff0ee!important;border-color:#c74235!important;color:#a92720!important}
#hybrid-test-panel button:disabled{background:#e7ebf0!important;border-color:#c8d0d9!important;color:#75808d!important;cursor:not-allowed!important}
#hybrid-test-panel #hybrid-message{min-height:42px!important;background:#f2f6fa!important;padding:8px!important;border-radius:5px!important;overflow-wrap:anywhere!important}
`;box.append(style);
document.documentElement.append(box);const q=s=>box.querySelector(s);let runner=null,busy=false,stopped=true,receipt=0,error='',boundUrl=null;
const visible=n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(n).visibility!=='hidden'&&!n.disabled;};
function publish(){const scan=mod.scanDom(),text=document.body?.innerText||'';const buttons=[...document.querySelectorAll('button,a,[role="button"]')].filter(n=>!box.contains(n)&&visible(n));box.dataset.state=JSON.stringify({version:1,url:location.href,hidden:document.hidden,stopped,busy,error,receipt,bound:!!runner?.binding&&boundUrl===location.href,campaign:runner?.context?.campaign?.id,runnerState:runner?.state,ids:(scan.rawCards||[]).map(c=>String(c.goods_id)),count:Number(runner?.context?.campaign?.nonElectronicUniqueCount||0),blocked:!!scan.captchaBlocking||/access denied|too many requests|temporarily blocked/i.test(text),retry:buttons.some(n=>/^(try again|try more)$/i.test(n.innerText.trim())),more:buttons.some(n=>/^see more$/i.test(n.innerText.trim())),y:scrollY,height:document.documentElement.scrollHeight});}
async function action(fn){if(busy)return;busy=true;error='';publish();try{await fn();}catch(e){error=e.message;stopped=true;}finally{busy=false;q('#hybrid-message').textContent=error||`状态：${runner?.state} · 已确认保存 ${receipt} 次`;q('#hybrid-bind').disabled=runner?.state!=='PAGE_READY';q('#hybrid-capture').disabled=!runner?.binding||stopped;publish();}}
q('#hybrid-detect').onclick=()=>action(async()=>{stopped=true;runner=new mod.ManualPassiveRunner(mod.realDependencies());await runner.restore();await runner.detectCurrentPage();});
q('#hybrid-bind').onclick=()=>action(async()=>{await runner.bindCurrentPage();boundUrl=location.href;stopped=false;});
q('#hybrid-capture').onclick=()=>action(async()=>{if(stopped||boundUrl!==location.href)throw Error('请重新人工检测绑定');await runner.refreshContext();if(!runner.binding)throw Error('任务变化，请重新绑定');await runner.captureCurrentPage();if(runner.lastError)throw runner.lastError;receipt++;});
q('#hybrid-stop').onclick=()=>{stopped=true;q('#hybrid-capture').disabled=true;publish();};
// The worker requests binding only after the operator chooses a task and starts.
box.addEventListener('hybrid-auto-bind',()=>action(async()=>{
stopped=true;runner=new mod.ManualPassiveRunner(mod.realDependencies());await runner.restore();
if(runner.context?.campaign?.id!==box.dataset.expectedCampaign)throw Error('运营台任务已变化，请返回运营台重新选择');
await runner.detectCurrentPage();await runner.bindCurrentPage();boundUrl=location.href;stopped=false;
}));
setInterval(publish,500);publish();
})();
