import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadArtifactTool } from '../../modules/analysis/artifact-runtime.mjs';

export const SOURCING_STATES=Object.freeze([
  'UNCONFIGURED','READY_TO_SCAN','SCANNING','SCAN_VALID','SCAN_BLOCKED','SCAN_STALE','IMPORTING',
  'COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','RETRYING_FAILED_IMAGES',
]);

export function createSourcingController({service,repository,settingsStore,pathDialog,validateWorkbook=validateExistingWorkbook,validatePaths=validateConfiguredPaths,runIdFactory=()=>crypto.randomUUID()}={}) {
  if(!service||!repository||!settingsStore||!pathDialog) throw new TypeError('sourcing controller dependencies are required');
  let state='UNCONFIGURED',scanToken=null,scanResult=null,currentRunId=null,busy=false,loadedSettings=null,settingsLoadPromise=null;

  async function getSettings() {
    const settings=await ensureSettings();
    if(state==='UNCONFIGURED'&&configured(settings)) state='READY_TO_SCAN';
    return {settings,state,scan_token:scanToken,current_run_id:currentRunId,...metrics(scanResult)};
  }
  async function saveSettings(input={}) {
    if(busy) throw coded('IMPORT_IN_PROGRESS','paths cannot change during import or retry');
    busy=true;
    try { return await persistSettings(input); }
    finally { busy=false; }
  }
  async function persistSettings(input={}) {
    const previous=await ensureSettings();
    const next=await settingsStore.save({...previous,...pickSettings(input)});
    const changed=JSON.stringify(next)!==JSON.stringify(previous);
    loadedSettings=next;
    if(changed) {
      const hadCurrentScan=Boolean(scanToken||scanResult);
      scanToken=null;scanResult=null;
      state=!configured(next)?'UNCONFIGURED':hadCurrentScan?'SCAN_STALE':'READY_TO_SCAN';
    } else if(!configured(next)) state='UNCONFIGURED';
    return {settings:next,state,scan_token:scanToken};
  }
  async function choosePath({kind}={}) {
    if(busy) throw coded('IMPORT_IN_PROGRESS','paths cannot change during import or retry');
    busy=true;
    try {
      const settings=await ensureSettings();
      const key=keyForKind(kind);
      const result=await pathDialog({kind,currentPath:settings[key]});
      if(result.cancelled) return { ...result,settings,state };
      const saved=await persistSettings({[key]:result.path});
      return { ...result,...saved };
    } finally { busy=false; }
  }
  async function scan() {
    if(busy) throw coded('IMPORT_IN_PROGRESS','scan is disabled during import or retry');
    busy=true;state='SCANNING';
    try {
      const settings=await ensureSettings();
      assertConfigured(settings);
      const canonicalSettings=await validatePaths(settings);
      await validateWorkbook(canonicalSettings.selectedWorkbookPath);
      const result=await service.scan(canonicalSettings);
      scanResult=previewModel(result);
      scanToken=result.scanToken;
      state=result.status;
      return { ...scanResult,state,scan_token:scanToken };
    } catch(error) { state=blockingConfigurationError(error)?'SCAN_BLOCKED':'FAILED';throw error; }
    finally { busy=false; }
  }
  async function startImport({scanToken:providedToken,runId=null}={}) {
    if(busy) throw coded('IMPORT_IN_PROGRESS','an import is already running');
    if(state!=='SCAN_VALID'||!scanToken||providedToken!==scanToken) throw coded('SCAN_STALE','a current SCAN_VALID token is required');
    const previousCurrentRunId=currentRunId;
    busy=true;state='IMPORTING';currentRunId=runId??runIdFactory();
    try {
      const result=await service.startImport({scanToken,runId:currentRunId});
      state=result.import_status??result.status;
      return currentModel(result);
    } catch(error) {
      if(/run_id 已存在|UNIQUE constraint failed: sourcing_runs\.run_id/.test(error?.message??'')) {
        currentRunId=previousCurrentRunId;state='SCAN_VALID';throw coded('RUN_ID_CONFLICT','run_id already exists and cannot be started twice');
      }
      state=error?.code==='SCAN_STALE'?'SCAN_STALE':'FAILED';throw error;
    }
    finally { busy=false; }
  }
  async function currentImport() {
    if(!currentRunId) return {state,current_run_id:null,...metrics(scanResult)};
    const imported=repository.getImport(currentRunId);
    return imported?importModel(imported,state):{state,current_run_id:currentRunId,...metrics(scanResult)};
  }
  async function getImport(runId) {
    const imported=repository.getImport(runId);
    if(!imported) throw coded('IMPORT_NOT_FOUND',`import run not found: ${runId}`);
    return importModel(imported,runId===currentRunId?state:imported.import_status);
  }
  async function retryFailedImages(runId) {
    if(busy) throw coded('IMPORT_IN_PROGRESS','an import or retry is already running');
    const before=repository.getImport(runId);
    if(!before) throw coded('IMPORT_NOT_FOUND',`import run not found: ${runId}`);
    if(before.import_status!=='COMPLETED_WITH_WARNINGS'||before.failed_image_count<1) throw coded('IMAGE_RETRY_NOT_ALLOWED','only warning runs with failed images may retry');
    busy=true;currentRunId=runId;state='RETRYING_FAILED_IMAGES';
    try { const result=await service.retryFailedImages(runId);state=result.import_status;return currentModel(result); }
    catch(error) { state='FAILED';throw error; }
    finally { busy=false; }
  }
  return {settings:getSettings,saveSettings,choosePath,scan,startImport,currentImport,getImport,retryFailedImages};

  async function ensureSettings() {
    if(loadedSettings)return loadedSettings;
    settingsLoadPromise??=settingsStore.load();
    const loaded=await settingsLoadPromise;
    loadedSettings??=loaded;
    return loadedSettings;
  }
}

export async function validateExistingWorkbook(workbookPath,{artifact=null}={}) {
  if(!workbookPath||path.extname(workbookPath).toLowerCase()!=='.xlsx') throw coded('WORKBOOK_EXTENSION','an existing .xlsx workbook is required');
  const stat=await fs.stat(workbookPath).catch(()=>null);
  if(!stat?.isFile()) throw coded('WORKBOOK_NOT_FOUND','analysis workbook does not exist');
  await fs.access(workbookPath,fs.constants.R_OK|fs.constants.W_OK).catch(()=>{throw coded('WORKBOOK_NOT_WRITABLE','analysis workbook must be readable and writable');});
  await fs.access(path.dirname(workbookPath),fs.constants.W_OK).catch(()=>{throw coded('WORKBOOK_NOT_WRITABLE','analysis workbook directory must be writable for atomic replacement');});
  try {
    const tools=artifact??await loadArtifactTool();
    const workbook=await tools.SpreadsheetFile.importXlsx(await tools.FileBlob.load(workbookPath));
    if(!workbook.worksheets.items.some(sheet=>sheet.name==='05_细分商品明细')) throw coded('WORKBOOK_SHEET05_REQUIRED','analysis workbook must contain 05_细分商品明细');
    return {valid:true};
  } catch(error) {
    if(error?.code?.startsWith?.('WORKBOOK_')) throw error;
    throw coded('WORKBOOK_MALFORMED',error?.message??'analysis workbook is malformed');
  }
}

export async function validateConfiguredPaths({sourceDir,imageCacheDir,selectedWorkbookPath}) {
  const raw=await existingDirectory(sourceDir,'RAW_DIRECTORY_INVALID',fs.constants.R_OK);
  let cache=await canonicalTarget(imageCacheDir);
  const workbook=await fs.realpath(selectedWorkbookPath).catch(()=>path.resolve(selectedWorkbookPath));
  if(raw===cache||inside(raw,cache)||inside(cache,raw)) throw coded('SOURCE_CACHE_OVERLAP','raw and image cache directories must be separate and non-overlapping');
  if(inside(raw,workbook)||raw===workbook) throw coded('WORKBOOK_RAW_OVERLAP','analysis workbook cannot be inside the raw evidence directory');
  await fs.mkdir(cache,{recursive:true});
  cache=await existingDirectory(cache,'IMAGE_CACHE_DIRECTORY_INVALID',fs.constants.R_OK|fs.constants.W_OK);
  return {sourceDir:raw,imageCacheDir:cache,selectedWorkbookPath:workbook};
}

function previewModel(result) {
  const counts=new Map();
  for(const candidate of result.candidates??[]) counts.set(String(candidate.temu_goods_id),(counts.get(String(candidate.temu_goods_id))??0)+1);
  const failed=new Map((result.failedFiles??[]).map(file=>[file.filename,file]));
  const files=(result.files??result.preview??[]).slice(0,10).map(file=>({
    filename:file.filename,goods_id:String(file.temu_goods_id),row_count:counts.get(String(file.temu_goods_id))??0,
    parse_status:failed.has(file.filename)?'FAILED':'PARSED',
  }));
  return {
    source_files:result.sourceExportFiles,valid_goods_id:result.uniqueTemuGoodsId,
    invalid_files:result.invalidFiles??[],duplicate_goods_id:result.duplicateGoodsId??[],
    parsed_candidates:result.totalSourceCandidates,random5_candidates:sumRandom5(counts),
    source_manifest_sha256:result.sourceManifestSha256,preview:{files},
  };
}
function metrics(scan) { return scan??{source_files:0,valid_goods_id:0,invalid_files:[],parsed_candidates:0,random5_candidates:0,preview:{files:[]}}; }
function currentModel(result) { return {
  state:result.import_status??result.status,current_run_id:result.run_id,...result,
  image_success:result.image_success??result.image_download_success??result.succeeded??0,
  image_failed:result.image_failed??result.image_download_failed??result.remaining_failed??result.failed??0,
}; }
function importModel(run,state) {
  const ids=(run.candidates??[]).map(row=>({temu_goods_id:String(row.temu_goods_id),product_id:String(row.supplier_product_id),random_sample_rank:row.candidate_rank,original_rank:row.original_rank}));
  return {state,current_run_id:run.run_id,run_id:run.run_id,source_dir:run.source_dir,image_cache_dir:run.image_cache_dir,
    workbook_path:run.selected_workbook_path,manifest:run.source_manifest_sha256,candidate_count:run.candidate_count,
    image_success:(run.candidates??[]).filter(row=>row.image_download_status==='SUCCESS').length,
    image_failed:run.failed_image_count??0,qa_status:run.qa_json??null,sampled_product_ids:ids};
}
function sumRandom5(counts) { let total=0;for(const count of counts.values()) total+=Math.min(5,count);return total; }
function pickSettings(value) {
  const result={};
  for(const key of ['sourceDir','imageCacheDir','selectedWorkbookPath']) if(Object.hasOwn(value,key)) result[key]=value[key]??null;
  return result;
}
function configured(value) { return Boolean(value?.sourceDir&&value?.imageCacheDir&&value?.selectedWorkbookPath); }
function assertConfigured(value) { if(!configured(value)) throw coded('SOURCING_UNCONFIGURED','all three paths are required'); }
function keyForKind(kind) { return ({RAW_DIRECTORY:'sourceDir',IMAGE_CACHE_DIRECTORY:'imageCacheDir',ANALYSIS_WORKBOOK:'selectedWorkbookPath'})[kind]??(()=>{throw coded('PATH_DIALOG_KIND','invalid path kind');})(); }
async function existingDirectory(value,code,mode) {
  const resolved=await fs.realpath(value).catch(()=>null);const stat=resolved?await fs.stat(resolved).catch(()=>null):null;
  if(!stat?.isDirectory()) throw coded(code,`${value} must be an existing directory`);
  await fs.access(resolved,mode).catch(()=>{throw coded(code,`${value} has insufficient permissions`);});return resolved;
}
async function canonicalTarget(value) {
  const absolute=path.resolve(value);let cursor=absolute;const suffix=[];
  while(true) {
    const real=await fs.realpath(cursor).catch(()=>null);
    if(real)return path.join(real,...suffix.reverse());
    const parent=path.dirname(cursor);if(parent===cursor)throw coded('IMAGE_CACHE_DIRECTORY_INVALID',`${value} has no existing parent`);
    suffix.push(path.basename(cursor));cursor=parent;
  }
}
function inside(parent,child) { const relative=path.relative(parent,child);return Boolean(relative)&&!relative.startsWith('..')&&!path.isAbsolute(relative); }
function blockingConfigurationError(error) { return ['RAW_DIRECTORY_INVALID','IMAGE_CACHE_DIRECTORY_INVALID','SOURCE_CACHE_OVERLAP','WORKBOOK_RAW_OVERLAP','WORKBOOK_EXTENSION','WORKBOOK_NOT_FOUND','WORKBOOK_NOT_WRITABLE','WORKBOOK_SHEET05_REQUIRED','WORKBOOK_MALFORMED'].includes(error?.code); }
function coded(code,message) { const error=new Error(`${code}: ${message}`);error.code=code;return error; }
