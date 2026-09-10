import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMachineEnvironment } from '../../src/modules/sourcing/machine-role.mjs';
import { runnerPreflight,initializeRunnerSession } from '../../src/modules/sourcing/runner-service.mjs';

function args(argv){const out={preflightOnly:false};for(let i=2;i<argv.length;i++){const value=argv[i];if(value==='--preflight-only')out.preflightOnly=true;else if(value==='--run-id')out.runId=argv[++i];else if(value==='--target')out.target=Number(argv[++i]);else if(value==='--temu-db')out.temuDbPath=argv[++i];else throw new Error(`未知参数：${value}`);}if(!out.runId||!out.target)throw new Error('用法：--run-id <run_id> --target <1..20> [--preflight-only]');return out;}

if(path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
  try{loadMachineEnvironment();const options=args(process.argv);options.temuDbPath=options.temuDbPath??process.env.TEMU_DB_PATH??'./data/temu_research_v2.db';const result=options.preflightOnly?await runnerPreflight(options):await initializeRunnerSession(options);console.log(JSON.stringify(result,null,2));}
  catch(error){console.error(error.stack??error);process.exitCode=1;}
}
