import { loadConfig } from '../src/config/load.mjs';
import { runExportCommand,runExportQaCommand } from '../src/app/commands/export.mjs';

const args=parseArgs(process.argv);
const config=await loadConfig(args.config);
const options={ jobId:args.jobId,output:args.output,sortDirection:args.sortDirection };
try {
  if (args.qa) await runExportQaCommand(config,options);
  else await runExportCommand(config,options);
} catch (error) {
  console.error(`报表生成失败：${error.stack ?? error.message}`);
  process.exitCode=1;
}

function parseArgs(argv) {
  const result={ config:'config.json',jobId:null,output:null,sortDirection:'asc',qa:false };
  for (let index=2;index<argv.length;index+=1) {
    if (argv[index] === '--config') result.config=argv[++index];
    else if (argv[index] === '--job') result.jobId=argv[++index];
    else if (argv[index] === '--output') result.output=argv[++index];
    else if (argv[index] === '--sort') result.sortDirection=argv[++index];
    else if (argv[index] === '--qa' || argv[index] === '--render') result.qa=true;
  }
  return result;
}
