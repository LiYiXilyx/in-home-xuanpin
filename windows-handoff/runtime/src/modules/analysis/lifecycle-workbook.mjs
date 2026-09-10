import { stageLabel } from './growth-calculator.mjs';

const COLORS={ navy:'#17365D',blue:'#2F75B5',lightBlue:'#D9EAF7',green:'#E2F0D9',amber:'#FFF2CC',red:'#FCE4D6',gray:'#E7E6E6',text:'#1F2937' };
const SHEETS=['生命周期总览','生命周期明细','字段说明'];

export function buildLifecycleWorkbook({ Workbook },model) {
  const workbook=Workbook.create();
  const sheets=Object.fromEntries(SHEETS.map(name => [name,workbook.worksheets.add(name)]));
  for (const sheet of Object.values(sheets)) sheet.showGridLines=false;
  buildDetail(sheets['生命周期明细'],model);
  buildOverview(sheets['生命周期总览'],model);
  buildFields(sheets['字段说明'],model);
  return { workbook,sheetNames:SHEETS };
}

function buildOverview(sheet,model) {
  const last=model.metrics.length+1;
  sheet.getRange('A1:H1').merge();sheet.getRange('A1').values=[['Week2 Day10｜商品生命周期分析']];
  sheet.getRange('A1:H1').format={ fill:COLORS.navy,font:{ bold:true,color:'#FFFFFF',size:18 },verticalAlignment:'center' };sheet.getRange('A1:H1').format.rowHeight=34;
  sheet.getRange('A2:H2').merge();sheet.getRange('A2').values=[[`分析日期：${model.analysisAsOfDate} ｜ 规则：${model.ruleVersion} ｜ run：${model.runId}`]];
  sheet.getRange('A2:H2').format={ fill:COLORS.lightBlue,font:{ color:COLORS.text,size:10 },verticalAlignment:'center' };
  const cards=[
    ['Active商品',`=COUNTA('生命周期明细'!$A$2:$A$${last})`],['有评论数据',`=COUNTIF('生命周期明细'!$P$2:$P$${last},"<>insufficient")`],
    ['可判定阶段',`=COUNTIF('生命周期明细'!$N$2:$N$${last},"<>数据不足")`],['数据不足',`=COUNTIF('生命周期明细'!$N$2:$N$${last},"数据不足")`]
  ];
  cards.forEach(([label,formula],index) => { const col=1+index*2;const c=column(col);sheet.getRange(`${c}4`).values=[[label]];sheet.getRange(`${c}4`).format={ fill:COLORS.gray,font:{ bold:true,color:COLORS.text },horizontalAlignment:'center' };sheet.getRange(`${c}5`).formulas=[[formula]];sheet.getRange(`${c}5`).format={ fill:'#FFFFFF',font:{ bold:true,color:COLORS.blue,size:17 },horizontalAlignment:'center',borders:{ preset:'outside',style:'thin',color:'#B4C7E7' } };sheet.getRange(`${c}5`).format.numberFormat='#,##0';sheet.getRange(`${c}5`).format.rowHeight=30; });
  sheet.getRange('A8:C8').values=[['生命周期阶段','商品数','占已判定比例']];applyHeader(sheet.getRange('A8:C8'));
  const stages=['新品','增长','成熟','衰退','数据不足'];
  sheet.getRange('A9:A13').values=stages.map(value => [value]);
  sheet.getRange('B9:B13').formulas=stages.map((_,index) => [`=COUNTIF('生命周期明细'!$N$2:$N$${last},A${index+9})`]);
  sheet.getRange('C9:C12').formulas=stages.slice(0,4).map((_,index) => [`=IFERROR(B${index+9}/SUM($B$9:$B$12),0)`]);sheet.getRange('C13').values=[[null]];
  applyBody(sheet.getRange('A9:C13'));sheet.getRange('B9:B13').format.numberFormat='#,##0';sheet.getRange('C9:C12').format.numberFormat='0.0%';
  sheet.getRange('A15:H16').merge();sheet.getRange('A15').values=[['重要口径：first_review_date 是当前 SQLite 中“最早已采集评论日期”，不是 Temu 平台历史首评保证。评论未覆盖或 coverage 未完成的商品不会被强行判为衰退，而显示“数据不足”。']];
  sheet.getRange('A15:H16').format={ fill:COLORS.amber,font:{ color:'#7F6000',bold:true },wrapText:true,verticalAlignment:'center' };
  sheet.getRange('A18:H18').merge();sheet.getRange('A18').values=[['阶段规则：新品=累计评论≤50且近30天有评论；增长=近7天速度相对前23天显著上升；衰退=活跃度显著下降；其余为成熟。partial覆盖保留阶段但标记需复核。']];
  sheet.getRange('A18:H18').format={ fill:'#F3F4F6',font:{ color:COLORS.text },wrapText:true,verticalAlignment:'center' };sheet.getRange('A18:H18').format.rowHeight=32;
  [20,14,18,4,20,4,20,4].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(2);
}

function buildDetail(sheet,model) {
  const headers=['goods_id','rank','商品标题','商品链接','细分类','最新累计评论数','数据库评论数','first_review_date','recent_7d_reviews','recent_30d_reviews','前23天评论数','review_velocity','速度比','product_stage','阶段代码','data_status','coverage_status','coverage_stop_reason','快照数','最新快照时间','判定依据'];
  sheet.getRange('A1:U1').values=[headers];applyHeader(sheet.getRange('A1:U1'));
  const rows=model.metrics.map(item => [`'${item.goodsId}`,item.rank,item.title,item.productUrl,item.categoryLabel,item.snapshotReviewCount,
    item.storedReviewCount,item.firstReviewDate,item.recent7dReviews,item.recent30dReviews,item.prior23dReviews,item.reviewVelocity,
    item.velocityRatio,stageLabel(item.productStage),item.productStage,item.dataStatus,item.coverageStatus,item.coverageStopReason,
    item.snapshotCount,item.latestSnapshotAt,item.reasons.join('；')]);
  const last=rows.length+1;sheet.getRange(`A2:U${last}`).values=rows;applyBody(sheet.getRange(`A2:U${last}`));
  sheet.getRange(`A2:U${last}`).format.rowHeight=38;sheet.getRange(`C2:E${last}`).format.wrapText=true;sheet.getRange(`R2:U${last}`).format.wrapText=true;
  sheet.getRange(`A2:A${last}`).format.numberFormat='@';sheet.getRange(`B2:B${last}`).format.numberFormat='#,##0';sheet.getRange(`F2:G${last}`).format.numberFormat='#,##0';
  sheet.getRange(`H2:H${last}`).format.numberFormat='yyyy-mm-dd';sheet.getRange(`I2:K${last}`).format.numberFormat='#,##0';sheet.getRange(`L2:L${last}`).format.numberFormat='0.0000';sheet.getRange(`M2:M${last}`).format.numberFormat='0.00x';sheet.getRange(`S2:S${last}`).format.numberFormat='#,##0';
  sheet.getRange(`D2:D${last}`).format.font={ color:'#0563C1',underline:true };
  sheet.getRange(`N2:N${last}`).conditionalFormats.add('containsText',{ text:'增长',format:{ fill:COLORS.green,font:{ color:'#375623',bold:true } } });
  sheet.getRange(`N2:N${last}`).conditionalFormats.add('containsText',{ text:'衰退',format:{ fill:COLORS.red,font:{ color:'#9C0006',bold:true } } });
  sheet.getRange(`N2:N${last}`).conditionalFormats.add('containsText',{ text:'数据不足',format:{ fill:COLORS.amber,font:{ color:'#7F6000' } } });
  const table=sheet.tables.add(`A1:U${last}`,true,'ProductLifecycleMetrics');table.style='TableStyleMedium2';table.showFilterButton=true;
  [20,9,52,60,26,16,15,17,17,18,15,16,12,15,14,15,17,30,10,22,62].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });
  sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(2);
}

function buildFields(sheet,model) {
  const rows=[
    ['first_review_date','reviews.review_date最小值','DATE','无评论为空','当前数据库最早已采集评论日期；由于Day9按cutoff采集，不保证等于平台历史首评。'],
    ['recent_7d_reviews','分析日向前含当天7日','INTEGER','无评论为0','只统计有效review_date且不晚于分析日。'],
    ['recent_30d_reviews','分析日向前含当天30日','INTEGER','无评论为0','当前SQLite已采集评论的30日计数。'],
    ['review_velocity','recent_7d_reviews / 7','DECIMAL','无评论为0','最近7天日均评论速度。'],
    ['速度比','近7天日均 / 前23天日均','DECIMAL','前23天为0时为空','用于识别增长或衰退趋势，不输出无穷值。'],
    ['product_stage','Day10规则','ENUM','证据不足显示数据不足','新品/new、增长/growth、成熟/mature、衰退/decline。'],
    ['data_status','review_capture_coverage','ENUM','不允许缺失','sufficient=complete；partial=部分覆盖；insufficient=未形成可靠覆盖。'],
    ['snapshot_review_count','最新product_snapshots.review_count','INTEGER','页面未展示为空','Temu页面累计评论数，只用于新品阈值辅助。'],
    ['核心表保护','products/catalog_memberships/product_snapshots','READ ONLY','不适用','Day10仅写生命周期run与metrics，不修改正式商品池。']
  ];
  sheet.getRange('A1:E1').values=[['字段','来源/公式','类型','缺失口径','说明']];applyHeader(sheet.getRange('A1:E1'));sheet.getRange(`A2:E${rows.length+1}`).values=rows;applyBody(sheet.getRange(`A2:E${rows.length+1}`));sheet.getRange(`A2:E${rows.length+1}`).format.wrapText=true;sheet.getRange(`A2:E${rows.length+1}`).format.rowHeight=44;
  const table=sheet.tables.add(`A1:E${rows.length+1}`,true,'LifecycleFieldDefinitions');table.style='TableStyleMedium2';table.showFilterButton=true;
  sheet.getRange('G1:H1').values=[['本次run参数','值']];applyHeader(sheet.getRange('G1:H1'));sheet.getRange('G2:H5').values=[['分析日期',model.analysisAsOfDate],['规则版本',model.ruleVersion],['来源catalog job',model.sourceCatalogJobId],['active商品数',model.metrics.length]];applyBody(sheet.getRange('G2:H5'));
  [24,34,16,24,74,4,24,42].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(1);
}

function applyHeader(range) { range.format={ fill:COLORS.navy,font:{ bold:true,color:'#FFFFFF',size:11 },verticalAlignment:'center',horizontalAlignment:'center',wrapText:true,borders:{ preset:'outside',style:'thin',color:'#95B3D7' } };range.format.rowHeight=34; }
function applyBody(range) { range.format={ font:{ color:COLORS.text,size:10 },verticalAlignment:'center',borders:{ insideHorizontal:{ style:'thin',color:'#E5E7EB' } } }; }
function column(number) { let result='';for(let n=number;n>0;n=Math.floor((n-1)/26)) result=String.fromCharCode(65+((n-1)%26))+result;return result; }
