import {createYingdaoApi} from './api.js';
import {applySourcingPayload,deriveYingdaoControls} from './model.js';
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
    <div class="yingdao-actions"><a id="yingdao-review-link" class="yingdao-link" aria-disabled="true" title="请先选择有效 Review Run">打开1688候选人工复核</a><button id="yingdao-scan" type="button">扫描目录</button><button id="yingdao-import" type="button">开始导入</button><button id="yingdao-retry-images" type="button">仅重试失败图片</button></div>
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
  const elements=collectElements(root);
  function render(){const controls=deriveYingdaoControls(state);if(elements.state)elements.state.textContent=state.scanStatus;if(elements.error){elements.error.hidden=!state.error;elements.error.textContent=state.error?.message??'';}
    if(elements.raw)elements.raw.value=state.settings.sourceDir??'';if(elements.images)elements.images.value=state.settings.imageCacheDir??'';if(elements.workbook)elements.workbook.value=state.settings.selectedWorkbookPath??'';
    for(const element of [elements.raw,elements.images,elements.workbook,elements.chooseRaw,elements.chooseImages,elements.chooseWorkbook])if(element)element.disabled=controls.pathsLocked;
    if(elements.scan)elements.scan.disabled=!controls.canScan;if(elements.import)elements.import.disabled=!controls.canImport;if(elements.retry)elements.retry.disabled=!controls.canRetry;renderReviewLink(elements.review,state.reviewRun);
    setText(elements.runId,state.currentRun??state.reviewRun??'—');setText(elements.sourceFiles,state.progress.sourceFiles);setText(elements.goods,state.progress.validGoods);setText(elements.random5,state.random5.candidates);
    setText(elements.imageSuccess,state.imageCache.success);setText(elements.imageFailed,state.imageCache.failed);setText(elements.reviewAwaiting,state.reviewSummary.awaiting);setText(elements.reviewConfirmed,state.reviewSummary.confirmed);renderPreview(root,elements.preview,state.preview);}
  async function refresh(){if(!active)throw coded('YINGDAO_PANEL_NOT_MOUNTED','YingDao panel 已卸载。');if(refreshPromise)return refreshPromise;
    patchYingdaoState(state,{loading:{...state.loading,settings:true},error:null});render();
    const operation=(async()=>{try{const [settings,current,review]=await Promise.all([client.settings(),client.currentImport(),client.reviewBootstrap?.()??null]);patchYingdaoState(state,applySourcingPayload(state,settings));patchYingdaoState(state,applySourcingPayload(state,current));
        patchYingdaoState(state,{reviewRun:review?.run_id??null,...(review?{reviewSummary:{awaiting:Number(review.awaiting_review??0),confirmed:Number(review.confirmed??0),noSelection:Number(review.no_selection??0),totalGoods:Number(review.total_goods??0),candidates:Number(current.random5_candidates??current.candidate_count??state.random5.candidates)}}:{})});return snapshotYingdaoState(state);}
      catch(error){patchYingdaoState(state,{error:{code:error.code??'OPERATION_FAILED',message:error.message??'YingDao 刷新失败。'}});throw error;}
      finally{patchYingdaoState(state,{loading:{...state.loading,settings:false}});render();}})();refreshPromise=operation;try{return await operation;}finally{refreshPromise=null;}}
  const controller={refresh,getState:()=>snapshotYingdaoState(state),destroy(){if(!active)return;active=false;if(yingdaoPollingTimer!==null)scheduler.clearInterval(yingdaoPollingTimer);yingdaoPollingTimer=null;root.replaceChildren();mounts.delete(root);if(currentController===controller)currentController=null;}};
  bindHandlers({elements,state,client,render});mounts.set(root,controller);currentController=controller;void refresh().catch(()=>{});yingdaoPollingTimer=scheduler.setInterval(()=>{void refresh().catch(()=>{});},Number(pollIntervalMs));return controller;
}

export async function refreshYingdaoPanel(){if(!currentController)throw coded('YINGDAO_PANEL_NOT_MOUNTED','YingDao panel 尚未挂载。');return currentController.refresh();}

function collectElements(root){const byId=id=>root.querySelector?.(`#yingdao-${id}`);return{state:byId('state'),error:byId('error'),raw:byId('raw-directory'),images:byId('image-cache-directory'),workbook:byId('workbook'),chooseRaw:byId('choose-raw'),chooseImages:byId('choose-images'),chooseWorkbook:byId('choose-workbook'),review:byId('review-link'),scan:byId('scan'),import:byId('import'),retry:byId('retry-images'),runId:byId('run-id'),sourceFiles:byId('source-files'),goods:byId('goods'),random5:byId('random5'),imageSuccess:byId('image-success'),imageFailed:byId('image-failed'),reviewAwaiting:byId('review-awaiting'),reviewConfirmed:byId('review-confirmed'),preview:byId('preview')};}
function bindHandlers({elements,state,client,render}){const settingsBody=()=>({sourceDir:elements.raw?.value??'',imageCacheDir:elements.images?.value??'',selectedWorkbookPath:elements.workbook?.value??''});
  for(const input of [elements.raw,elements.images,elements.workbook])input?.addEventListener('input',()=>{patchYingdaoState(state,{settings:settingsBody(),scanStatus:'SCAN_STALE',scanToken:null});render();});
  for(const [button,kind] of [[elements.chooseRaw,'RAW_DIRECTORY'],[elements.chooseImages,'IMAGE_CACHE_DIRECTORY'],[elements.chooseWorkbook,'ANALYSIS_WORKBOOK']])button?.addEventListener('click',()=>run('settings',state,render,async()=>client.choosePath(kind)));
  elements.scan?.addEventListener('click',()=>run('scan',state,render,async()=>{const saved=await client.saveSettings(settingsBody());patchYingdaoState(state,applySourcingPayload(state,saved));return client.scan();},'SCANNING'));
  elements.import?.addEventListener('click',()=>run('import',state,render,()=>client.startImport(state.scanToken),'IMPORTING'));
  elements.retry?.addEventListener('click',()=>run('retry',state,render,()=>client.retryFailedImages(state.currentRun),'RETRYING_FAILED_IMAGES'));
}
async function run(key,state,render,operation,busyStatus=null){patchYingdaoState(state,{loading:{...state.loading,[key]:true},error:null,...(busyStatus?{scanStatus:busyStatus}:{})});render();try{const payload=await operation();patchYingdaoState(state,applySourcingPayload(state,payload));return payload;}
  catch(error){patchYingdaoState(state,{error:{code:error.code??'OPERATION_FAILED',message:error.message??'YingDao 操作失败。'}});return null;}finally{patchYingdaoState(state,{loading:{...state.loading,[key]:false}});render();}}
function renderPreview(root,target,rows){if(!target||typeof root.ownerDocument?.createElement!=='function')return;const values=(rows??[]).map(file=>{const row=root.ownerDocument.createElement('tr');for(const value of [file.filename,file.goods_id,file.row_count,file.parse_status]){const cell=root.ownerDocument.createElement('td');cell.textContent=value??'';row.append(cell);}return row;});target.replaceChildren(...values);}
function setText(element,value){if(element)element.textContent=String(value??0);}
export function buildSourcingReviewUrl({runId,goodsId=null}={}){if(!String(runId??'').trim())return null;const query=new URLSearchParams({run_id:String(runId)});if(goodsId!==null&&goodsId!==undefined&&String(goodsId)!=='')query.set('goods_id',String(goodsId));return `/sourcing-review.html?${query}`;}
function renderReviewLink(element,runId){if(!element)return;const href=buildSourcingReviewUrl({runId});if(href){element.href=href;element.setAttribute('href',href);element.removeAttribute('aria-disabled');element.removeAttribute('tabindex');element.title='';return;}element.removeAttribute('href');element.setAttribute('aria-disabled','true');element.setAttribute('tabindex','-1');element.title='请先选择有效 Review Run';}
function coded(code,message){const error=new Error(message);error.code=code;return error;}
