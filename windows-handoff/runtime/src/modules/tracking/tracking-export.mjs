import {loadArtifactTool} from '../analysis/artifact-runtime.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const literal=v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v??null;
export function buildTrackingWorkbook({Workbook},detail){
 const w=Workbook.create(),summary=w.worksheets.add('周期变化'),source=w.worksheets.add('观测记录');
 const headers=['Temu ID','商品标题','周期（天）','基线价格','本期价格','价格变化','价格变化率','基线展示销量','本期展示销量','展示销量变化（约）','基线评论数','本期评论数','评论变化','基线评分','本期评分','评分变化','本期币种','状态','基线采集时间（UTC）','本期采集时间（UTC）'];
 summary.getRange('A2').values=[['商品周期变化']];summary.getRange('A3').values=[[literal(detail.name)]];
 summary.getRange('A4').values=[['展示销量为页面显示值，差额不是精确成交量。空白表示缺失；各期与固定基线比较；观测记录包含每次实际采集，不限周期。']];
 summary.getRange('A6:T6').values=[headers];let rows=[],formulas=[];
 for(const product of detail.products){const b=product.points.find(p=>p.day===0);
  for(const day of ['最新',7,14,21]){const c=day==='最新'?product.history?.filter(p=>!p.is_baseline).at(-1):product.points.find(p=>p.day===day),period=detail.periods.find(p=>p.day===day),row=rows.length+7,same=b?.currency&&b.currency===c?.currency;
   rows.push([String(product.goods_id),literal(product.title),day,b?.price_amount??null,c?.price_amount??null,null,null,b?.sales_count??null,c?.sales_count??null,null,b?.review_count??null,c?.review_count??null,null,b?.rating??null,c?.rating??null,null,c?.currency??null,c?'已观测':period?.status==='scheduled'?'未到期':'未观测到',b?.last_seen_at?new Date(b.last_seen_at):null,c?.last_seen_at?new Date(c.last_seen_at):null]);
   formulas.push({row,same});
  }
 }
 if(rows.length)summary.getRange(`A7:T${rows.length+6}`).values=rows;
 for(const {row:i,same} of formulas){if(same){summary.getRange(`F${i}`).formulas=[[`=IF(AND(ISNUMBER(D${i}),ISNUMBER(E${i})),E${i}-D${i},"")`]];summary.getRange(`G${i}`).formulas=[[`=IF(AND(ISNUMBER(F${i}),D${i}>0),F${i}/D${i},"")`]];}for(const [dest,b,c]of [['J','H','I'],['M','K','L'],['P','N','O']])summary.getRange(`${dest}${i}`).formulas=[[`=IF(AND(ISNUMBER(${b}${i}),ISNUMBER(${c}${i})),${c}${i}-${b}${i},"")`]];}
 const raw=[['Temu ID','采集日（距计划开始）','价格','币种','展示销量','评论数','评分','采集时间（UTC）','商品链接','来源任务 ID']];for(const p of detail.products)for(const x of (p.history??p.points))raw.push([String(p.goods_id),x.is_baseline?'基线':Math.floor((Date.parse(x.last_seen_at)-Date.parse(detail.started_at))/86400000),x.price_amount??null,x.currency??null,x.sales_count??null,x.review_count??null,x.rating??null,new Date(x.last_seen_at),literal(x.canonical_url),x.campaign_id]);source.getRange(`A1:J${raw.length}`).values=raw;
 for(const [sheet,header,last,width] of [[summary,6,rows.length+6,'T'],[source,1,raw.length,'J']]){sheet.showGridLines=false;sheet.getRange(`A1:${width}${last}`).format.font.name='Arial';sheet.getRange(`A1:${width}${last}`).format.font.size=10;sheet.getRange(`A${header}:${width}${header}`).format.fill='#263445';sheet.getRange(`A${header}:${width}${header}`).format.font.color='#FFFFFF';sheet.getRange(`A${header}:${width}${header}`).format.rowHeight=35;sheet.getRange(`A${header}:${width}${header}`).format.wrapText=true;sheet.getRange(`A:${width}`).format.columnWidth=18;sheet.getRange('A:A').format.columnWidth=22;sheet.freezePanes.freezeRows(header);}
 summary.getRange('B:B').format.columnWidth=42;summary.getRange('A2').format.font.size=16;summary.getRange('S:T').format.columnWidth=25;summary.getRange(`S7:T${rows.length+6}`).setNumberFormat('yyyy-mm-dd hh:mm');summary.getRange(`D7:F${rows.length+6}`).setNumberFormat('0.00');summary.getRange(`G7:G${rows.length+6}`).setNumberFormat('0.0%');source.getRange('H:H').format.columnWidth=25;source.getRange(`H2:H${raw.length}`).setNumberFormat('yyyy-mm-dd hh:mm');source.getRange('I:J').format.columnWidth=40;w.recalculate();return w;
}
export async function exportTrackingWorkbook(detail,{artifactLoader=loadArtifactTool}={}){const a=await artifactLoader(),w=buildTrackingWorkbook(a,detail),dir=await fs.mkdtemp(path.join(os.tmpdir(),'temu-period-'));try{const file=path.join(dir,'tracking.xlsx');await (await a.SpreadsheetFile.exportXlsx(w)).save(file);return await fs.readFile(file);}finally{if(path.dirname(path.resolve(dir))===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('temu-period-'))await fs.rm(dir,{recursive:true,force:true});}}

