import { Workbook } from '@oai/artifact-tool';

export const SHEET_NAMES=['商品池','数据质量','任务记录','字段说明'];

export function createOperationsWorkbook() {
  const workbook=Workbook.create();
  const sheets=Object.fromEntries(SHEET_NAMES.map(name => [name,workbook.worksheets.add(name)]));
  for (const sheet of Object.values(sheets)) sheet.showGridLines=false;
  return { workbook,sheets };
}

export function applyHeader(range) {
  range.format={
    fill:'#17365D',font:{ bold:true,color:'#FFFFFF',size:11 },
    verticalAlignment:'center',horizontalAlignment:'center',wrapText:true,
    borders:{ preset:'outside',style:'thin',color:'#95B3D7' }
  };
  range.format.rowHeight=34;
}

export function applyBody(range) {
  range.format={
    font:{ color:'#1F2937',size:10 },verticalAlignment:'center',
    borders:{ insideHorizontal:{ style:'thin',color:'#E5E7EB' } }
  };
}

export function columnLetter(number) {
  let result='';
  for (let n=number;n>0;n=Math.floor((n-1)/26)) result=String.fromCharCode(65+((n-1)%26))+result;
  return result;
}

export function excelString(value) { return String(value).replaceAll('"','""'); }
