import { runMarketAnalysis } from '../../modules/analysis/market-analysis-service.mjs';
import { runMarketAnalysisQa } from '../../modules/analysis/market-analysis-qa.mjs';

export async function runAnalyzeMarketCommand(config,options={}) {
  const result=await runMarketAnalysis(config,options);
  console.log(JSON.stringify(result,null,2));
  return result;
}

export async function runMarketQaCommand(config,options={}) {
  const result=await runMarketAnalysisQa(config,options);
  console.log(JSON.stringify(result,null,2));
  return result;
}
