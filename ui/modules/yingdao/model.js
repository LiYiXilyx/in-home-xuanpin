const STATES=new Set(['UNCONFIGURED','READY_TO_SCAN','SCANNING','SCAN_VALID','SCAN_BLOCKED','SCAN_STALE','IMPORTING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','RETRYING_FAILED_IMAGES']);

export function deriveYingdaoControls(state={}){const status=STATES.has(state.scanStatus)?state.scanStatus:'UNCONFIGURED';const pathsLocked=['SCANNING','IMPORTING','RETRYING_FAILED_IMAGES'].includes(status);return{
  pathsLocked,canScan:!pathsLocked&&['READY_TO_SCAN','SCAN_STALE','SCAN_VALID','SCAN_BLOCKED','FAILED','COMPLETED','COMPLETED_WITH_WARNINGS'].includes(status),
  canImport:status==='SCAN_VALID',canRetry:status==='COMPLETED_WITH_WARNINGS'&&Number(state.imageCache?.failed??0)>0
};}

export function applySourcingPayload(state,payload={}){return{
  currentRun:payload.current_run_id??state.currentRun,scanStatus:payload.state??payload.import_status??state.scanStatus,
  importStatus:payload.import_status??state.importStatus,scanToken:payload.scan_token??state.scanToken,settings:payload.settings??state.settings,
  progress:{sourceFiles:Number(payload.source_files??state.progress.sourceFiles),validGoods:Number(payload.valid_goods_id??state.progress.validGoods),
    invalidFiles:Array.isArray(payload.invalid_files)?payload.invalid_files.length:Number(payload.invalid_files??state.progress.invalidFiles),parsedCandidates:Number(payload.parsed_candidates??state.progress.parsedCandidates)},
  random5:{candidates:Number(payload.random5_candidates??payload.candidate_count??state.random5.candidates)},
  imageCache:{success:Number(payload.image_success??payload.image_download_success??state.imageCache.success),failed:Number(payload.image_failed??payload.image_download_failed??state.imageCache.failed)},
  preview:payload.preview?.files??state.preview,lastRefreshedAt:new Date().toISOString()
};}
