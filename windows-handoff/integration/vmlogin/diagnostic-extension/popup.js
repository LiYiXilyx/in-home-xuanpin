const button=document.querySelector('#check'),output=document.querySelector('#result');
button.addEventListener('click',async()=>{
 button.disabled=true;output.textContent='正在检查…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetch('http://127.0.0.1:37821/api/health',{cache:'no-store',signal:controller.signal});
  const data=await response.json();
  if(!response.ok||data.service!=='temu-vmlogin-connectivity-test'||data.test_only!==true)throw new Error('此端口不是指定的只读联通测试服务。');
  output.textContent='连接成功\nVMLogin 扩展可以访问本地系统。\n检查时间：'+new Date(data.checkedAt).toLocaleString()+'\n这不代表商品搜索、采集或正式接管已验收。';
 }catch(error){output.textContent='连接未通过\n'+error.message+'\n请检查测试服务是否运行，以及 VMLogin 是否允许本地端口 37821。';}
 finally{clearTimeout(timer);button.disabled=false;}
});

const summaryButton=document.querySelector('#summary');
summaryButton.addEventListener('click',async()=>{
 summaryButton.disabled=true;output.textContent='读取临时数据库摘要…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{const res=await fetch('http://127.0.0.1:37821/api/test-summary',{cache:'no-store',signal:controller.signal});const d=await res.json();if(!res.ok||d.test_only!==true||d.source!=='local-test temporary database copies')throw new Error('未收到指定测试数据');const c=d.counts;output.textContent=`测试数据读取成功\n商品：${c.products}\nMembership：${c.catalog_memberships}\nCampaign：${c.catalog_campaigns}\nPool：${c.catalog_pool_versions}\nCatalog Review：${c.reviews}\nSourcing 商品：${c.sourcing_run_items}\n供应商候选：${c.supplier_match_candidates}\nSourcing Review：${c.sourcing_goods_reviews}\nEvidence：${c.temu_market_evidence_sessions} 个会话 / ${c.temu_market_evidence_phases} 个阶段\n仅为临时副本摘要；没有采集当前页面。`;}
 catch(e){output.textContent='读取未通过：'+e.message;}
 finally{clearTimeout(timer);summaryButton.disabled=false;}
});

const probeButton=document.querySelector('#probe');
probeButton.addEventListener('click',async()=>{
 probeButton.disabled=true;output.textContent='读取当前可见页最多3个商品字段…';
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw new Error('没有当前标签页。');
  const responses=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readThreeVisibleProducts});const data=responses[0]?.result;
  if(!data?.ok)throw new Error(data?.error||'无法读取当前页。');
  if(!data.items.length)throw new Error('当前可见区域未找到商品卡；请停留在已有商品列表页，不必刷新或滚动。');
  const lines=data.items.map((x,i)=>`${i+1}. 商品 ID：${x.goods_id}\n   ${x.price_status==='READY'?`价格：${x.price_amount} ${x.currency}`:x.price_status==='MISSING'?'未找到明确价格，待人工核对':'多个或不明确价格，待人工核对：'+x.price_candidates.map(p=>p.amount+' '+(p.currency||'币种不明')).join(' / ')}`);
  output.textContent=lines.join('\n\n')+'\n\n正在发送到本机临时测试文件…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{const res=await fetch('http://127.0.0.1:37821/api/test/three-products',{method:'POST',headers:{'Content-Type':'application/json','X-Temu-Test':'three-products-v1'},body:JSON.stringify(data),signal:controller.signal});const ack=await res.json();if(!res.ok||!ack.test_only||ack.received_count!==data.items.length)throw new Error('本地测试服务没有确认接收。');output.textContent=lines.join('\n\n')+`\n\n本机已收到 ${ack.received_count} 个商品字段。\n请人工对照页面价格；多价格不自动判定。\n只保存临时测试文件，未写业务库、未下载图片。`;}
  finally{clearTimeout(timer);}
 }catch(e){output.textContent+='\n检查未完成：'+e.message;}
 finally{probeButton.disabled=false;}
});
