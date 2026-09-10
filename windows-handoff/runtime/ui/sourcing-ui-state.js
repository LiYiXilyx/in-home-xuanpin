export const SOURCING_STATES=new Set(['UNCONFIGURED','READY_TO_SCAN','SCANNING','SCAN_VALID','SCAN_BLOCKED','SCAN_STALE','IMPORTING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','RETRYING_FAILED_IMAGES']);

export function sourcingControls({state,imageFailed=0}={}) {
  const normalized=SOURCING_STATES.has(state)?state:'UNCONFIGURED';
  const pathsLocked=['SCANNING','IMPORTING','RETRYING_FAILED_IMAGES'].includes(normalized);
  return {
    pathsLocked,canScan:!pathsLocked&&['READY_TO_SCAN','SCAN_STALE','SCAN_VALID','SCAN_BLOCKED','FAILED','COMPLETED','COMPLETED_WITH_WARNINGS'].includes(normalized),
    canImport:normalized==='SCAN_VALID',canRetry:normalized==='COMPLETED_WITH_WARNINGS'&&Number(imageFailed)>0,
  };
}
