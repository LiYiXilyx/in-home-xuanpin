import { exportOperationsWorkbook,runExportQa } from '../../modules/export/export-service.mjs';

export async function runExportCommand(config,options={}) {
  const result=await exportOperationsWorkbook(config,options);
  console.log(JSON.stringify(result,null,2));
  return result;
}
export async function runExportQaCommand(config,options={}) {
  const result=await runExportQa(config,options);
  console.log(JSON.stringify(result,null,2));
  return result;
}
