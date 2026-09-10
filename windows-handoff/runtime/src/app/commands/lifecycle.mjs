import { runLifecycleAnalysis } from '../../modules/analysis/lifecycle-service.mjs';
import { runLifecycleQa } from '../../modules/analysis/lifecycle-qa.mjs';

export async function runLifecycleCommand(config,options={}) {
  const result=await runLifecycleAnalysis(config,options);console.log(JSON.stringify(result,null,2));return result;
}

export async function runLifecycleQaCommand(config,options={}) {
  const result=await runLifecycleQa(config,options);console.log(JSON.stringify(result,null,2));return result;
}
