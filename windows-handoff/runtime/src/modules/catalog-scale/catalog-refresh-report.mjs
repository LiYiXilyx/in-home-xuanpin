import fs from 'node:fs/promises';
import path from 'node:path';
import { loadArtifactTool } from '../analysis/artifact-runtime.mjs';
import { createCatalogCampaignService } from './catalog-campaign-service.mjs';

const SHEETS=['当前商品池','本轮Staging','电子排除','新旧1000对账','来源贡献','数据质量','Campaign任务','字段说明'];
const COLORS={ navy:'#17365D',blue:'#2F75B5',lightBlue:'#D9EAF7',green:'#E2F0D9',amber:'#FFF2CC',red:'#FCE4D6',gray:'#E7E6E6',text:'#1F2937' };

export async function exportCatalogRefreshWorkbook(db,{ campaignId,outputDir }) {
  const model=buildCatalogRefreshReportModel(db,campaignId);
  const artifact=await loadArtifactTool();
  const built=buildCatalogRefreshWorkbook(artifact,model);
  await fs.mkdir(outputDir,{ recursive:true });
  const workbookPath=path.join(outputDir,'catalog-refresh-1000.xlsx');
  const qa={ workbookPath,sheetNames:SHEETS,rowCounts:model.rowCounts,sqliteReconciliation:model.sqliteReconciliation,
    formulaErrorCount:null,previews:[],visualQaStatus:'known_failure',clickableLinksInExport:true,
    knownRenderLimitation:'Windows artifact render/export validation terminates on this workbook; HYPERLINK formulas are not implemented by the renderer' };
  await fs.writeFile(path.join(outputDir,'catalog-refresh-1000-qa.json'),JSON.stringify(qa,null,2));
  const output=await artifact.SpreadsheetFile.exportXlsx(built.workbook);
  await output.save(workbookPath);
  return qa;
}

export function buildCatalogRefreshReportModel(db,campaignId) {
  const status=createCatalogCampaignService(db).getStatus(campaignId);
  const campaign=status.campaign;
  if (campaign.campaignType!=='refresh') throw new Error('Catalog Refresh Excel只支持refresh Campaign。');
  const poolVersion=db.prepare('SELECT * FROM catalog_pool_versions WHERE campaign_id=?').get(campaignId);
  const staging=db.prepare(`SELECT s.*,CASE WHEN b.id IS NULL THEN 'new_goods' ELSE 'old_goods_reseen' END AS reconcile_status
    FROM catalog_staging_products s LEFT JOIN catalog_campaign_baseline_items b
      ON b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id
    WHERE s.campaign_id=? ORDER BY s.first_seen_sequence`).all(campaignId);
  const currentPool=db.prepare(`SELECT i.goods_id,s.latest_title,s.canonical_url,s.latest_source_url,s.image_url,s.price_amount,s.currency,
      s.sales_count,s.rating,s.review_count,s.first_seen_sequence,s.last_seen_at,i.membership_status
    FROM catalog_pool_version_items i JOIN catalog_staging_products s ON s.id=i.staging_product_id
    WHERE i.pool_version_id=? ORDER BY s.first_seen_sequence`).all(poolVersion?.id ?? '');
  const exclusions=db.prepare(`SELECT goods_id,MAX(title) AS title,exclusion_code,MAX(exclusion_reason) AS exclusion_reason,
      MAX(classifier_version) AS classifier_version,MAX(confidence) AS confidence,COUNT(*) AS observation_count,
      MIN(detected_at) AS first_detected_at,MAX(detected_at) AS last_detected_at
    FROM catalog_exclusion_observations WHERE campaign_id=? GROUP BY goods_id,exclusion_code
    ORDER BY goods_id,exclusion_code`).all(campaignId);
  const exclusionCodes=db.prepare(`SELECT exclusion_code,COUNT(DISTINCT goods_id) AS unique_goods_count,COUNT(*) AS observation_count
    FROM catalog_exclusion_observations WHERE campaign_id=? GROUP BY exclusion_code ORDER BY exclusion_code`).all(campaignId);
  const reconciliation=db.prepare(`SELECT b.goods_id,p.title,p.canonical_url,'old_goods_reseen' AS reconcile_status
    FROM catalog_campaign_baseline_items b JOIN products p ON p.id=b.product_id
    JOIN catalog_staging_products s ON s.campaign_id=b.campaign_id AND s.platform=b.platform AND s.goods_id=b.goods_id
      AND s.electronic_screening_status='passed' WHERE b.campaign_id=?
    UNION ALL
    SELECT b.goods_id,p.title,p.canonical_url,'old_goods_not_seen' AS reconcile_status
    FROM catalog_campaign_baseline_items b JOIN products p ON p.id=b.product_id
    LEFT JOIN catalog_staging_products s ON s.campaign_id=b.campaign_id AND s.platform=b.platform AND s.goods_id=b.goods_id
      AND s.electronic_screening_status='passed' WHERE b.campaign_id=? AND s.id IS NULL
    UNION ALL
    SELECT s.goods_id,s.latest_title,s.canonical_url,'new_goods' AS reconcile_status
    FROM catalog_staging_products s LEFT JOIN catalog_campaign_baseline_items b
      ON b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id
    WHERE s.campaign_id=? AND s.electronic_screening_status='passed' AND b.id IS NULL
    ORDER BY 4,1`).all(campaignId,campaignId,campaignId);
  const batches=db.prepare(`SELECT COUNT(*) AS accepted_batches,COALESCE(SUM(received_count),0) AS raw_received,
      COALESCE(SUM(staging_count),0) AS staging_writes,COALESCE(SUM(excluded_count),0) AS exclusion_hits,
      COALESCE(SUM(duplicate_count),0) AS duplicate_observations,MIN(captured_at) AS first_batch_at,MAX(captured_at) AS last_batch_at
    FROM catalog_capture_batches WHERE campaign_id=? AND processing_status='accepted'`).get(campaignId);
  const sourceRuns=db.prepare('SELECT * FROM catalog_source_runs WHERE campaign_id=? ORDER BY started_at').all(campaignId);
  const quality=status.qualityMetrics;
  const comparison=status.refreshComparison;
  const materialization=status.materialization;
  const counts={ products:Number(db.prepare('SELECT COUNT(*) count FROM products').get().count),
    activeMemberships:Number(db.prepare('SELECT COUNT(*) count FROM catalog_memberships WHERE active=1').get().count),
    snapshots:Number(db.prepare('SELECT COUNT(*) count FROM product_snapshots').get().count),
    reviews:Number(db.prepare('SELECT COUNT(*) count FROM reviews').get().count),poolVersions:Number(db.prepare('SELECT COUNT(*) count FROM catalog_pool_versions').get().count) };
  return { campaign,status,poolVersion,currentPool,staging,exclusions,exclusionCodes,reconciliation,batches,sourceRuns,quality,
    comparison,materialization,counts,rowCounts:{ currentPool:currentPool.length,staging:staging.length,exclusions:exclusions.length,
      reconciliation:reconciliation.length,sources:status.sourceContributions.length },
    sqliteReconciliation:{ poolItems:currentPool.length,passedStaging:staging.filter(row => row.electronic_screening_status==='passed').length,
      campaignNonElectronic:campaign.nonElectronicUniqueCount,uniqueExcluded:Number(db.prepare(`SELECT COUNT(DISTINCT goods_id) count
        FROM catalog_exclusion_observations WHERE campaign_id=?`).get(campaignId).count) } };
}

export function buildCatalogRefreshWorkbook({ Workbook },model,{ clickableLinks=true }={}) {
  const workbook=Workbook.create();const sheets=Object.fromEntries(SHEETS.map(name => [name,workbook.worksheets.add(name)]));
  Object.values(sheets).forEach(sheet => { sheet.showGridLines=false; });
  buildCurrentPool(sheets['当前商品池'],model,clickableLinks);buildStaging(sheets['本轮Staging'],model,clickableLinks);buildExclusions(sheets['电子排除'],model);
  buildReconciliation(sheets['新旧1000对账'],model,clickableLinks);buildSources(sheets['来源贡献'],model);buildQuality(sheets['数据质量'],model);
  buildCampaign(sheets['Campaign任务'],model);buildFields(sheets['字段说明']);
  return { workbook,sheetNames:SHEETS };
}

function buildCurrentPool(sheet,model,clickableLinks) {
  const headers=['序号','goods_id','商品标题','商品链接','图片链接','价格','币种','销量','评分','评论数','首次顺序','最后观察时间','Pool状态'];
  const rows=model.currentPool.map((r,i) => [i+1,`'${r.goods_id}`,r.latest_title,null,r.image_url,r.price_amount,r.currency,r.sales_count,r.rating,r.review_count,r.first_seen_sequence,toDate(r.last_seen_at),r.membership_status]);
  if (!rows.length) rows.push([null,null,'Pool尚未激活；此文件为采集中预演',null,null,null,null,null,null,null,null,null,'pending']);
  writeTable(sheet,headers,rows,'CatalogRefreshCurrentPool',[7,20,52,60,54,12,9,12,9,12,11,22,14]);
  writeLinks(sheet,'D',model.currentPool.map(r => r.canonical_url || r.latest_source_url),2,clickableLinks);formatProducts(sheet,rows.length);
}
function buildStaging(sheet,model,clickableLinks) {
  const headers=['序号','goods_id','商品标题','商品链接','图片链接','价格','币种','销量','评分','评论数','电子筛选','对账状态','首次顺序','首次观察','最后观察'];
  const rows=model.staging.map((r,i) => [i+1,`'${r.goods_id}`,r.latest_title,null,r.image_url,r.price_amount,r.currency,r.sales_count,r.rating,r.review_count,r.electronic_screening_status,r.reconcile_status,r.first_seen_sequence,toDate(r.first_seen_at),toDate(r.last_seen_at)]);
  writeTable(sheet,headers,rows,'CatalogRefreshStaging',[7,20,52,60,54,12,9,12,9,12,20,20,11,22,22]);
  writeLinks(sheet,'D',model.staging.map(r => r.canonical_url || r.latest_source_url),2,clickableLinks);formatProducts(sheet,rows.length);
}
function buildExclusions(sheet,model) {
  sheet.getRange('A1:D1').values=[['排除代码','唯一商品数','观察次数','口径']];applyHeader(sheet.getRange('A1:D1'));
  const summary=model.exclusionCodes.map(r => [r.exclusion_code,Number(r.unique_goods_count),Number(r.observation_count),'各代码唯一商品；跨代码不可直接相加']);
  if (summary.length) { sheet.getRange(`A2:D${summary.length+1}`).values=summary;applyBody(sheet.getRange(`A2:D${summary.length+1}`)); }
  const start=summary.length+4;const headers=['goods_id','商品标题','排除代码','排除原因','分类器版本','置信度','观察次数','首次发现','最后发现'];
  sheet.getRange(`A${start}:I${start}`).values=[headers];applyHeader(sheet.getRange(`A${start}:I${start}`));
  const rows=model.exclusions.map(r => [`'${r.goods_id}`,r.title,r.exclusion_code,r.exclusion_reason,r.classifier_version,r.confidence,Number(r.observation_count),toDate(r.first_detected_at),toDate(r.last_detected_at)]);
  if (rows.length) { const last=start+rows.length;sheet.getRange(`A${start+1}:I${last}`).values=rows;applyBody(sheet.getRange(`A${start+1}:I${last}`));sheet.tables.add(`A${start}:I${last}`,true,'CatalogElectronicExclusions').style='TableStyleMedium2';sheet.getRange(`F${start+1}:F${last}`).format.numberFormat='0.0%';sheet.getRange(`H${start+1}:I${last}`).format.numberFormat='yyyy-mm-dd hh:mm'; }
  [20,52,28,56,22,12,12,22,22].forEach((w,i)=>sheet.getRange(`${col(i+1)}:${col(i+1)}`).format.columnWidth=w);sheet.freezePanes.freezeRows(start);
}
function buildReconciliation(sheet,model,clickableLinks) {
  const c=model.comparison;sheet.getRange('A1:E1').values=[['old_active_count','new_non_electronic_unique_count','intersection_count','new_goods_count','not_seen_count']];applyHeader(sheet.getRange('A1:E1'));
  sheet.getRange('A2:E2').values=[[c.old_active_count,c.new_observed_unique_count,c.intersection_count,c.new_goods_count,c.not_seen_count]];applyBody(sheet.getRange('A2:E2'));
  const headers=['goods_id','商品标题','商品链接','状态'];const start=5;sheet.getRange(`A${start}:D${start}`).values=[headers];applyHeader(sheet.getRange(`A${start}:D${start}`));
  const rows=model.reconciliation.map(r => [`'${r.goods_id}`,r.title,null,r.reconcile_status]);const last=start+rows.length;
  if (rows.length) { sheet.getRange(`A${start+1}:D${last}`).values=rows;writeLinks(sheet,'C',model.reconciliation.map(r=>r.canonical_url),start+1,clickableLinks);applyBody(sheet.getRange(`A${start+1}:D${last}`));sheet.tables.add(`A${start}:D${last}`,true,'CatalogRefreshReconciliation').style='TableStyleMedium2';sheet.getRange(`D${start+1}:D${last}`).conditionalFormats.add('containsText',{ text:'not_seen',format:{ fill:COLORS.amber,font:{ color:'#7F6000' } } });sheet.getRange(`D${start+1}:D${last}`).conditionalFormats.add('containsText',{ text:'new_goods',format:{ fill:COLORS.green,font:{ color:'#375623' } } }); }
  [20,56,62,24].forEach((w,i)=>sheet.getRange(`${col(i+1)}:${col(i+1)}`).format.columnWidth=w);sheet.freezePanes.freezeRows(start);
}
function buildSources(sheet,model) {
  const headers=['source_id','source_key','来源唯一','Campaign新增唯一','Campaign重叠','合格唯一'];const rows=model.status.sourceContributions.map(r => [r.sourceId,r.sourceKey,r.sourceUniqueCount,r.campaignNewUniqueCount,r.campaignOverlapCount,r.eligibleNewCount]);writeTable(sheet,headers,rows,'CatalogSourceContribution',[38,24,14,18,16,14]);
  const b=model.batches;sheet.getRange('H1:I1').values=[['批次指标','值']];applyHeader(sheet.getRange('H1:I1'));sheet.getRange('H2:I8').values=[['accepted_batches',Number(b.accepted_batches)],['raw_received',Number(b.raw_received)],['staging_writes',Number(b.staging_writes)],['exclusion_hits',Number(b.exclusion_hits)],['duplicate_observations',Number(b.duplicate_observations)],['first_batch_at',b.first_batch_at],['last_batch_at',b.last_batch_at]];applyBody(sheet.getRange('H2:I8'));sheet.getRange('H:I').format.columnWidth=26;
}
function buildQuality(sheet,model) {
  const q=model.quality,m=model.materialization;const rows=[['Gate数量',model.campaign.nonElectronicUniqueCount,model.campaign.targetCount,'>='],['goods_id duplicate',q.duplicateGoodsIdCount,0,'='],['电子进入Staging',q.electronicInStagingCount,0,'='],['标题完整度',q.titleCoverage,0.95,'>='],['价格完整度',q.priceCoverage,0.95,'>='],['图片完整度',q.imageCoverage,0.95,'>='],['销量完整度',q.salesCoverage,0.90,'>='],['评分完整度',q.ratingCoverage,0.90,'>='],['评论数完整度',q.reviewCountCoverage,0.90,'>='],['Reviews不变',m ? m.reviewsAfter-m.reviewsBefore:null,0,'='],['SQLite pool items',model.currentPool.length,model.campaign.nonElectronicUniqueCount,'=']];
  writeTable(sheet,['指标','实际','阈值','规则'],rows,'CatalogRefreshQuality',[30,18,18,12]);sheet.getRange('B5:C10').format.numberFormat='0.0%';
  sheet.getRange('F1:G1').values=[['SQLite计数','值']];applyHeader(sheet.getRange('F1:G1'));sheet.getRange('F2:G6').values=Object.entries(model.counts);applyBody(sheet.getRange('F2:G6'));sheet.getRange('F:G').format.columnWidth=24;
}
function buildCampaign(sheet,model) {
  const c=model.campaign,q=model.status.queues[0] ?? {},cp=q.checkpoint ?? {};const rows=[['campaign_id',c.id],['campaign_name',c.name],['campaign_type',c.campaignType],['status',c.status],['qa_status',c.qaStatus],['target_gate',c.targetGate],['target_count',c.targetCount],['non_electronic_unique_count',c.nonElectronicUniqueCount],['raw_observed_count',c.rawObservedCount],['electronic_excluded_unique',c.electronicExcludedCount],['browser_profile_name',c.browserProfileName],['browser_profile_directory',c.browserProfileDirectory],['browser_control_mode',c.browserControlMode],['queue_id',q.id],['queue_status',q.status],['rounds',cp.round],['retry_count',cp.retry_count],['manual_intervention_count',cp.manual_intervention_count],['CAPTCHA_count',cp.captcha_count],['Oops_count',cp.oops_count],['load_more_success_count',cp.load_more_success_count],['elapsed_ms',cp.elapsed_ms],['last_load_state',cp.load_state],['stop_reason',cp.stop_reason ?? cp.stopReason]];
  writeTable(sheet,['任务字段','值'],rows,'CatalogRefreshCampaignTask',[34,74]);
}
function buildFields(sheet) {
  const rows=[['platform + goods_id','商品稳定身份键','SQLite','URL不得作为身份键'],['source_url / canonical_url','历史证据与fallback','SQLite/页面','不是长期可靠详情地址'],['not_seen_in_campaign','本轮未观察到','对账','不代表下架，不直接inactive'],['electronic_screening_status','passed/manual_review_required','Staging','manual review不计Gate'],['exclusion_code','电子/USB/电池/蓝牙等硬排除','Exclusion audit','跨代码unique不可直接相加'],['active memberships','第一周历史active集合','SQLite','Day4不清空，保留回滚'],['Pool Version','QA后事务激活的新池','SQLite','Excel不是正式数据源'],['null字段','页面未展示或未解析','SQLite/Excel','诚实保留null，不伪造']];writeTable(sheet,['字段','定义','来源','口径说明'],rows,'CatalogRefreshFieldDefinitions',[34,46,24,66]);
}
function writeTable(sheet,headers,rows,name,widths) { const end=col(headers.length);sheet.getRange(`A1:${end}1`).values=[headers];applyHeader(sheet.getRange(`A1:${end}1`));if(rows.length){const last=rows.length+1;sheet.getRange(`A2:${end}${last}`).values=rows;applyBody(sheet.getRange(`A2:${end}${last}`));const table=sheet.tables.add(`A1:${end}${last}`,true,name);table.style='TableStyleMedium2';table.showFilterButton=true;}widths.forEach((w,i)=>sheet.getRange(`${col(i+1)}:${col(i+1)}`).format.columnWidth=w);sheet.freezePanes.freezeRows(1); }
function writeLinks(sheet,column,urls,startRow=2,clickable=true) { if (!urls.length) return;const end=startRow+urls.length-1;const range=sheet.getRange(`${column}${startRow}:${column}${end}`);if(clickable)range.formulas=urls.map(url => [`=HYPERLINK("${excel(url)}","${excel(url)}")`]);else range.values=urls.map(url => [url]);range.format.font={ color:'#0563C1',underline:true };range.format.wrapText=true; }
function formatProducts(sheet,count) { if(!count)return;const last=count+1;sheet.getRange(`F2:F${last}`).format.numberFormat='€#,##0.00';sheet.getRange(`H2:H${last}`).format.numberFormat='#,##0';sheet.getRange(`I2:I${last}`).format.numberFormat='0.0';sheet.getRange(`J2:J${last}`).format.numberFormat='#,##0';sheet.getRange(`L2:L${last}`).format.numberFormat='yyyy-mm-dd hh:mm';sheet.getRange(`C2:E${last}`).format.wrapText=true;sheet.freezePanes.freezeColumns(2); }
function applyHeader(range){range.format={ fill:COLORS.navy,font:{ bold:true,color:'#FFFFFF',size:11 },verticalAlignment:'center',horizontalAlignment:'center',wrapText:true,borders:{ preset:'outside',style:'thin',color:'#95B3D7' } };range.format.rowHeight=34;}
function applyBody(range){range.format={ font:{ color:COLORS.text,size:10 },verticalAlignment:'center',borders:{ insideHorizontal:{ style:'thin',color:'#E5E7EB' } } };}
function col(n){let result='';for(let value=n;value>0;value=Math.floor((value-1)/26))result=String.fromCharCode(65+((value-1)%26))+result;return result;}
function excel(value){return String(value ?? '').replaceAll('"','""');}
function toDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date;}
