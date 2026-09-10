import { sourcingRuntimePaths } from '../../src/modules/sourcing/runtime-paths.mjs';
import { packRunResult } from '../../src/modules/sourcing/result-package.mjs';
const index=process.argv.indexOf('--run-id'),runId=index>=0?process.argv[index+1]:null;if(!runId)throw new Error('缺少 --run-id。');const paths=sourcingRuntimePaths({runId});console.log(JSON.stringify(packRunResult({runDir:paths.runOutputDir,outputPath:paths.resultZip}),null,2));
