import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { loadArtifactTool } from '../analysis/artifact-runtime.mjs';
import { createCatalogCampaignService } from './catalog-campaign-service.mjs';

const SHEETS=['当前1500商品池','本轮新增500','Staging','电子排除','来源贡献','数据质量','Campaign任务','字段说明'];
const COLORS={ navy:'#17365D',green:'#E2F0D9',amber:'#FFF2CC',text:'#1F2937' };

export async function exportCatalogExpansionWorkbook(db,{ campaignId,outputDir }) {
  const model=buildCatalogExpansionReportModel(db,campaignId);const artifact=await loadArtifactTool();
  await fs.mkdir(outputDir,{ recursive:true });
  const prepared=await prepareExpansionImages(model.currentPool,{ baseDir:process.cwd(),cacheDir:path.join(outputDir,'.catalog-images') });
  const built=buildCatalogExpansionWorkbook(artifact,model,{ clickableLinks:true,imageDataByGoodsId:prepared.imageDataByGoodsId });
  const workbook=built.workbook;
  const workbookPath=path.join(outputDir,'catalog-expansion-1500.xlsx');const output=await artifact.SpreadsheetFile.exportXlsx(workbook);await output.save(workbookPath);
  const qa={ workbookPath,sheetNames:SHEETS,rowCounts:model.rowCounts,sqliteReconciliation:model.sqliteReconciliation,
    formulaErrorCount:null,previews:[],visualQaStatus:'known_failure',clickableLinksInExport:true,
    embeddedImages:built.imageCount,imageFailures:prepared.failures,
    navigationLinks:{ currentObservedFirst:true,canonicalIdentitySeparate:true },
    knownRenderLimitation:'Windows artifact render validation terminates at process level; this is the known market-report Excel renderer failure' };
  await fs.writeFile(path.join(outputDir,'catalog-expansion-1500-qa.json'),JSON.stringify(qa,null,2));return qa;
}

export function buildCatalogExpansionReportModel(db,campaignId) {
  const status=createCatalogCampaignService(db).getStatus(campaignId);const campaign=status.campaign;
  if (campaign.campaignType!=='expansion') throw new Error('Catalog Expansion Excel只支持expansion Campaign。');
  const poolVersion=db.prepare('SELECT * FROM catalog_pool_versions WHERE campaign_id=?').get(campaignId);
  if (!poolVersion || poolVersion.status!=='active') throw new Error('Expansion Excel要求1500 Pool已激活。');
  const currentPool=db.prepare(`SELECT i.goods_id,s.latest_title,s.canonical_url,s.latest_source_url,s.image_url,s.price_amount,s.currency,
      s.sales_count,s.rating,s.review_count,i.membership_status,s.last_seen_at,img.local_path,
      COALESCE(img.content_sha256,img.sha256) AS image_sha256
    FROM catalog_pool_version_items i JOIN catalog_staging_products s ON s.id=i.staging_product_id
    LEFT JOIN products p ON p.platform=i.platform AND p.external_product_id=i.goods_id
    LEFT JOIN product_images img ON img.id=(SELECT pi.id FROM product_images pi
      WHERE pi.product_id=p.id AND pi.download_status='completed' ORDER BY pi.downloaded_at DESC,pi.id DESC LIMIT 1)
    WHERE i.pool_version_id=? ORDER BY i.id`).all(poolVersion.id);
  const newItems=db.prepare(`SELECT s.* FROM catalog_staging_products s
    WHERE s.campaign_id=? AND s.electronic_screening_status='passed'
      AND NOT EXISTS(SELECT 1 FROM catalog_campaign_baseline_items b
        WHERE b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id)
    ORDER BY s.first_seen_sequence LIMIT ?`).all(campaignId,campaign.targetCount-campaign.baselinePoolCount);
  const staging=db.prepare(`SELECT s.*,CASE WHEN b.id IS NULL THEN 'new_candidate' ELSE 'baseline_overlap' END AS expansion_status
    FROM catalog_staging_products s LEFT JOIN catalog_campaign_baseline_items b
      ON b.campaign_id=s.campaign_id AND b.platform=s.platform AND b.goods_id=s.goods_id
    WHERE s.campaign_id=? ORDER BY s.first_seen_sequence`).all(campaignId);
  const exclusions=db.prepare(`SELECT goods_id,MAX(title) AS title,exclusion_code,MAX(exclusion_reason) AS exclusion_reason,
      MAX(classifier_version) AS classifier_version,MAX(confidence) AS confidence,COUNT(*) AS observation_count,
      MIN(detected_at) AS first_detected_at,MAX(detected_at) AS last_detected_at
    FROM catalog_exclusion_observations WHERE campaign_id=? GROUP BY goods_id,exclusion_code ORDER BY goods_id,exclusion_code`).all(campaignId);
  const exclusionCodes=db.prepare(`SELECT exclusion_code,COUNT(DISTINCT goods_id) AS unique_goods_count,COUNT(*) AS observation_count
    FROM catalog_exclusion_observations WHERE campaign_id=? GROUP BY exclusion_code ORDER BY exclusion_code`).all(campaignId);
  const batches=db.prepare(`SELECT COUNT(*) AS accepted_batches,COALESCE(SUM(received_count),0) AS raw_received,
      COALESCE(SUM(staging_count),0) AS staging_writes,COALESCE(SUM(excluded_count),0) AS exclusion_hits,
      COALESCE(SUM(duplicate_count),0) AS duplicate_observations,MIN(captured_at) AS first_batch_at,MAX(captured_at) AS last_batch_at
    FROM catalog_capture_batches WHERE campaign_id=? AND processing_status='accepted'`).get(campaignId);
  const counts={ products:Number(db.prepare('SELECT COUNT(*) count FROM products').get().count),
    activeMemberships:Number(db.prepare('SELECT COUNT(*) count FROM catalog_memberships WHERE active=1').get().count),
    snapshots:Number(db.prepare('SELECT COUNT(*) count FROM product_snapshots').get().count),reviews:Number(db.prepare('SELECT COUNT(*) count FROM reviews').get().count),
    poolVersions:Number(db.prepare('SELECT COUNT(*) count FROM catalog_pool_versions').get().count) };
  const uniqueExcluded=Number(db.prepare('SELECT COUNT(DISTINCT goods_id) count FROM catalog_exclusion_observations WHERE campaign_id=?').get(campaignId).count);
  return { campaign,status,poolVersion,currentPool,newItems,staging,exclusions,exclusionCodes,batches,counts,
    comparison:status.expansionComparison,quality:status.expansionQualityMetrics,materialization:status.materialization,
    rowCounts:{ currentPool:currentPool.length,newItems:newItems.length,staging:staging.length,exclusions:exclusions.length,sources:status.sourceContributions.length },
    sqliteReconciliation:{ poolItems:currentPool.length,newItems:newItems.length,campaignNonElectronic:campaign.nonElectronicUniqueCount,uniqueExcluded } };
}

export function buildCatalogExpansionWorkbook({ Workbook },model,{ clickableLinks=true,imageDataByGoodsId=new Map() }={}) {
  const workbook=Workbook.create();const sheets=Object.fromEntries(SHEETS.map(name=>[name,workbook.worksheets.add(name)]));
  Object.values(sheets).forEach(sheet=>{sheet.showGridLines=false;});
  const imageCount=productsSheet(sheets['当前1500商品池'],model.currentPool,'CatalogExpansionPool',clickableLinks,imageDataByGoodsId)
    +newItemsSheet(sheets['本轮新增500'],model.newItems,clickableLinks,imageDataByGoodsId)
    +stagingSheet(sheets.Staging,model.staging,clickableLinks,imageDataByGoodsId);
  exclusionSheet(sheets['电子排除'],model);sourceSheet(sheets['来源贡献'],model);qualitySheet(sheets['数据质量'],model);
  campaignSheet(sheets['Campaign任务'],model);fieldsSheet(sheets['字段说明']);return { workbook,sheetNames:SHEETS,imageCount };
}

function productsSheet(sheet,items,tableName,clickable,imageDataByGoodsId) {
  const headers=['序号','商品主图','goods_id','商品标题','当前观察链接','身份/历史链接','价格','币种','销量','评分','评论数','Pool状态','最后观察'];
  const rows=items.map((r,i)=>[i+1,null,`'${r.goods_id}`,r.latest_title,null,null,r.price_amount,r.currency,r.sales_count,r.rating,r.review_count,r.membership_status,toDate(r.last_seen_at)]);
  writeTable(sheet,headers,rows,tableName,[7,16,20,52,60,48,12,9,12,9,12,14,22]);
  writeLinks(sheet,'E',items.map(currentObservedUrl),2,clickable);writeLinks(sheet,'F',items.map(r=>r.canonical_url),2,clickable);
  formatProducts(sheet,rows.length,'M');return addProductImages(sheet,items,imageDataByGoodsId);
}
function newItemsSheet(sheet,items,clickable,imageDataByGoodsId) {
  const headers=['序号','商品主图','goods_id','商品标题','当前观察链接','身份/历史链接','价格','币种','销量','评分','评论数','首次来源','首次顺序','最后观察'];
  const rows=items.map((r,i)=>[i+1,null,`'${r.goods_id}`,r.latest_title,null,null,r.price_amount,r.currency,r.sales_count,r.rating,r.review_count,r.first_source_id,r.first_seen_sequence,toDate(r.last_seen_at)]);
  writeTable(sheet,headers,rows,'CatalogExpansionNew500',[7,16,20,52,60,48,12,9,12,9,12,38,11,22]);
  writeLinks(sheet,'E',items.map(currentObservedUrl),2,clickable);writeLinks(sheet,'F',items.map(r=>r.canonical_url),2,clickable);
  formatProducts(sheet,rows.length,'N');return addProductImages(sheet,items,imageDataByGoodsId);
}
function stagingSheet(sheet,items,clickable,imageDataByGoodsId) {
  const headers=['序号','商品主图','goods_id','商品标题','当前观察链接','身份/历史链接','价格','币种','销量','评分','评论数','电子筛选','扩容状态','首次来源','首次顺序','最后观察'];
  const rows=items.map((r,i)=>[i+1,null,`'${r.goods_id}`,r.latest_title,null,null,r.price_amount,r.currency,r.sales_count,r.rating,r.review_count,r.electronic_screening_status,r.expansion_status,r.first_source_id,r.first_seen_sequence,toDate(r.last_seen_at)]);
  writeTable(sheet,headers,rows,'CatalogExpansionStaging',[7,16,20,52,60,48,12,9,12,9,12,22,20,38,11,22]);
  writeLinks(sheet,'E',items.map(currentObservedUrl),2,clickable);writeLinks(sheet,'F',items.map(r=>r.canonical_url),2,clickable);
  if(rows.length)sheet.getRange(`G2:G${rows.length+1}`).format.numberFormat='€#,##0.00';if(rows.length)sheet.getRange(`P2:P${rows.length+1}`).format.numberFormat='yyyy-mm-dd hh:mm';
  return addProductImages(sheet,items,imageDataByGoodsId);
}
function exclusionSheet(sheet,model) {
  sheet.getRange('A1:D1').values=[['排除代码','唯一商品数','观察次数','口径']];header(sheet.getRange('A1:D1'));
  const summary=model.exclusionCodes.map(r=>[r.exclusion_code,Number(r.unique_goods_count),Number(r.observation_count),'代码间可重叠，不能直接相加']);if(summary.length){sheet.getRange(`A2:D${summary.length+1}`).values=summary;body(sheet.getRange(`A2:D${summary.length+1}`));}
  const start=summary.length+4;const rows=model.exclusions.map(r=>[`'${r.goods_id}`,r.title,r.exclusion_code,r.exclusion_reason,r.classifier_version,r.confidence,Number(r.observation_count),toDate(r.first_detected_at),toDate(r.last_detected_at)]);
  sheet.getRange(`A${start}:I${start}`).values=[['goods_id','商品标题','排除代码','排除原因','分类器版本','置信度','观察次数','首次发现','最后发现']];header(sheet.getRange(`A${start}:I${start}`));
  if(rows.length){const last=start+rows.length;sheet.getRange(`A${start+1}:I${last}`).values=rows;body(sheet.getRange(`A${start+1}:I${last}`));sheet.tables.add(`A${start}:I${last}`,true,'CatalogExpansionExclusions').style='TableStyleMedium2';sheet.getRange(`F${start+1}:F${last}`).format.numberFormat='0.0%';sheet.getRange(`H${start+1}:I${last}`).format.numberFormat='yyyy-mm-dd hh:mm';}
  [20,52,28,56,22,12,12,22,22].forEach((w,i)=>sheet.getRange(`${col(i+1)}:${col(i+1)}`).format.columnWidth=w);sheet.freezePanes.freezeRows(start);
}
function sourceSheet(sheet,model) {
  const rows=model.status.sourceContributions.map(r=>[r.sourceId,r.sourceKey,r.rawObservedCount,r.sourceUniqueCount,r.campaignNewUniqueCount,r.campaignOverlapCount,r.electronicExcludedCount,r.manualReviewCount,r.eligibleNewCount,sourceStop(model.status,r.sourceId)]);
  writeTable(sheet,['source_id','source_key','raw_observed','source_unique','campaign_new_unique','overlap','electronic_excluded','manual_review','non_electronic_new','stop_reason'],rows,'CatalogExpansionSources',[38,30,16,16,20,14,20,16,22,28]);
  const b=model.batches;sheet.getRange('L1:M1').values=[['批次指标','值']];header(sheet.getRange('L1:M1'));sheet.getRange('L2:M8').values=[['accepted_batches',Number(b.accepted_batches)],['raw_received',Number(b.raw_received)],['staging_writes',Number(b.staging_writes)],['exclusion_hits',Number(b.exclusion_hits)],['duplicate_observations',Number(b.duplicate_observations)],['first_batch_at',b.first_batch_at],['last_batch_at',b.last_batch_at]];body(sheet.getRange('L2:M8'));sheet.getRange('L:M').format.columnWidth=26;
}
function qualitySheet(sheet,model) {
  const q=model.quality,m=model.materialization,c=model.comparison;const rows=[['Active candidate',c.activeCandidateCount,model.campaign.targetCount,"'="],['净新增',c.newNonElectronicCount,c.newUniqueNeeded,"'="],['goods_id duplicate',q.duplicateGoodsIdCount,0,"'="],['电子进入候选池',q.electronicInCandidateCount,0,"'="],['标题完整度',q.titleCoverage,0.95,'>='],['价格完整度',q.priceCoverage,0.95,'>='],['图片完整度',q.imageCoverage,0.95,'>='],['销量完整度',q.salesCoverage,0.90,'>='],['评分完整度',q.ratingCoverage,0.90,'>='],['评论数完整度',q.reviewCountCoverage,0.90,'>='],['新增Snapshots',m?.snapshotsInserted,c.newUniqueNeeded,"'="],['Reviews变化',m?m.reviewsAfter-m.reviewsBefore:null,0,"'="]];
  writeTable(sheet,['指标','实际','阈值','规则'],rows,'CatalogExpansionQuality',[30,18,18,12]);sheet.getRange('B6:C11').format.numberFormat='0.0%';sheet.getRange('F1:G1').values=[['SQLite计数','值']];header(sheet.getRange('F1:G1'));sheet.getRange('F2:G6').values=Object.entries(model.counts);body(sheet.getRange('F2:G6'));sheet.getRange('F:G').format.columnWidth=24;
}
function campaignSheet(sheet,model) {
  const c=model.campaign,queues=model.status.queues;const sums=queues.reduce((a,q)=>{const p=q.checkpoint??{};for(const k of ['round','retry_count','manual_intervention_count','captcha_count','oops_count','load_more_success_count','elapsed_ms'])a[k]+=Number(p[k]??0);return a;},{round:0,retry_count:0,manual_intervention_count:0,captcha_count:0,oops_count:0,load_more_success_count:0,elapsed_ms:0});
  const rows=[['campaign_id',c.id],['campaign_type',c.campaignType],['status',c.status],['qa_status',c.qaStatus],['baseline_count',c.baselinePoolCount],['target_count',c.targetCount],['non_electronic_unique_count',c.nonElectronicUniqueCount],['raw_observed_count',c.rawObservedCount],['electronic_excluded_unique',c.electronicExcludedCount],['browser_profile_name',c.browserProfileName],['browser_profile_directory',c.browserProfileDirectory],['browser_control_mode',c.browserControlMode],['sources',c.sourceCount],['completed_sources',c.completedSourceCount],...Object.entries(sums)];writeTable(sheet,['任务字段','值'],rows,'CatalogExpansionCampaign',[36,76]);
}
function fieldsSheet(sheet){const rows=[['platform + goods_id','跨batch/source/campaign稳定身份','SQLite','URL不作为身份键'],['baseline_count','激活前正式1000 Pool','SQLite','扩容全过程冻结'],['new_non_electronic_unique','相对baseline净新增passed商品','Staging','目标500'],['manual_review_required','需人工判断','Staging','不计1500 Gate'],['exclusion_code','电子硬排除审计','Exclusion audit','不得进入Pool'],['Pool Version','baseline与新增的事务合并版本','SQLite','1500激活后1000 superseded'],['当前观察链接','本轮商品卡捕获的详情地址','Staging','优先用于打开商品；仍受Temu Session Context影响'],['身份/历史链接','goods_id canonical URL','SQLite','只用于身份和历史证据，不代表当前可售'],['商品主图','压缩后嵌入Excel','Artifact','不依赖点击图片链接'],['Excel','运营查看与交接','Artifact','SQLite是唯一正式数据源']];writeTable(sheet,['字段','定义','来源','口径说明'],rows,'CatalogExpansionFields',[38,52,24,66]);}

function writeTable(sheet,headers,rows,name,widths){const end=col(headers.length);sheet.getRange(`A1:${end}1`).values=[headers];header(sheet.getRange(`A1:${end}1`));if(rows.length){const last=rows.length+1;sheet.getRange(`A2:${end}${last}`).values=rows;body(sheet.getRange(`A2:${end}${last}`));const table=sheet.tables.add(`A1:${end}${last}`,true,name);table.style='TableStyleMedium2';table.showFilterButton=true;}widths.forEach((w,i)=>sheet.getRange(`${col(i+1)}:${col(i+1)}`).format.columnWidth=w);sheet.freezePanes.freezeRows(1);}
function writeLinks(sheet,column,urls,startRow,clickable){if(!urls.length)return;const range=sheet.getRange(`${column}${startRow}:${column}${startRow+urls.length-1}`);if(clickable)range.formulas=urls.map(url=>[`=HYPERLINK("${excel(url)}","${excel(url)}")`]);else range.values=urls.map(url=>[url]);range.format.font={color:'#0563C1',underline:true};range.format.wrapText=true;}
function formatProducts(sheet,count,dateColumn){if(!count)return;const last=count+1;sheet.getRange(`G2:G${last}`).format.numberFormat='€#,##0.00';sheet.getRange(`I2:I${last}`).format.numberFormat='#,##0';sheet.getRange(`J2:J${last}`).format.numberFormat='0.0';sheet.getRange(`K2:K${last}`).format.numberFormat='#,##0';sheet.getRange(`${dateColumn}2:${dateColumn}${last}`).format.numberFormat='yyyy-mm-dd hh:mm';sheet.getRange(`D2:F${last}`).format.wrapText=true;sheet.getRange(`A2:${dateColumn}${last}`).format.rowHeight=78;sheet.freezePanes.freezeColumns(3);}
function addProductImages(sheet,items,imageDataByGoodsId){let count=0;items.forEach((item,index)=>{const dataUrl=imageDataByGoodsId.get(String(item.goods_id));if(!dataUrl)return;sheet.images.add({ dataUrl,anchor:{ from:{ row:index+1,col:1,rowOffsetPx:4,colOffsetPx:4 },extent:{ widthPx:88,heightPx:68 } } });count+=1;});return count;}
function currentObservedUrl(row){return row.latest_source_url||row.canonical_url;}
function header(range){range.format={fill:COLORS.navy,font:{bold:true,color:'#FFFFFF',size:11},verticalAlignment:'center',horizontalAlignment:'center',wrapText:true,borders:{preset:'outside',style:'thin',color:'#95B3D7'}};range.format.rowHeight=34;}
function body(range){range.format={font:{color:COLORS.text,size:10},verticalAlignment:'center',borders:{insideHorizontal:{style:'thin',color:'#E5E7EB'}}};}
function sourceStop(status,sourceId){const queue=status.queues.find(q=>q.sourceId===sourceId);return queue?.checkpoint?.stopReason??queue?.checkpoint?.stop_reason??queue?.lastErrorCode??queue?.status??null;}
function col(n){let result='';for(let value=n;value>0;value=Math.floor((value-1)/26))result=String.fromCharCode(65+((value-1)%26))+result;return result;}
function excel(value){return String(value??'').replaceAll('"','""');}
function toDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date;}

export async function prepareExpansionImages(items,{ baseDir,cacheDir,fetchImpl=fetch,concurrency=8 }={}) {
  await fs.mkdir(cacheDir,{ recursive:true });const imageDataByGoodsId=new Map();const failures=[];let cursor=0;
  async function worker(){while(cursor<items.length){const item=items[cursor++];const goodsId=String(item.goods_id);const targetPath=path.join(cacheDir,`${goodsId}.jpg`);try{
      let bytes=await fs.readFile(targetPath).catch(()=>null);
      if(!bytes){let source=null;const localPath=item.local_path ? (path.isAbsolute(item.local_path)?item.local_path:path.resolve(baseDir,item.local_path)) : null;
        if(localPath)source=await fs.readFile(localPath).catch(()=>null);
        if(!source&&item.image_url){const response=await fetchImpl(item.image_url,{ signal:AbortSignal.timeout(20000) });if(!response.ok)throw new Error(`HTTP_${response.status}`);source=Buffer.from(await response.arrayBuffer());}
        if(!source)throw new Error('IMAGE_SOURCE_UNAVAILABLE');const temporaryPath=`${targetPath}.${process.pid}.tmp`;
        await sharp(source).rotate().resize({ width:120,height:120,fit:'contain',background:'#FFFFFF',withoutEnlargement:true }).jpeg({ quality:68,mozjpeg:true }).toFile(temporaryPath);
        await fs.rename(temporaryPath,targetPath);bytes=await fs.readFile(targetPath);
      }
      imageDataByGoodsId.set(goodsId,`data:image/jpeg;base64,${bytes.toString('base64')}`);
    }catch(error){failures.push({ goods_id:goodsId,error:error.code??error.message });}}
  }
  await Promise.all(Array.from({ length:Math.max(1,Math.min(concurrency,items.length||1)) },()=>worker()));return { imageDataByGoodsId,failures };
}
