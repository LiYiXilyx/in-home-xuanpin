const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'—';
const num=v=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
const labels={scheduled:'未到期',due:'待采集 / 补齐',complete:'已记录',missed:'已过期 / 有缺失'};
const svg='<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
const views={overview:'工作台',catalog:'商品采集与商品池',sourcing:'1688 候选导入',tracking:'周期跟踪',diagnostics:'任务与诊断'};
document.body.insertAdjacentHTML('afterbegin',`<aside class="admin-sidebar"><div class="admin-brand"><b>T</b>Temu 运营台</div><nav class="admin-nav"><small>选品工作空间</small>${Object.entries(views).slice(0,4).map(([k,v])=>`<a href="/#${k}" data-nav="${k}">${svg}${v}</a>`).join('')}<small>人工复核与任务</small><a id="admin-review-link" href="/#sourcing">${svg}1688 人工复核</a><a href="http://127.0.0.1:37822/auto">${svg}自动截图队列</a><a href="http://127.0.0.1:37822/opportunities">${svg}机会商品</a><a href="/#diagnostics" data-nav="diagnostics">${svg}任务与诊断</a></nav><div class="admin-side-foot">德国站 · English · EUR<br>本机运营工作空间</div></aside><header class="admin-header"><div><button class="mobile-menu" aria-label="打开菜单">☰</button><span class="crumb">运营管理 /</span><strong id="admin-crumb">工作台</strong></div><div class="admin-user"><span>商品采集 · 寻源 · 趋势跟踪</span><span class="admin-avatar">运</span>运营人员</div></header><div class="admin-tabs"><span id="admin-tab">工作台</span></div>`);

document.querySelector("#admin-crumb").textContent="1688 人工复核";document.querySelector("#admin-tab").textContent="1688 人工复核";document.querySelector("#admin-review-link").classList.add("active");document.querySelector(".mobile-menu").onclick=()=>document.body.classList.toggle("menu-open");
