import crypto from 'node:crypto';
import path from 'node:path';

import { SAMPLE_METHOD,sampleStableRandom5 } from './stable-random5.mjs';
import { scanYingdaoDirectory } from './yingdao-directory-scanner.mjs';

export function createYingdaoImportService({
  repository,
  loadWorkbook,
  imageStage=null,
  cacheImages=defaultCacheImages,
  imageCacheOptions={},
  workbookStage=defaultWorkbookStage,
  workbookOptions={},
  now=()=>new Date().toISOString(),
  runIdFactory=()=>crypto.randomUUID(),
  gitCommitSha=process.env.GIT_COMMIT_SHA??'UNKNOWN',
  machineName=process.env.COMPUTERNAME??process.env.HOSTNAME??'local',
}={}) {
  if(!repository) throw new TypeError('repository is required');
  const scans=new Map();

  async function scan(config) {
    const normalizedConfig=normalizeConfig(config);
    const scannedAt=now();
    const preview=await scanYingdaoDirectory({
      sourceDir:normalizedConfig.sourceDir,
      previewLimit:config.previewLimit??10,
      loadWorkbook,
      importedAt:scannedAt,
    });
    const status=isBlocked(preview)?'SCAN_BLOCKED':'SCAN_VALID';
    const scanToken=hashJson({
      sourceDir:normalizedConfig.sourceDir,
      imageCacheDir:normalizedConfig.imageCacheDir,
      selectedWorkbookPath:normalizedConfig.selectedWorkbookPath,
      sourceManifestSha256:preview.sourceManifestSha256,
      scannedAt,
    });
    scans.set(scanToken,{
      config:normalizedConfig,
      status,
      sourceManifestSha256:preview.sourceManifestSha256,
    });
    return { ...preview,status,scanToken,scannedAt };
  }

  async function startImport({ scanToken,runId=null,onStructured=null,onImages=null }={}) {
    const prior=scans.get(scanToken);
    if(!prior) throw codedError('SCAN_STALE','scan token is missing or no longer valid');
    if(prior.status!=='SCAN_VALID') throw codedError('SCAN_BLOCKED','scan preview contains blocking errors');

    const importedAt=now();
    const current=await scanYingdaoDirectory({
      sourceDir:prior.config.sourceDir,
      loadWorkbook,
      importedAt,
    });
    if(current.sourceManifestSha256!==prior.sourceManifestSha256) {
      throw codedError('SCAN_STALE','raw source manifest changed after scan preview');
    }
    if(isBlocked(current)) throw codedError('SCAN_BLOCKED','raw source is no longer parseable');

    const importRunId=runId??runIdFactory();
    const model=buildStructuredModel({
      runId:importRunId,config:prior.config,scanResult:current,importedAt,gitCommitSha,machineName,
    });
    repository.insertStructuredImport(model);
    await onStructured?.({ runId:importRunId,model });

    await onImages?.({ runId:importRunId,candidates:model.candidates });
    let fallbackErrorCode='IMAGE_STAGE_FAILED';
    try {
      const imageResult=imageStage
        ?await imageStage({ runId:importRunId,candidates:model.candidates,repository,cacheRoot:prior.config.imageCacheDir })
        :await cacheAndPersistImages({
          runId:importRunId,candidates:model.candidates,cacheRoot:prior.config.imageCacheDir,
          repository,cacheImages,imageCacheOptions,
        });
      fallbackErrorCode='WORKBOOK_STAGE_FAILED';
      const workbookQa=await runWorkbookStage({
        runId:importRunId,config:prior.config,repository,workbookStage,workbookOptions,
      });
      const finishedAt=now();
      repository.markImportResult(importRunId,{
        status:imageResult.status,finishedAt,qa:{ ...(imageResult.qa??{}),workbook:workbookQa },
      });
      return {
        run_id:importRunId,status:imageResult.status,import_status:imageResult.status,
        candidate_count:model.candidates.length,selected_candidate:null,
        image_download_success:imageResult.success??0,image_download_failed:imageResult.failed??0,
        workbook_qa:workbookQa,
      };
    } catch(error) {
      repository.markImportResult(importRunId,{
        status:'FAILED',finishedAt:now(),qa:{ error_code:error?.code??fallbackErrorCode },
      });
      throw error;
    }
  }

  async function retryFailedImages(runId) {
    const before=repository.getImport(runId);
    if(!before) throw codedError('IMPORT_NOT_FOUND',`import run not found: ${runId}`);
    if(!['COMPLETED','COMPLETED_WITH_WARNINGS'].includes(before.import_status)) {
      throw codedError('IMAGE_RETRY_NOT_ALLOWED',`import status does not allow retry: ${before.import_status}`);
    }
    const identitiesBefore=candidateIdentityManifest(before.candidates);
    const manifestBefore=before.source_manifest_sha256;
    const countBefore=before.candidate_count;
    const failedCandidates=repository.failedImages(runId);
    if(failedCandidates.length===0) {
      return { run_id:runId,retried:0,succeeded:0,failed:0,import_status:before.import_status };
    }

    const retryCandidates=failedCandidates.map(repositoryCandidateToImageCandidate);
    const cached=await cacheImages(retryCandidates,{
      cacheRoot:before.image_cache_dir,
      ...imageCacheOptions,
    });
    persistImageResults(repository,runId,cached.results);
    const afterImages=repository.getImport(runId);
    assertRetryInvariants({ before,after:afterImages,identitiesBefore,manifestBefore,countBefore });
    const remaining=repository.failedImages(runId).length;
    const importStatus=remaining===0?'COMPLETED':'COMPLETED_WITH_WARNINGS';
    let workbookQa;
    try {
      workbookQa=await runWorkbookStage({
        runId,config:{ imageCacheDir:before.image_cache_dir,selectedWorkbookPath:before.selected_workbook_path },
        repository,workbookStage,workbookOptions,
      });
      repository.markImportResult(runId,{
        status:importStatus,finishedAt:now(),
        qa:{ retried:failedCandidates.length,succeeded:cached.success,failed:cached.failed,remaining_failed:remaining,workbook:workbookQa },
      });
    } catch(error) {
      repository.markImportResult(runId,{
        status:'FAILED',finishedAt:now(),qa:{ error_code:error?.code??'WORKBOOK_STAGE_FAILED' },
      });
      throw error;
    }
    const after=repository.getImport(runId);
    assertRetryInvariants({ before,after,identitiesBefore,manifestBefore,countBefore });
    return {
      run_id:runId,retried:failedCandidates.length,succeeded:cached.success,failed:cached.failed,
      remaining_failed:remaining,import_status:importStatus,workbook_qa:workbookQa,
    };
  }

  return { scan,startImport,retryFailedImages };
}

async function runWorkbookStage({ runId,config,repository,workbookStage,workbookOptions }) {
  const imported=repository.getImport(runId);
  if(!imported) throw codedError('IMPORT_NOT_FOUND',`import run not found: ${runId}`);
  return workbookStage({
    selectedWorkbookPath:config.selectedWorkbookPath,
    candidates:imported.candidates,
    cacheRoot:config.imageCacheDir,
    ...workbookOptions,
  });
}

async function cacheAndPersistImages({ runId,candidates,cacheRoot,repository,cacheImages,imageCacheOptions }) {
  const cached=await cacheImages(candidates,{ cacheRoot,...imageCacheOptions });
  persistImageResults(repository,runId,cached.results);
  const status=cached.failed>0?'COMPLETED_WITH_WARNINGS':'COMPLETED';
  return {
    ...cached,status,
    qa:{ image_download_success:cached.success,image_download_failed:cached.failed },
  };
}

function persistImageResults(repository,runId,results) {
  for(const result of results) repository.updateImageResult(runId,{
    temuGoodsId:result.temu_goods_id,
    productId:result['1688_product_id'],
  },{
    status:result.image_download_status,
    localPath:result['1688_image_local_path'],
    downloadedAt:result.image_downloaded_at,
    imageSha256:result.image_sha256,
    responseSha256:result.image_response_sha256,
  });
}

function repositoryCandidateToImageCandidate(candidate) {
  return {
    temu_goods_id:String(candidate.temu_goods_id),
    '1688_product_id':String(candidate.supplier_product_id),
    '1688_image_url':candidate.supplier_image_url,
    '1688_image_local_path':candidate.supplier_image_local_path,
    image_download_status:candidate.image_download_status,
    image_downloaded_at:candidate.image_downloaded_at,
    image_sha256:candidate.image_sha256,
    image_response_sha256:candidate.image_response_sha256,
  };
}

function candidateIdentityManifest(candidates) {
  return JSON.stringify(candidates.map(candidate=>[
    candidate.run_id,candidate.temu_goods_id,candidate.candidate_rank,candidate.original_rank,
    candidate.supplier_product_id,candidate.sample_seed,candidate.sample_method,candidate.selected_candidate,
  ]));
}

function assertRetryInvariants({ after,identitiesBefore,manifestBefore,countBefore }) {
  if(after.candidate_count!==countBefore) throw codedError('IMAGE_RETRY_INVARIANT','candidate count changed during retry');
  if(after.source_manifest_sha256!==manifestBefore) throw codedError('IMAGE_RETRY_INVARIANT','source manifest changed during retry');
  if(candidateIdentityManifest(after.candidates)!==identitiesBefore) {
    throw codedError('IMAGE_RETRY_INVARIANT','Random5 candidate identity or order changed during retry');
  }
}

function buildStructuredModel({ runId,config,scanResult,importedAt,gitCommitSha,machineName }) {
  const rowsByGoods=new Map();
  for(const candidate of scanResult.candidates) {
    const goodsId=String(candidate.temu_goods_id);
    const rows=rowsByGoods.get(goodsId)??[];
    rows.push(candidate);
    rowsByGoods.set(goodsId,rows);
  }

  const candidates=[];
  const sampledCountByGoods=new Map();
  for(const [goodsId,rows] of rowsByGoods) {
    const first=sampleStableRandom5(goodsId,rows);
    const repeated=sampleStableRandom5(goodsId,structuredClone(rows));
    if(JSON.stringify(first)!==JSON.stringify(repeated)) {
      throw codedError('RANDOM5_NOT_REPRODUCIBLE',`Random5 differs for goods_id ${goodsId}`);
    }
    candidates.push(...first);
    sampledCountByGoods.set(goodsId,first.length);
  }

  const files=scanResult.files.map(file=>{
    const goodsId=String(file.temu_goods_id);
    return {
      temu_goods_id:goodsId,
      filename:file.filename,
      source_export_file:file.filename,
      file_sha256:file.fileSha256,
      row_count:(rowsByGoods.get(goodsId)??[]).length,
      parse_status:'PARSED',
      parse_error:null,
    };
  });
  const items=files.map(file=>({
    temu_goods_id:file.temu_goods_id,
    temu_title:null,
    temu_image_path:null,
    source_export_file:file.source_export_file,
    source_file_sha256:file.file_sha256,
    source_candidate_count:file.row_count,
    sampled_count:sampledCountByGoods.get(file.temu_goods_id)??0,
    temu_context_status:'MISSING',
  }));

  return {
    run:{
      runId,gitCommitSha,machineName,startedAt:importedAt,importedAt,
      sourceDir:config.sourceDir,sourceFileCount:scanResult.sourceExportFiles,
      sourceManifestSha256:scanResult.sourceManifestSha256,
      imageCacheDir:config.imageCacheDir,selectedWorkbookPath:config.selectedWorkbookPath,
      sampleMethod:SAMPLE_METHOD,
    },
    files,items,candidates,
  };
}

function normalizeConfig(config) {
  if(!config?.sourceDir) throw new TypeError('sourceDir is required');
  return {
    sourceDir:path.resolve(config.sourceDir),
    imageCacheDir:config.imageCacheDir?path.resolve(config.imageCacheDir):null,
    selectedWorkbookPath:config.selectedWorkbookPath?path.resolve(config.selectedWorkbookPath):null,
  };
}

function isBlocked(result) {
  return result.sourceExportFiles===0 || result.invalidFiles.length>0 || result.duplicateGoodsId.length>0 ||
    result.failedFiles.length>0 || result.parsedFiles!==result.sourceExportFiles;
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
}

function codedError(code,message) {
  const error=new Error(`${code}: ${message}`);
  error.code=code;
  return error;
}

async function defaultCacheImages(...args) {
  const {cacheRandom5Images}=await import('./supplier-image-cache.mjs');
  return cacheRandom5Images(...args);
}

async function defaultWorkbookStage(...args) {
  const {writeRandom5Sheet}=await import('./random5-workbook.mjs');
  return writeRandom5Sheet(...args);
}
