const mounts=new WeakMap();
let currentController=null;

export function catalogPanelMarkup(){return `
  <section id="catalog-panel" class="catalog-panel panel" aria-labelledby="catalog-panel-title">
    <div class="catalog-heading">
      <div><p class="eyebrow">MANUAL BIND</p><h2 id="catalog-panel-title">新建采集任务</h2></div>
      <span class="catalog-hint">创建后仍需在 Temu 页面人工检测、绑定和采集</span>
    </div>
    <form id="catalog-create-form" class="catalog-form">
      <label class="catalog-field">Category<select id="catalog-category-select" required></select></label>
      <label class="catalog-field">Category Profile<select id="catalog-profile-select" required></select></label>
      <label class="catalog-field">采集模式<input id="catalog-capture-mode" value="MANUAL_BIND_PASSIVE_CAPTURE" readonly></label>
      <label class="catalog-field">当前 Active Pool 数量<output id="catalog-active-pool-count">0</output></label>
      <label id="catalog-requested-new-field" class="catalog-field">本次新增目标数量<input id="catalog-requested-new" type="number" min="1" step="1"></label>
      <label id="catalog-target-field" class="catalog-field">Campaign Target<output id="catalog-calculated-target">—</output></label>
      <label class="catalog-field">任务名称<input id="catalog-campaign-name" maxlength="200" required></label>
      <button id="catalog-create-campaign" class="catalog-create-button primary" type="submit">创建采集任务</button>
    </form>
    <p id="catalog-loading" class="catalog-loading" hidden>Catalog 加载中…</p>
    <p id="catalog-error" class="catalog-error" role="alert" hidden></p>
    <section id="catalog-current-campaign" class="catalog-current" hidden>
      <h3 class="catalog-current-title">当前采集任务</h3>
      <dl class="catalog-current-grid">
        <div class="catalog-current-field"><dt>Category</dt><dd id="catalog-current-category">—</dd></div>
        <div class="catalog-current-field"><dt>Profile</dt><dd id="catalog-current-profile">—</dd></div>
        <div class="catalog-current-field"><dt>Campaign Name</dt><dd id="catalog-current-name">—</dd></div>
        <div class="catalog-current-field"><dt>Campaign ID（诊断）</dt><dd id="catalog-current-campaign-id">—</dd></div>
        <div class="catalog-current-field"><dt>Active Pool</dt><dd id="catalog-active-pool-id">—</dd></div>
        <div class="catalog-current-field"><dt>Baseline</dt><dd id="catalog-current-baseline">0</dd></div>
        <div class="catalog-current-field"><dt>Target</dt><dd id="catalog-current-target">0</dd></div>
        <div class="catalog-current-field"><dt>Current Unique</dt><dd id="catalog-live-unique-count">0</dd></div>
        <div class="catalog-current-field"><dt>Remaining</dt><dd id="catalog-current-remaining">0</dd></div>
        <div class="catalog-current-field"><dt>Status</dt><dd id="catalog-current-status">—</dd></div>
        <div class="catalog-current-field"><dt>Bind</dt><dd id="catalog-current-binding">等待页面绑定</dd></div>
      </dl>
      <div id="catalog-initial-actions" class="catalog-initial-actions" hidden>
        <p id="catalog-quantity-mode" class="catalog-quantity-mode">采集模式：不限数量 / OPEN_ENDED</p>
        <p id="catalog-qa-status" class="catalog-qa-status">QA：NOT_RUN</p>
        <button id="catalog-run-initial-qa" class="catalog-qa-button" type="button">运行首池 QA</button>
        <button id="catalog-activate-initial-pool" class="catalog-activate-button primary" type="button" disabled>建立首个商品池</button>
      </div>
      <div id="catalog-activation-result" class="catalog-activation-result" hidden></div>
    </section>
  </section>`;}

export function mountCatalogPanel({root}={}){
  if(!root||typeof root!=='object')throw coded('CATALOG_ROOT_REQUIRED','缺少 Catalog mount root。');
  const existing=mounts.get(root);if(existing)return existing;
  root.innerHTML=catalogPanelMarkup();
  const state=Object.freeze({mounted:true});
  let active=true;
  const controller={
    async refresh(){return state;},
    getState(){return state;},
    destroy(){if(!active)return;active=false;root.replaceChildren();mounts.delete(root);if(currentController===controller)currentController=null;}
  };
  mounts.set(root,controller);currentController=controller;return controller;
}

export async function refreshCatalogPanel(){
  if(!currentController)throw coded('CATALOG_PANEL_NOT_MOUNTED','Catalog panel 尚未挂载。');
  return currentController.refresh();
}

function coded(code,message){const error=new Error(message);error.code=code;return error;}
