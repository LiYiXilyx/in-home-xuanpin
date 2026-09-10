import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMachineEnvironment } from '../../src/modules/sourcing/machine-role.mjs';
import { run1688Probe } from '../../src/modules/sourcing/probe-service.mjs';

export function parseProbeArgs(argv){
  const options={};
  for(let index=2;index<argv.length;index+=1){
    const value=argv[index];
    if(value==='--run-id')options.runId=argv[++index];
    else if(value==='--cdp-endpoint')options.cdpEndpoint=argv[++index];
    else throw new Error(`未知参数：${value}`);
  }
  if(!options.runId)throw new Error('用法：--run-id <run_id> [--cdp-endpoint <CHROME_CDP_ENDPOINT>]');
  return options;
}

if(path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
  try{
    loadMachineEnvironment();
    const options=parseProbeArgs(process.argv);
    const result=await run1688Probe(options);
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.stack??error);process.exitCode=1;}
}
