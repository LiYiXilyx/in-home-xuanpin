'use strict';

(() => {
  function renderMarkup(model){
    const health=model.health.rows.map(row=>`<div class="health-row"><span>${escape(row.label)}</span><span>${escape(row.actual)}</span></div>`).join('');
    return `<h1>Temu 手工采集</h1><p class="category">${escape(model.categoryLabel)}</p><div class="summary"><div><span>任务状态</span><strong>${escape(model.task.status)}</strong></div><div><span>采集模式</span><strong>${escape(model.quantity.label)}</strong></div><div><span>当前已采集</span><strong>${model.quantity.currentUnique}</strong></div><div><span>绑定状态</span><strong>${escape(model.binding.status)}</strong></div></div><section class="health"><h2>页面检查 · ${escape(model.health.status)}</h2>${health}</section>${action('detect-page','检测当前页面',model.steps.detect)}${action('bind-page','绑定当前页面',model.steps.bind)}${action('capture-page','采集当前页面',model.steps.capture)}<p id="catalog-status" role="status" aria-live="polite">${escape(model.error?.reason??model.task.status)}</p><details id="catalog-popup-technical"><summary>技术详情</summary><dl><dt>Campaign ID</dt><dd>${escape(model.technical.campaignId??'—')}</dd><dt>Category Key</dt><dd>${escape(model.technical.categoryKey??'—')}</dd><dt>Profile</dt><dd>${escape(model.technical.profileVersion??'—')}</dd><dt>新增 / 重复 / 失败</dt><dd>${model.counts.added} · ${model.counts.duplicates} · ${model.counts.failed}</dd></dl></details><details class="legacy"><summary>旧版 / 高级浏览器连接</summary><p>Manual Bind 手工采集不需要连接 CDP。</p></details>`;
  }
  function action(id,label,step){return `<button id="${id}" type="button"${step.enabled?'':` disabled aria-disabled="true"`}>${label}</button>${step.disabledReason?`<p class="reason">${escape(step.disabledReason)}</p>`:''}`;}
  function escape(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  globalThis.TemuCatalogPopupView=Object.freeze({renderMarkup});
})();
