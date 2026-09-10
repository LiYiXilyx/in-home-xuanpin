import { applyBody,applyHeader,columnLetter } from '../workbook.mjs';

export const JOB_HEADERS=['job_id','job_type','target_count','start','end','status','discovered','processed','success','failed','resume_count','error summary'];

export function buildJobsSheet(sheet,jobs) {
  sheet.getRange('A1:L1').values=[JOB_HEADERS];
  applyHeader(sheet.getRange('A1:L1'));
  if (jobs.length) {
    const last=jobs.length+1;
    sheet.getRange(`A2:L${last}`).values=jobs.map(job => [
      job.job_id,job.job_type,nullableNumber(job.target_count),toDate(job.started_at),toDate(job.finished_at),job.status,
      Number(job.discovered),Number(job.processed),Number(job.success),Number(job.failed),Number(job.resume_count),job.error_summary
    ]);
    applyBody(sheet.getRange(`A2:L${last}`));
    sheet.getRange(`C2:C${last}`).format.numberFormat='#,##0';
    sheet.getRange(`D2:E${last}`).format.numberFormat='yyyy-mm-dd hh:mm';
    sheet.getRange(`G2:K${last}`).format.numberFormat='#,##0';
    sheet.getRange(`L2:L${last}`).format.wrapText=true;
    const table=sheet.tables.add(`A1:L${last}`,true,'TemuCrawlJobs');
    table.style='TableStyleMedium2';table.showFilterButton=true;
  }
  [38,16,14,22,22,22,14,14,12,12,15,48].forEach((width,index) => { sheet.getRange(`${columnLetter(index+1)}:${columnLetter(index+1)}`).format.columnWidth=width; });
  sheet.freezePanes.freezeRows(1);
}
function nullableNumber(value) { return value === null || value === undefined ? null : Number(value); }
function toDate(value) { const date=value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
