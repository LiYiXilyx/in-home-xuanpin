import crypto from 'node:crypto';
import path from 'node:path';

import { SAMPLE_METHOD,sampleStableRandom5 } from './stable-random5.mjs';
import { scanYingdaoDirectory } from './yingdao-directory-scanner.mjs';

export function createYingdaoImportService({
  repository,
  loadWorkbook,
  imageStage=null,
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

    if(!imageStage) {
      return {
        run_id:importRunId,status:'RUNNING',candidate_count:model.candidates.length,selected_candidate:null,
      };
    }

    await onImages?.({ runId:importRunId,candidates:model.candidates });
    try {
      const imageResult=await imageStage({ runId:importRunId,candidates:model.candidates,repository });
      const finishedAt=now();
      repository.markImportResult(importRunId,{
        status:imageResult.status,finishedAt,qa:imageResult.qa??null,
      });
      return {
        run_id:importRunId,status:imageResult.status,candidate_count:model.candidates.length,selected_candidate:null,
      };
    } catch(error) {
      repository.markImportResult(importRunId,{
        status:'FAILED',finishedAt:now(),qa:{ error_code:error?.code??'IMAGE_STAGE_FAILED' },
      });
      throw error;
    }
  }

  return { scan,startImport };
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
