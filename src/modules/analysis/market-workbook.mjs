const BASE_SHEET_NAMES=['市场总览','类目分析','商品指标','字段说明'];
const COLORS={ navy:'#17365D',blue:'#2F75B5',lightBlue:'#D9EAF7',green:'#E2F0D9',amber:'#FFF2CC',red:'#FCE4D6',gray:'#E7E6E6',text:'#1F2937' };

export function buildMarketWorkbook({ Workbook },analysis,{ imageDataByGoodsId=new Map() }={}) {
  const workbook=Workbook.create();
  const SHEET_NAMES=analysis.fineClassification ? [...BASE_SHEET_NAMES,'细分类分析','人工复核队列'] : BASE_SHEET_NAMES;
  const sheets=Object.fromEntries(SHEET_NAMES.map(name => [name,workbook.worksheets.add(name)]));
  for (const sheet of Object.values(sheets)) sheet.showGridLines=false;
  buildFieldsSheet(sheets['字段说明'],analysis);
  buildCategorySheet(sheets['类目分析'],analysis);
  const imageCount=buildProductSheet(sheets['商品指标'],analysis,imageDataByGoodsId);
  buildOverviewSheet(sheets['市场总览'],analysis);
  if (analysis.fineClassification) { buildFineAnalysisSheet(sheets['细分类分析'],analysis.fineClassification);buildManualReviewSheet(sheets['人工复核队列'],analysis.fineClassification.manualReviewQueue); }
  return { workbook,imageCount,sheetNames:SHEET_NAMES };
}

function buildOverviewSheet(sheet,analysis) {
  const lastProductRow=analysis.products.length+1;
  const lastCategoryRow=analysis.categories.length+1;
  const business=analysis.business;
  sheet.getRange('A1:J1').merge();
  sheet.getRange('A1').values=[[analysis.fineClassification ? 'Week2 Day8.2｜业务细分类体系 V2' : 'Week2 Day8.1｜市场机会 × 业务可做性']];
  sheet.getRange('A1:J1').format={ fill:COLORS.navy,font:{ bold:true,color:'#FFFFFF',size:18 },verticalAlignment:'center' };
  sheet.getRange('A1:J1').format.rowHeight=34;
  sheet.getRange('A2:J2').merge();
  sheet.getRange('A2').values=[[`来源任务：${analysis.sourceCatalogJobId} ｜ 市场版本：${analysis.analysisVersion} ｜ 业务规则：${business.ruleVersion} ｜ run：${analysis.runId}`]];
  sheet.getRange('A2:J2').format={ fill:COLORS.lightBlue,font:{ color:COLORS.text,size:10 },verticalAlignment:'center' };
  const kpis=[
    ['Active商品数',`=COUNTA('商品指标'!$A$2:$A$${lastProductRow})`,'0'],['分类覆盖率','=1-G5/A5','0.0%'],
    ['类目数',`=COUNTA('类目分析'!$A$2:$A$${lastCategoryRow})`,'0'],['needs_review数量',`=COUNTIF('商品指标'!$G$2:$G$${lastProductRow},"是")`,'0'],
    ['“其他”数量',`=COUNTIF('商品指标'!$F$2:$F$${lastProductRow},"其他")`,'0'],['业务可做',business.summary.eligibleCount,'0'],
    ['业务排除',business.summary.excludedCount,'0'],['待细分类',business.summary.pendingFineClassificationCount,'0'],
    ['电子/通信',business.summary.electronicsCount,'0'],['USB产品',business.summary.usbCount,'0'],
    ['price < 5 EUR',business.summary.priceBelow5Count,'0'],['电池产品',business.summary.batteryCount,'0'],
    ['认证风险（含电池）',business.summary.certificationRiskCount,'0'],['筛选警告',business.summary.screeningWarningCount,'0'],
    ['需细分类',business.summary.needsFineClassificationCount,'0']
  ];
  kpis.forEach(([label,formula,format],index) => {
    const blockRow=4+Math.floor(index/5)*3;const col=1+(index%5)*2;
    const labelCell=sheet.getRange(`${column(col)}${blockRow}`);const valueCell=sheet.getRange(`${column(col)}${blockRow+1}`);
    labelCell.values=[[label]];labelCell.format={ fill:COLORS.gray,font:{ bold:true,color:COLORS.text },horizontalAlignment:'center' };
    if (typeof formula === 'string' && formula.startsWith('=')) valueCell.formulas=[[formula]];else valueCell.values=[[formula]];
    valueCell.format={ fill:'#FFFFFF',font:{ bold:true,color:COLORS.blue,size:16 },horizontalAlignment:'center',borders:{ preset:'outside',style:'thin',color:'#B4C7E7' } };
    valueCell.format.numberFormat=format;valueCell.format.rowHeight=30;
  });
  sheet.getRange('C5').format.fill=analysis.overall.classifiedCoverage < 0.7 ? COLORS.amber : '#FFFFFF';
  sheet.getRange('A13:J13').merge();sheet.getRange('A13').values=[['口径：Market Opportunity 描述市场本身；Business Eligibility 描述当前业务是否可执行。二者不等价。rating < 4.6 或 review_count ≤ 3 只产生 screening_warning，不作为硬淘汰。']];
  sheet.getRange('A13:J13').format={ fill:COLORS.amber,font:{ color:'#7F6000',bold:true },wrapText:true,verticalAlignment:'center' };sheet.getRange('A13:J13').format.rowHeight=34;
  const marketRows=rankingRows(business.marketRanking.slice(0,15),analysis.categories,'market');
  const businessRows=analysis.fineClassification ? fineRankingRows(analysis.fineClassification.mainRanking.slice(0,15),analysis.fineClassification.metrics) : rankingRows(business.businessRanking,analysis.categories,'business');
  buildRanking(sheet,{ title:analysis.fineClassification ? 'Market Ranking（市场细分类Top15）' : 'Market Ranking（市场本身）',headerRow:15,startRow:16,rows:marketRows,chartPosition:['D15','J31'],chartTitle:'Market Opportunity Ranking' });
  buildRanking(sheet,{ title:analysis.fineClassification ? 'Business Eligible Ranking V2（usable主榜）' : 'Business Eligible Ranking（当前可执行机会）',headerRow:34,startRow:35,rows:businessRows,chartPosition:['D34','J50'],chartTitle:analysis.fineClassification ? 'Business Eligible Opportunity Ranking V2｜usable' : 'Business Eligible Opportunity Ranking' });
  [18,12,18,4,18,4,18,4,18,4].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(2);
}

function rankingRows(ranking,categories,type) { const rowByCategory=new Map(categories.map((item,index) => [item.categoryLabel,index+2]));return ranking.map(item => [item.categoryLabel,`='类目分析'!${type === 'market' ? 'AF' : 'AG'}${rowByCategory.get(item.categoryLabel)}`]); }
function fineRankingRows(ranking,metrics) { const rowByCategory=new Map(metrics.map((item,index) => [item.level3,index+2]));return ranking.map(item => [item.level3,`='细分类分析'!P${rowByCategory.get(item.level3)}`]); }
function buildRanking(sheet,{ title,headerRow,startRow,rows,chartPosition,chartTitle }) {
  sheet.getRange(`A${headerRow}:B${headerRow}`).values=[[title,'Opportunity Score']];applyHeader(sheet.getRange(`A${headerRow}:B${headerRow}`));
  if (!rows.length) return;
  sheet.getRange(`A${startRow}:A${startRow+rows.length-1}`).values=rows.map(row => [row[0]]);sheet.getRange(`B${startRow}:B${startRow+rows.length-1}`).formulas=rows.map(row => [row[1]]);
  sheet.getRange(`A${startRow}:B${startRow+rows.length-1}`).format={ font:{ color:COLORS.text,size:10 },borders:{ insideHorizontal:{ style:'thin',color:'#E5E7EB' } } };sheet.getRange(`B${startRow}:B${startRow+rows.length-1}`).format.numberFormat='0.00';
  const chart=sheet.charts.add('bar',sheet.getRange(`A${headerRow}:B${startRow+rows.length-1}`));chart.title=chartTitle;chart.hasLegend=false;chart.xAxis={ axisType:'textAxis',textStyle:{ fontSize:9 } };chart.yAxis={ numberFormatCode:'0',min:0,max:100 };chart.setPosition(...chartPosition);
}

function buildCategorySheet(sheet,analysis) {
  const headers=['分类','原商品数','业务可做商品数','排除数','待细分类数','排除率','商品占比','needs_review','needs_review占比','平均价格','中位价格','P25价格','P75价格','平均销量','中位销量','P75销量','P90销量','总销量','平均评分','中位评分','评分≥4.5比例','平均评论数','中位评论数','高评论商品比例','Top5销量占比','Top10销量占比','需求强度','竞争结构','价格空间','评分/成熟度','数据可信度','Market Opportunity Score','Business Eligible Opportunity Score','评分版本','评分解释','风险标记'];
  sheet.getRange('A1:AJ1').values=[headers];applyHeader(sheet.getRange('A1:AJ1'));
  const rows=analysis.categories.map(metric => { const a=metric.businessAlignment;return [metric.categoryLabel,a.originalProductCount,a.eligibleCount,a.excludedCount,a.pendingCount,a.exclusionRate,metric.productShare,metric.needsReviewCount,metric.needsReviewShare,metric.price.avg,metric.price.median,metric.price.p25,metric.price.p75,metric.sales.avg,metric.sales.median,metric.sales.p75,metric.sales.p90,metric.sales.total,metric.rating.avg,metric.rating.median,metric.rating45Share,metric.reviews.avg,metric.reviews.median,metric.highReviewShare,metric.top5SalesShare,metric.top10SalesShare,metric.scoreComponents.demand,metric.scoreComponents.competition,metric.scoreComponents.priceSpace,metric.scoreComponents.maturity,metric.scoreComponents.dataConfidence,null,a.businessEligibleOpportunityScore,metric.analysisVersion,metric.reasons.join('；'),metric.isOther || metric.needsReviewShare >= 0.5 ? '待细分类/低分类可信度' : a.eligibleCount === 0 ? '当前无业务可做商品' : '']; });
  const last=rows.length+1;sheet.getRange(`A2:AJ${last}`).values=rows;sheet.getRange(`AF2:AF${last}`).formulas=rows.map((_,index) => { const row=index+2;return [`=AA${row}*'字段说明'!$I$2+AB${row}*'字段说明'!$I$3+AC${row}*'字段说明'!$I$4+AD${row}*'字段说明'!$I$5+AE${row}*'字段说明'!$I$6`]; });
  applyBody(sheet.getRange(`A2:AJ${last}`));sheet.getRange(`A2:AJ${last}`).format.rowHeight=44;
  sheet.getRange(`F2:G${last}`).format.numberFormat='0.0%';sheet.getRange(`H2:H${last}`).format.numberFormat='#,##0';sheet.getRange(`I2:I${last}`).format.numberFormat='0.0%';sheet.getRange(`J2:M${last}`).format.numberFormat='€#,##0.00';sheet.getRange(`N2:R${last}`).format.numberFormat='#,##0.00';sheet.getRange(`S2:T${last}`).format.numberFormat='0.00';sheet.getRange(`U2:U${last}`).format.numberFormat='0.0%';sheet.getRange(`V2:W${last}`).format.numberFormat='#,##0.00';sheet.getRange(`X2:Z${last}`).format.numberFormat='0.0%';sheet.getRange(`AA2:AG${last}`).format.numberFormat='0.00';sheet.getRange(`AI2:AJ${last}`).format.wrapText=true;
  for (const scoreColumn of ['AF','AG']) sheet.getRange(`${scoreColumn}2:${scoreColumn}${last}`).conditionalFormats.add('colorScale',{ thresholds:['min','50%','max'],colors:['#F8696B','#FFEB84','#63BE7B'] });
  sheet.getRange(`AJ2:AJ${last}`).conditionalFormats.add('containsText',{ text:'待细分类',format:{ fill:COLORS.amber,font:{ color:'#7F6000',bold:true } } });
  const table=sheet.tables.add(`A1:AJ${last}`,true,'Week2CategoryMetrics');table.style='TableStyleMedium2';table.showFilterButton=true;
  [18,11,15,10,12,11,11,14,15,12,12,12,12,13,13,13,13,15,11,11,15,14,14,16,15,16,12,12,12,14,14,19,23,20,64,22].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(1);
}

function buildProductSheet(sheet,analysis,imageDataByGoodsId) {
  const headers=['goods_id','图片','商品标题','Temu链接','rank','分类','needs_review','price','sales','rating','review_count','分类置信度','市场Opportunity Score','业务准入状态','business_exclusion_code','business_exclusion_reason','screening_warning','needs_fine_classification','是否进入后续分析','业务规则版本','Level1','Level2','Level3 / Product Family','分类方法','manual_review_required','unresolved_reason'];
  sheet.getRange('A1:Z1').values=[headers];applyHeader(sheet.getRange('A1:Z1'));
  const rows=analysis.products.map(product => [`'${product.goodsId}`,null,product.title,product.productUrl,product.rank,product.categoryLabel,product.needsReview ? '是' : '否',product.price,product.sales,product.rating,product.reviewCount,product.classificationConfidence,product.marketOpportunityScore,product.businessStatus,product.businessExclusionCode,product.businessExclusionReason,product.screeningWarning,product.needsFineClassification ? '是' : '否',product.followUpStatus,product.businessRuleVersion,product.level1,product.level2,product.level3,product.classificationMethod,product.manualReviewRequired ? '是' : '否',product.unresolvedReason]);
  const last=rows.length+1;sheet.getRange(`A2:Z${last}`).values=rows;applyBody(sheet.getRange(`A2:Z${last}`));sheet.getRange(`A2:Z${last}`).format.rowHeight=68;sheet.getRange(`C2:D${last}`).format.wrapText=true;sheet.getRange(`O2:Q${last}`).format.wrapText=true;sheet.getRange(`X2:Z${last}`).format.wrapText=true;sheet.getRange(`D2:D${last}`).format.font={ color:'#0563C1',underline:true };
  sheet.getRange(`A2:A${last}`).format.numberFormat='@';sheet.getRange(`E2:E${last}`).format.numberFormat='#,##0';sheet.getRange(`H2:H${last}`).format.numberFormat='€#,##0.00';sheet.getRange(`I2:I${last}`).format.numberFormat='#,##0';sheet.getRange(`J2:J${last}`).format.numberFormat='0.00';sheet.getRange(`K2:K${last}`).format.numberFormat='#,##0';sheet.getRange(`L2:L${last}`).format.numberFormat='0.0%';sheet.getRange(`M2:M${last}`).format.numberFormat='0.00';
  sheet.getRange(`G2:G${last}`).conditionalFormats.add('containsText',{ text:'是',format:{ fill:COLORS.amber,font:{ color:'#7F6000',bold:true } } });sheet.getRange(`N2:N${last}`).conditionalFormats.add('containsText',{ text:'可做',format:{ fill:COLORS.green,font:{ color:'#375623',bold:true } } });sheet.getRange(`N2:N${last}`).conditionalFormats.add('containsText',{ text:'排除',format:{ fill:COLORS.red,font:{ color:'#9C0006',bold:true } } });sheet.getRange(`N2:N${last}`).conditionalFormats.add('containsText',{ text:'待细分类',format:{ fill:COLORS.amber,font:{ color:'#7F6000',bold:true } } });sheet.getRange(`R2:R${last}`).conditionalFormats.add('containsText',{ text:'是',format:{ fill:COLORS.amber,font:{ color:'#7F6000',bold:true } } });
  sheet.getRange(`Y2:Y${last}`).conditionalFormats.add('containsText',{ text:'是',format:{ fill:COLORS.red,font:{ color:'#9C0006',bold:true } } });
  const table=sheet.tables.add(`A1:Z${last}`,true,'Week2ProductMetrics');table.style='TableStyleMedium2';table.showFilterButton=true;[20,14,48,58,10,18,14,12,12,10,14,14,20,16,36,48,34,22,20,20,22,22,26,14,22,48].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(1);
  let imageCount=0;analysis.products.forEach((product,index) => { const dataUrl=imageDataByGoodsId.get(String(product.goodsId));if (!dataUrl) return;sheet.images.add({ dataUrl,anchor:{ from:{ row:index+1,col:1,rowOffsetPx:4,colOffsetPx:4 },extent:{ widthPx:76,heightPx:60 } } });imageCount+=1; });return imageCount;
}

function buildFineAnalysisSheet(sheet,fine) {
  const headers=['Level2','Level3 / Product Family','商品数','eligible数','排除数','待人工复核','价格中位数','价格P25','价格P75','销量中位数','总销量','评分中位数','评论中位数','Top5销量占比','Top10销量占比','Opportunity Score V2','分类可信度','样本状态','当前缺失数据'];
  sheet.getRange('A1:S1').values=[headers];applyHeader(sheet.getRange('A1:S1'));
  const rows=fine.metrics.map(item => [item.level2,item.level3,item.productCount,item.eligibleCount,item.excludedCount,item.pendingCount,item.priceMedian,item.priceP25,item.priceP75,item.salesMedian,item.totalSales,item.ratingMedian,item.reviewCountMedian,item.top5SalesShare,item.top10SalesShare,item.opportunityScoreV2,item.classificationConfidence,item.sampleSizeStatus,item.missingData.join('；')]);
  const last=rows.length+1;sheet.getRange(`A2:S${last}`).values=rows;applyBody(sheet.getRange(`A2:S${last}`));sheet.getRange(`A2:S${last}`).format.rowHeight=42;sheet.getRange(`G2:I${last}`).format.numberFormat='€#,##0.00';sheet.getRange(`J2:K${last}`).format.numberFormat='#,##0';sheet.getRange(`L2:L${last}`).format.numberFormat='0.00';sheet.getRange(`M2:M${last}`).format.numberFormat='#,##0';sheet.getRange(`N2:O${last}`).format.numberFormat='0.0%';sheet.getRange(`P2:P${last}`).format.numberFormat='0.00';sheet.getRange(`Q2:Q${last}`).format.numberFormat='0.0%';sheet.getRange(`S2:S${last}`).format.wrapText=true;
  sheet.getRange(`P2:P${last}`).conditionalFormats.add('colorScale',{ thresholds:['min','50%','max'],colors:['#F8696B','#FFEB84','#63BE7B'] });sheet.getRange(`R2:R${last}`).conditionalFormats.add('containsText',{ text:'usable',format:{ fill:COLORS.green,font:{ color:'#375623',bold:true } } });sheet.getRange(`R2:R${last}`).conditionalFormats.add('containsText',{ text:'small_sample',format:{ fill:COLORS.amber,font:{ color:'#7F6000',bold:true } } });sheet.getRange(`R2:R${last}`).conditionalFormats.add('containsText',{ text:'insufficient_sample',format:{ fill:COLORS.red,font:{ color:'#9C0006',bold:true } } });
  const table=sheet.tables.add(`A1:S${last}`,true,'Week2FineMetrics');table.style='TableStyleMedium2';table.showFilterButton=true;[22,28,10,12,10,14,13,12,12,13,14,12,14,15,16,20,14,20,60].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(2);
}

function buildManualReviewSheet(sheet,queue) {
  const headers=['goods_id','商品标题','当前分类','AI/规则判断结果','confidence','unresolved_reason'];sheet.getRange('A1:F1').values=[headers];applyHeader(sheet.getRange('A1:F1'));
  const rows=queue.map(item => [`'${item.goodsId}`,item.title,item.currentCategory,item.aiOrRuleResult,item.confidence,item.unresolvedReason]);const last=rows.length+1;
  if (rows.length) { sheet.getRange(`A2:F${last}`).values=rows;applyBody(sheet.getRange(`A2:F${last}`));sheet.getRange(`A2:F${last}`).format.rowHeight=54;sheet.getRange(`B2:F${last}`).format.wrapText=true;sheet.getRange(`E2:E${last}`).format.numberFormat='0.0%';sheet.getRange(`A2:A${last}`).format.numberFormat='@';const table=sheet.tables.add(`A1:F${last}`,true,'Week2ManualReview');table.style='TableStyleMedium2';table.showFilterButton=true; }
  [20,64,20,28,14,58].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(1);
}

function buildFieldsSheet(sheet,analysis) {
  const rows=[['active商品数','市场总览',"COUNTA('商品指标'!goods_id)",'INTEGER','不允许缺失','当前 active memberships 对应的唯一商品数'],['Market Opportunity Score','类目分析','五个市场分项加权','0–100','不允许缺失','描述当前1000商品池市场本身，不代表当前业务可执行'],['Business Eligible Opportunity Score','类目分析','仅对business_eligible=true商品重算','0–100','无可做商品时为空','已排除电子/USB/电池/认证风险/价格不符，且不含待细分类商品'],['business_eligible','商品指标','Day8.1业务筛选规则','BOOLEAN/NULL','NULL=待细分类','true=可做，false=排除，null=先完成细分类'],['business_exclusion_code','商品指标','可叠加硬排除代码','TEXT','无硬排除为空','不修改原始products、snapshots或catalog membership'],['business_exclusion_reason','商品指标','排除代码对应中文说明','TEXT','无硬排除为空','解释当前业务不可做原因'],['screening_warning','商品指标','评分/评论阈值标签','TEXT','无警告为空','rating<4.6或review_count≤3只警告，不在Day8.1淘汰'],['needs_fine_classification','商品指标','needs_review=true或分类=其他','BOOLEAN','不允许缺失','进入Day9前细分类处理队列；不等于业务排除'],['是否进入后续分析','商品指标','business_eligible映射','TEXT','不允许缺失','可做=是，排除=否，待细分类=先细分类'],['分类覆盖率','市场总览','1 - needs_review / active商品数','PERCENT','不允许缺失','Week1分类覆盖口径'],['价格P25/P75','类目分析','product_snapshots.price_amount','DECIMAL','忽略NULL','线性插值百分位'],['高评论商品比例','类目分析','review_count >= 全池P75','PERCENT','忽略NULL','阈值固定于本次run'],['Top5/Top10销量占比','类目分析','类目头部商品销量 / 类目总销量','PERCENT','总销量0时为0','仅代表当前1000商品池的头部集中度'],['needs_review','商品指标','product_classifications.needs_review','BOOLEAN','缺分类时为是','不会自动修改Week1分类'],['商品指标来源','商品指标',analysis.sourceCatalogJobId,'TEXT','不允许缺失','只读取active membership和指定Gate D快照']];
  if (analysis.fineClassification) {
    rows.find(item => item[0] === 'business_eligible')[2]='Day8.2细分类后二次业务筛选';
    rows.find(item => item[0] === 'business_eligible')[5]='true=可做，false=排除，null=人工复核未解决';
    rows.push(['sample_size_status','细分类分析','eligible_count阈值','ENUM','不允许缺失','usable≥10；small_sample 5–9；insufficient_sample<5'],['Opportunity Score V2','细分类分析','仅business_eligible=true商品重算','0–100','无可做商品为空','主榜仅展示usable；small_sample保留观察，不作为最终选品']);
  }
  sheet.getRange('A1:F1').values=[['字段','工作表','来源/公式','类型','缺失口径','说明']];applyHeader(sheet.getRange('A1:F1'));sheet.getRange(`A2:F${rows.length+1}`).values=rows;applyBody(sheet.getRange(`A2:F${rows.length+1}`));sheet.getRange(`A2:F${rows.length+1}`).format.wrapText=true;sheet.getRange(`A2:F${rows.length+1}`).format.rowHeight=42;const table=sheet.tables.add(`A1:F${rows.length+1}`,true,'Week2FieldDefinitions');table.style='TableStyleMedium2';table.showFilterButton=true;
  sheet.getRange('H1:I1').values=[['Market Score分项','权重']];applyHeader(sheet.getRange('H1:I1'));sheet.getRange('H2:I6').values=[['需求强度',0.35],['竞争结构',0.25],['价格空间',0.15],['评分/成熟度',0.15],['数据可信度',0.10]];applyBody(sheet.getRange('H2:I6'));sheet.getRange('I2:I6').format.numberFormat='0%';sheet.getRange('H8:I8').values=[['本次run参数','值']];applyHeader(sheet.getRange('H8:I8'));sheet.getRange('H9:I13').values=[['高评论阈值(P75)',analysis.overall.highReviewThreshold],['市场分析版本',analysis.analysisVersion],['业务规则版本',analysis.business.ruleVersion],['来源catalog job',analysis.sourceCatalogJobId],['taxonomy',analysis.taxonomy]];applyBody(sheet.getRange('H9:I13'));sheet.getRange('I9').format.numberFormat='#,##0';
  const rules=[['规则',analysis.fineClassification ? 'Day8.2处理' : 'Day8.1处理'],['电子/通信','ELECTRONIC_PRODUCT：硬排除'],['USB/Type-C','USB_PRODUCT：硬排除'],['电池/锂电/充电电池','BATTERY_PRODUCT：硬排除'],['蓝牙/耳机/音频/充电器','CERTIFICATION_RISK：硬排除'],['price < 5 EUR','PRICE_BELOW_5_EUR：硬排除'],['rating < 4.6','screening_warning，不淘汰'],['review_count ≤ 3','screening_warning，不淘汰'],['其他/needs_review','待细分类，不简单排除']];sheet.getRange(`K1:L${rules.length}`).values=rules;applyHeader(sheet.getRange('K1:L1'));applyBody(sheet.getRange(`K2:L${rules.length}`));sheet.getRange(`K1:L${rules.length}`).format.wrapText=true;[22,18,44,16,24,58,4,24,30,4,26,42].forEach((width,index) => { sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width; });sheet.freezePanes.freezeRows(1);
}

function applyHeader(range) { range.format={ fill:COLORS.navy,font:{ bold:true,color:'#FFFFFF',size:11 },verticalAlignment:'center',horizontalAlignment:'center',wrapText:true,borders:{ preset:'outside',style:'thin',color:'#95B3D7' } };range.format.rowHeight=34; }
function applyBody(range) { range.format={ font:{ color:COLORS.text,size:10 },verticalAlignment:'center',borders:{ insideHorizontal:{ style:'thin',color:'#E5E7EB' } } }; }
function column(number) { let result='';for(let n=number;n>0;n=Math.floor((n-1)/26)) result=String.fromCharCode(65+((n-1)%26))+result;return result; }
