import { applyBody,applyHeader,columnLetter } from '../workbook.mjs';

export const QUALITY_HEADERS=['job_id','metric_name','actual','threshold','passed','problem samples','checked_at'];

export function buildQualitySheet(sheet,qualityRows) {
  sheet.getRange('A1:G1').values=[QUALITY_HEADERS];
  applyHeader(sheet.getRange('A1:G1'));
  if (qualityRows.length) {
    const last=qualityRows.length+1;
    sheet.getRange(`A2:G${last}`).values=qualityRows.map(row => [
      row.job_id,row.metric_name,numberOrBlank(row.actual),numberOrBlank(row.threshold),row.passed ? 'PASS' : 'FAIL',
      row.problem_samples,toDate(row.checked_at)
    ]);
    applyBody(sheet.getRange(`A2:G${last}`));
    sheet.getRange(`C2:D${last}`).format.numberFormat='0.000';
    sheet.getRange(`G2:G${last}`).format.numberFormat='yyyy-mm-dd hh:mm';
    sheet.getRange(`F2:F${last}`).format.wrapText=true;
    sheet.getRange(`E2:E${last}`).conditionalFormats.add('containsText',{ text:'FAIL',format:{ fill:'#FFC7CE',font:{ color:'#9C0006',bold:true } } });
    const table=sheet.tables.add(`A1:G${last}`,true,'TemuDataQuality');
    table.style='TableStyleMedium2';table.showFilterButton=true;
  }
  [38,32,14,14,12,50,22].forEach((width,index) => { sheet.getRange(`${columnLetter(index+1)}:${columnLetter(index+1)}`).format.columnWidth=width; });
  sheet.freezePanes.freezeRows(1);
}
function numberOrBlank(value) { return value === null || value === undefined ? null : Number(value); }
function toDate(value) { const date=value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
