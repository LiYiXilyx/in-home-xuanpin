import fs from 'node:fs/promises';
import path from 'node:path';
import { loadArtifactTool } from '../../src/modules/analysis/artifact-runtime.mjs';
import { YINGDAO_INPUT_HEADERS,YINGDAO_OUTPUT_HEADERS } from '../../src/modules/sourcing/sourcing-1688.mjs';

const outputDir=path.resolve('outputs/1688-sourcing-v1');const tools=await loadArtifactTool();
const input=await tools.SpreadsheetFile.importXlsx(await tools.FileBlob.load(path.join(outputDir,'yingdao-input.xlsx')));
const output=await tools.SpreadsheetFile.importXlsx(await tools.FileBlob.load(path.join(outputDir,'yingdao-output.xlsx')));
const formal=await tools.SpreadsheetFile.importXlsx(await tools.FileBlob.load(path.join(outputDir,'opportunity-analysis-with-1688.xlsx')));
const inputValues=input.worksheets.getItem('任务').getUsedRange(true)?.values??[];
const outputValues=output.worksheets.getItem('1688候选').getUsedRange(true)?.values??[];
const detail=formal.worksheets.getItem('05_细分商品明细'),detailValues=detail.getUsedRange(true)?.values??[],headers=detailValues[0]??[];
const indexes=Object.fromEntries(headers.map((header,index)=>[header,index]));const detailRows=detailValues.slice(1).filter(row=>String(row[indexes.goods_id]??'').trim());
const requiredSourcingHeaders=['Temu主图','1688匹配主图','1688匹配状态','1688标题','1688价格RMB','1688最低价RMB','1688最高价RMB','1688价格EUR','1688最低价EUR','1688最高价EUR','MOQ','1688店铺','图片相似度','标题相似度','类目相似度','综合匹配度','1688链接','人工确认','寻源备注'];
const allFormulaText=[input,output,formal].flatMap(workbook=>workbook.worksheets.items.flatMap(sheet=>(sheet.getUsedRange(true)?.formulas??[]).flat())).join('\n');
const checks={
  inputSheet:input.worksheets.items.length===1&&input.worksheets.items[0].name==='任务',
  inputHeaders:JSON.stringify(inputValues[0])===JSON.stringify(YINGDAO_INPUT_HEADERS),inputRows:inputValues.length-1===3,
  outputSheet:output.worksheets.items.length===1&&output.worksheets.items[0].name==='1688候选',
  outputHeaders:JSON.stringify(outputValues[0])===JSON.stringify(YINGDAO_OUTPUT_HEADERS),outputRows:outputValues.length-1===15,
  fiveRanksPerGoods:[...new Set(outputValues.slice(1).map(row=>String(row[1])))].every(id=>outputValues.slice(1).filter(row=>String(row[1])===id).map(row=>Number(row[4])).join(',')==='1,2,3,4,5'),
  formalDetailRows:detailRows.length===2135,formalUniqueGoods:new Set(detailRows.map(row=>String(row[indexes.goods_id]).replace(/^'/,''))).size===2135,
  sourcingHeaders:requiredSourcingHeaders.every(header=>indexes[header]>=0),adjacentImages:indexes['Temu主图']+1===indexes['1688匹配主图'],
  noFakeSupplierValues:detailRows.every(row=>row[indexes['1688匹配状态']]==='NOT_SEARCHED'&&!row[indexes['1688标题']]&&!row[indexes['1688价格RMB']]&&!row[indexes['1688链接']]),
  noSupplierImages:(detail.images.items??[]).every(image=>Number(image.anchor?.from?.col)===1),formulaErrors:!/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/.test(allFormulaText),
};
const report={pass:Object.values(checks).every(Boolean),checks,counts:{inputGoods:inputValues.length-1,outputTemplateRows:outputValues.length-1,
  formalRows:detailRows.length,temuImages:(detail.images.items??[]).length,supplierImages:(detail.images.items??[]).filter(image=>Number(image.anchor?.from?.col)===2).length},
  renderVerification:{artifactTool:'UNAVAILABLE_PROCESS_EXIT_REPRODUCED',excelCom:'UNAVAILABLE_NOT_INSTALLED',fallback:'STRUCTURE_STYLE_AND_MANUAL_IMAGE_QA'}};
await fs.writeFile(path.join(outputDir,'sourcing-artifacts-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
