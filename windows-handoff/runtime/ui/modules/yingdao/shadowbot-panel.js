export function mountShadowbot(root){
 const card=document.createElement('section');card.className='yingdao-panel';
 card.innerHTML='<h3>1688 一键找货</h3><p>自动选择未完成商品、准备图片、调用影刀搜图，每件随机选 5 条导入人工复核。</p><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:end"><label>商品池<br><select data-pool></select></label><label>本次数量（1—50）<br><input data-count type="number" min="1" max="50" value="5" style="width:100px"></label><button data-start style="background:#409eff;color:white;padding:10px 24px;border:0;border-radius:6px">开始找货</button><button data-refresh>刷新状态</button></div><p>停止后可直接切换商品池，原批次进度保留；切回原池可继续。切换不会启动搜图。</p><p>数据目录：F:/Temu运营数据（系统按商品池、日期和批次自动归档）</p><button data-folder>打开本批文件夹</button><p data-summary>正在读取商品池进度…</p><p data-status role="status"></p><p data-error role="alert" style="white-space:pre-wrap;color:#b42318;background:#fff1f0;padding:12px" hidden></p><button data-import-saved hidden>将已保存商品导入人工复核</button><button data-retry-search hidden>继续未完成商品</button><button data-retry-import hidden>重试导入（不重新搜图）</button><a data-review hidden>打开本批人工复核</a><details><summary>任务日志</summary><pre data-log style="white-space:pre-wrap;max-height:280px;overflow:auto"></pre></details>';
 root.prepend(card);const q=s=>card.querySelector(s);let stopped=false,requestBusy=false,summaryKey='';
 async function api(url,body){const r=await fetch('/api/sourcing/automation'+url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error?.message??'请求失败');return value;}
 function error(e){q('[data-error]').hidden=false;q('[data-error]').textContent=e.message;}
 async function summary(){const id=q('[data-pool]').value;if(!id)return;const r=await api('/options?poolId='+encodeURIComponent(id));if(q('[data-pool]').value===id)if(q('[data-pool]').value!==id)return;q('[data-summary]').textContent=`总共 ${r.total} 件 · 已完成并导入 ${r.completed} 件 · 待处理 ${r.remaining} 件。下次自动接着未完成商品做。`;}
 function render(d){q('[data-folder]').disabled=!d.batchDir;const active=['PREPARING','STARTING','RUNNING','IMPORTING','CONNECTION_LOST','IMPORT_FAILED','FAILED','NEEDS_ATTENTION','STOPPED'].includes(d.state);if(d.importConfig?.poolId)q('[data-pool]').value=d.importConfig.poolId;q('[data-start]').disabled=active;q('[data-pool]').disabled=['PREPARING','STARTING','RUNNING','IMPORTING','CONNECTION_LOST'].includes(d.state)||d.partialImportStatus==='IMPORTING';q('[data-count]').disabled=active;if(active&&d.total)q('[data-count]').value=d.total;
 q('[data-status]').textContent=({STOPPED:'已停止，成果已保留',IDLE:'尚未启动',PREPARING:'正在准备资料和图片，请稍候',PREPARE_FAILED:'准备失败，可重新开始',STARTING:'正在启动影刀',RUNNING:'正在搜图',COMPLETED:'搜图完成，等待自动导入',IMPORTING:'正在随机选5条并导入',IMPORTED:'已导入复核',IMPORT_FAILED:'导入失败',FAILED:'搜图失败，请继续未完成商品',NEEDS_ATTENTION:'请先处理浏览器提示',CONNECTION_LOST:'连接异常，请检查影刀'}[d.state]??d.state)+(d.total?' · 已保存 '+(d.completedGoods?.length??0)+'/'+d.total:'');
 const message=[d.error,d.connectionError,d.action,d.eventError,d.archiveError].filter(Boolean).join('\n');q('[data-error]').hidden=!message;q('[data-error]').textContent=message;
 q('[data-import-saved]').hidden=!['FAILED','NEEDS_ATTENTION','STOPPED'].includes(d.state)||!(d.completedGoods?.length);q('[data-import-saved]').disabled=d.partialImportStatus==='IMPORTING';
 q('[data-retry-search]').hidden=!['FAILED','NEEDS_ATTENTION','STOPPED'].includes(d.state);q('[data-retry-import]').hidden=d.state!=='IMPORT_FAILED';q('[data-review]').hidden=!d.reviewUrl;if(d.reviewUrl)q('[data-review]').href=d.reviewUrl;
 q('[data-log]').textContent=[...(d.logs??[]).map(x=>`${x.time} ${x.level} ${x.message}`),...(d.events??[]).map(x=>`${new Date(x.time*1000).toLocaleString()} ${x.state} ${x.goods_id??''} ${x.message??''}`)].join('\n');
 if(summaryKey!==d.state+q('[data-pool]').value){summaryKey=d.state+q('[data-pool]').value;void summary().catch(error);}}
 async function refresh(){if(stopped)return;try{render(await api(''));}catch(e){error(e);}}
 async function act(url,body){if(requestBusy)return;requestBusy=true;q('[data-start]').disabled=true;try{render(await api(url,body));}catch(e){error(e);}finally{requestBusy=false;}}
 q('[data-import-saved]').onclick=()=>act('/import-saved',{});
 q('[data-folder]').onclick=()=>api('/open-folder',{}).catch(error);
 q('[data-start]').onclick=()=>act('/start',{validationOnly:false,poolId:q('[data-pool]').value,count:Number(q('[data-count]').value)});
 q('[data-refresh]').onclick=()=>{void refresh();void summary().catch(error);};q('[data-pool]').onchange=()=>act('/switch-pool',{poolId:q('[data-pool]').value});
 q('[data-retry-search]').onclick=()=>act('/retry-search',{});q('[data-retry-import]').onclick=()=>act('/retry-import',{});
 fetch('/api/sourcing/pools').then(r=>r.json()).then(async d=>{for(const p of d.pools.filter(p=>p.status==='active')){const o=document.createElement('option');o.value=p.id;o.textContent=({'motorcycle-accessories':'摩托车配件','replacement-parts':'替换零件'}[p.category_key]??p.category_key)+' · '+p.product_count+'件';q('[data-pool]').append(o);}await summary();await refresh();}).catch(error);
 const timer=setInterval(()=>{if(!document.hidden)void refresh();},5000);return()=>{stopped=true;clearInterval(timer);card.remove();};
}




