import {createYingdaoApi} from './api.js';
import {applySourcingPayload} from './model.js';
import {createYingdaoState,patchYingdaoState,snapshotYingdaoState} from './state.js';

const mounts=new WeakMap();
let currentController=null;

export const yingdaoPanelMarkup=`
  <section class="yingdao-panel" aria-labelledby="yingdao-title">
    <div class="yingdao-header"><div><p class="yingdao-eyebrow">1688 / YINGDAO SOURCING</p><h2 id="yingdao-title">1688 / 影刀寻源</h2></div><strong id="yingdao-state">UNCONFIGURED</strong></div>
    <p id="yingdao-error" class="yingdao-error" hidden></p>
    <div class="yingdao-paths">
      <label class="yingdao-field"><span>Raw 1688 Excel目录</span><input id="yingdao-raw-directory"><button id="yingdao-choose-raw" type="button">选择Raw目录</button></label>
      <label class="yingdao-field"><span>1688图片缓存目录</span><input id="yingdao-image-cache-directory"><button id="yingdao-choose-images" type="button">选择图片缓存目录</button></label>
      <label class="yingdao-field"><span>现有分析工作簿</span><input id="yingdao-workbook"><button id="yingdao-choose-workbook" type="button">选择分析工作簿</button></label>
    </div>
    <div class="yingdao-actions"><a id="yingdao-review-link" class="yingdao-link" href="/sourcing-review.html">打开1688候选人工复核</a><button id="yingdao-scan" type="button">扫描目录</button><button id="yingdao-import" type="button">开始导入</button><button id="yingdao-retry-images" type="button">仅重试失败图片</button></div>
    <dl class="yingdao-metrics">
      <div><dt>run_id</dt><dd id="yingdao-run-id">—</dd></div><div><dt>source files</dt><dd id="yingdao-source-files">0</dd></div>
      <div><dt>valid goods_id</dt><dd id="yingdao-goods">0</dd></div><div><dt>Random5</dt><dd id="yingdao-random5">0</dd></div>
      <div><dt>image success</dt><dd id="yingdao-image-success">0</dd></div><div><dt>image failed</dt><dd id="yingdao-image-failed">0</dd></div>
      <div><dt>awaiting review</dt><dd id="yingdao-review-awaiting">0</dd></div><div><dt>confirmed</dt><dd id="yingdao-review-confirmed">0</dd></div>
    </dl>
    <table class="yingdao-preview"><thead><tr><th>filename</th><th>goods_id</th><th>row_count</th><th>parse_status</th></tr></thead><tbody id="yingdao-preview"><tr><td colspan="4">尚未扫描</td></tr></tbody></table>
  </section>`;

export function mountYingdaoPanel({root,pollIntervalMs=3000,scheduler=globalThis,api=null}={}){
  if(!root)throw coded('YINGDAO_ROOT_REQUIRED','YingDao mount root is required');
  const existing=mounts.get(root);if(existing)return existing;
  if(currentController)throw coded('YINGDAO_PANEL_ALREADY_MOUNTED','YingDao panel already has a root');
  root.innerHTML=yingdaoPanelMarkup;
  let active=true,refreshPromise=null,yingdaoPollingTimer=null,state=createYingdaoState();patchYingdaoState(state,{mounted:true});
  const client=api??createYingdaoApi();
  async function refresh(){if(!active)throw coded('YINGDAO_PANEL_NOT_MOUNTED','YingDao panel 已卸载。');if(refreshPromise)return refreshPromise;
    refreshPromise=(async()=>{const [settings,current]=await Promise.all([client.settings(),client.currentImport()]);patchYingdaoState(state,applySourcingPayload(state,settings));patchYingdaoState(state,applySourcingPayload(state,current));refreshPromise=null;return snapshotYingdaoState(state);})();return refreshPromise;}
  const controller={refresh,getState:()=>snapshotYingdaoState(state),destroy(){if(!active)return;active=false;if(yingdaoPollingTimer!==null)scheduler.clearInterval(yingdaoPollingTimer);yingdaoPollingTimer=null;root.replaceChildren();mounts.delete(root);if(currentController===controller)currentController=null;}};
  mounts.set(root,controller);currentController=controller;void refresh();yingdaoPollingTimer=scheduler.setInterval(()=>{void refresh();},Number(pollIntervalMs));return controller;
}

export async function refreshYingdaoPanel(){if(!currentController)throw coded('YINGDAO_PANEL_NOT_MOUNTED','YingDao panel 尚未挂载。');return currentController.refresh();}

function coded(code,message){const error=new Error(message);error.code=code;return error;}
