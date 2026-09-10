import path from 'node:path';

export function sourcingRuntimePaths({projectRoot=process.cwd(),runId=null}={}){
  const runtimeRoot=path.join(projectRoot,'runtime','1688'),outputRoot=path.join(projectRoot,'outputs','1688-sourcing'),handoffRoot=path.join(projectRoot,'handoff');
  return {projectRoot,runtimeRoot,inputRoot:path.join(runtimeRoot,'input'),locksRoot:path.join(runtimeRoot,'locks'),outputRoot,handoffRoot,
    inputDir:runId?path.join(runtimeRoot,'input',runId):null,lockPath:runId?path.join(runtimeRoot,'locks',`${runId}.lock`):null,
    runOutputDir:runId?path.join(outputRoot,runId):null,resultZip:runId?path.join(handoffRoot,`${runId}-result.zip`):null};
}
