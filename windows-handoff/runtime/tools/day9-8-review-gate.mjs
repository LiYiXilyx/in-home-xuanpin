import { loadConfig } from '../src/config.mjs';
import { prepareReviewSampleGate } from '../src/modules/reviews/review-sample-gate.mjs';

const args=parseArgs(process.argv.slice(2));
const config=await loadConfig(args.config);
const result=await prepareReviewSampleGate(config,{ samplePath:args.sample,gate:args.gate });
console.log(JSON.stringify(result,null,2));

function parseArgs(argv) {
  const result={ config:'config.json',sample:'outputs/new-1000-product-insight-20260826/recommended-review-sample-50.json',gate:'R1' };
  for (let index=0;index<argv.length;index+=1) {
    if (argv[index]==='--config') result.config=argv[++index];
    else if (argv[index]==='--sample') result.sample=argv[++index];
    else if (argv[index]==='--gate') result.gate=String(argv[++index] ?? '').toUpperCase();
    else throw new Error(`未知参数：${argv[index]}`);
  }
  return result;
}
