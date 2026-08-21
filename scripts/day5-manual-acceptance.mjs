import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob,SpreadsheetFile } from '@oai/artifact-tool';
import { loadConfig } from '../src/config/load.mjs';
import { DEFAULT_WORKBOOK_NAME } from '../src/modules/export/export-service.mjs';
import { findLatestValidWorkbook } from '../src/modules/export/manual-values.mjs';

const config=await loadConfig(process.argv[2] ?? 'config.json');
const fixedPath=path.join(config.export.outputDir,DEFAULT_WORKBOOK_NAME);
const workbookPath=await findLatestValidWorkbook(config.export.outputDir,fixedPath);
if (!workbookPath) throw new Error('没有找到 Day 5 Excel。');
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheet=workbook.worksheets.getItem('商品池');
const values=sheet.getUsedRange(true)?.values ?? [];
const headers=values[0] ?? [];
const indexes={
  rank:headers.indexOf('Top Sales rank'),goods:headers.indexOf('goods_id'),
  classification:headers.indexOf('初步分类'),note:headers.indexOf('人工备注')
};
const targets=[1,150,300];
const acceptance=[];
for (const rank of targets) {
  const rowIndex=values.findIndex((row,index) => index > 0 && Number(row[indexes.rank]) === rank);
  if (rowIndex < 1) throw new Error(`Excel 中没有 rank ${rank}`);
  const goodsId=String(values[rowIndex][indexes.goods]);
  const classification=`人工分类-${rank}`;
  const note=`Day5人工备注-${rank}-${goodsId}`;
  sheet.getCell(rowIndex,indexes.classification).values=[[classification]];
  sheet.getCell(rowIndex,indexes.note).values=[[note]];
  acceptance.push({ rank,goods_id:goodsId,classification,note });
}
const output=await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
const acceptancePath=path.join(config.export.outputDir,'day5-manual-acceptance.json');
await fs.writeFile(acceptancePath,JSON.stringify(acceptance,null,2),'utf8');
console.log(JSON.stringify({ workbookPath,acceptancePath,acceptance },null,2));
