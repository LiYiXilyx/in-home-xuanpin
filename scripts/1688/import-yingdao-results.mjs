import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../src/config/load.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createSourcingRepository } from '../../src/db/repositories/sourcing-repository.mjs';
import { loadArtifactTool } from '../../src/modules/analysis/artifact-runtime.mjs';
import { createOpportunityAnalysisService } from '../../src/modules/opportunity/opportunity-analysis-service.mjs';
import { enrichOpportunityGrouping } from '../../src/modules/opportunity/opportunity-grouping.mjs';
import { assertExactHeaders,derive1688ProductId,loadSourcingConfig,parseRmbPrice,scoreCandidate,SEARCH_STATUSES,validateHttpUrl,YINGDAO_OUTPUT_HEADERS } from '../../src/modules/sourcing/sourcing-1688.mjs';

export async function importYingdaoResults({
  workbookPath='outputs/1688-sourcing-v1/yingdao-output.xlsx',appConfigPath='config.json',
  sourcingConfigPath='config/1688-sourcing-v1.json',databasePath=null,dryRun=false,artifact=null,
}={}) {
  const appConfig=await loadConfig(appConfigPath),sourcingConfig=loadSourcingConfig(sourcingConfigPath);
  const tools=artifact??await loadArtifactTool();const workbook=await tools.SpreadsheetFile.importXlsx(await tools.FileBlob.load(workbookPath));
  const sheet=workbook.worksheets.getItem('1688候选'),values=sheet.getUsedRange(true)?.values??[];
  assertExactHeaders((values[0]??[]).slice(0,YINGDAO_OUTPUT_HEADERS.length),YINGDAO_OUTPUT_HEADERS,'1688候选');
  const rawRows=values.slice(1).filter(row=>String(row?.[0]??'').trim()||String(row?.[1]??'').trim());
  if(!rawRows.length)throw new Error('yingdao-output.xlsx 没有数据行。');
  const rows=rawRows.map((row,index)=>mapRow(row,index+2));const runIds=new Set(rows.map(row=>row.runId));
  if(runIds.size!==1||![...runIds][0])throw new Error('所有行必须使用同一个非空 run_id。');const runId=[...runIds][0];
  const db=openDatabase(databasePath??appConfig.app.databasePath,{readOnly:dryRun});
  try {
    const active=db.prepare("SELECT * FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get('motorcycle-accessories');
    if(!active||Number(active.product_count)!==2135)throw new Error(`Active Pool 安全门失败：${active?.product_count??'MISSING'}`);
    const result=createOpportunityAnalysisService(db).getResult();const activeById=new Map(result.items.map(item=>{const x=enrichOpportunityGrouping(item);return [String(x.goodsId),x];}));
    const groups=groupRows(rows);if(groups.size>sourcingConfig.v1MaxInputGoods)throw new Error(`V1 最多只允许${sourcingConfig.v1MaxInputGoods}个商品，实际=${groups.size}`);
    const items=[],candidates=[];
    for(const [goodsId,group] of groups){
      const expected=activeById.get(goodsId);if(!expected)throw new Error(`goods_id 不在当前 Active Pool：${goodsId}`);
      validateIdentity(group,expected);const candidateRows=group.filter(hasCandidateData);if(candidateRows.length>sourcingConfig.maxCandidatesPerGoods)throw new Error(`${goodsId} 候选超过5个。`);
      const ranks=new Set(),products=new Set(),urls=new Set();
      for(const row of candidateRows){
        if(!Number.isInteger(row.candidateRank)||row.candidateRank<1||row.candidateRank>5)throw rowError(row,'candidate_rank 必须为1–5');
        if(ranks.has(row.candidateRank))throw rowError(row,'candidate_rank 重复');ranks.add(row.candidateRank);
        if(row.searchStatus!=='SEARCH_SUCCESS')throw rowError(row,'有候选数据时 search_status 必须为 SEARCH_SUCCESS');
        const supplierUrl=validateHttpUrl(row.productUrl,{platform:'1688'});const urlProductId=derive1688ProductId(supplierUrl);
        const supplierProductId=String(row.productId??'').trim()||urlProductId;if(!supplierProductId)throw rowError(row,'1688_product_id 不能为空且URL无法推导');
        if(urlProductId&&urlProductId!==supplierProductId)throw rowError(row,'1688_product_id 与商品URL不一致');
        if(products.has(supplierProductId)||urls.has(supplierUrl))throw rowError(row,'同一商品候选重复');products.add(supplierProductId);urls.add(supplierUrl);
        if(!row.supplierTitle)throw rowError(row,'1688_title 不能为空');const price=parseRmbPrice({raw:row.priceRaw,min:row.priceMin,max:row.priceMax});
        const capturedAt=parseIso(row.capturedAt,row,'captured_at');const moq=parseMoq(row.moq,row);
        const score=scoreCandidate({temuTitle:expected.title,supplierTitle:row.supplierTitle,level1:expected.level1Scene,level2:expected.productType,
          level3:expected.level3Segment,similarCluster:expected.similarProductCluster,weights:sourcingConfig.similarityWeights});
        candidates.push({goodsId,candidateRank:row.candidateRank,supplierProductId,supplierTitle:row.supplierTitle,supplierUrl,
          supplierImageUrl:row.imageUrl?validateHttpUrl(row.imageUrl):null,supplierImageLocalPath:null,priceRaw:price.raw,priceMinRmb:price.min,priceMaxRmb:price.max,
          priceMinEur:round(price.min*Number(sourcingConfig.fx.rate),4),priceMaxEur:round(price.max*Number(sourcingConfig.fx.rate),4),moq,shopName:row.shopName||null,
          ...score,capturedAt,searchStatus:row.searchStatus,manualReviewRequired:true,notes:row.notes||null});
      }
      const statuses=new Set(group.map(row=>row.searchStatus).filter(status=>status!=='PENDING'));const searchStatus=candidateRows.length?'SEARCH_SUCCESS':([...statuses][0]??'PENDING');
      if(statuses.size>1&&!candidateRows.length)throw new Error(`${goodsId} 存在互相冲突的 search_status。`);
      items.push({goodsId,title:expected.title,imagePath:group[0].imagePath,level1:expected.level1Scene,level2:expected.productType,level3:expected.level3Segment,
        similarCluster:expected.similarProductCluster,searchStatus,candidateCount:candidateRows.length,manualReviewRequired:true,notes:uniqueNotes(group)});
    }
    const processedCount=items.filter(item=>item.searchStatus!=='PENDING').length;if(processedCount===0)throw new Error('输出仍全部为 PENDING；影刀尚未实际执行，拒绝写入 SQLite。');
    const timestamps=candidates.map(c=>c.capturedAt).sort();const now=new Date().toISOString();const run={runId,method:sourcingConfig.method,
      startedAt:timestamps[0]??now,finishedAt:timestamps.at(-1)??now,status:'NEEDS_REVIEW',inputCount:items.length,processedCount,
      fxPair:sourcingConfig.fx.pair,fxRate:Number(sourcingConfig.fx.rate),fxSource:sourcingConfig.fx.source,fxObservedAt:sourcingConfig.fx.observedAt,
      scoringWeights:sourcingConfig.similarityWeights};
    const report={dryRun,run,items,candidates,activePoolBefore:Number(active.product_count),activePoolAfter:Number(active.product_count),
      safety:{temuTablesUpdated:false,imageSimilarity:'NOT_IMPLEMENTED',overallSimilarity:'NULL',manualReviewForced:true}};
    if(!dryRun)report.insert=createSourcingRepository(db).insertImportedRun({run,items,candidates});return report;
  } finally {db.close();}
}

function mapRow(row,rowNumber){return {rowNumber,runId:text(row[0]),goodsId:text(row[1]),title:text(row[2]),imagePath:text(row[3]),candidateRank:number(row[4]),
  productId:text(row[5]),supplierTitle:text(row[6]),priceRaw:text(row[7]),priceMin:row[8],priceMax:row[9],moq:row[10],shopName:text(row[11]),
  productUrl:text(row[12]),imageUrl:text(row[13]),searchStatus:text(row[14]),manualReviewRequired:row[15],capturedAt:row[16],notes:text(row[17])};}
function groupRows(rows){const groups=new Map();for(const row of rows){if(!row.goodsId)throw rowError(row,'temu_goods_id 不能为空');if(!SEARCH_STATUSES.has(row.searchStatus))throw rowError(row,`search_status 无效：${row.searchStatus}`);const list=groups.get(row.goodsId)??[];list.push(row);groups.set(row.goodsId,list);}return groups;}
function validateIdentity(group,expected){for(const row of group){if(row.title!==expected.title)throw rowError(row,'temu_title 与 Active Pool 不一致');if(row.imagePath!==group[0].imagePath)throw rowError(row,'同一 goods_id 的 temu_image_path 不一致');if(!path.isAbsolute(row.imagePath)||!fs.existsSync(row.imagePath))throw rowError(row,'temu_image_path 必须是存在的绝对路径');}}
function hasCandidateData(row){return [row.productId,row.supplierTitle,row.priceRaw,row.priceMin,row.priceMax,row.moq,row.shopName,row.productUrl,row.imageUrl,row.capturedAt].some(value=>String(value??'').trim()!=='');}
function parseIso(value,row,label){const date=value instanceof Date?value:typeof value==='number'?new Date((value-25569)*86400000):new Date(value);if(Number.isNaN(date.getTime()))throw rowError(row,`${label} 必须是有效日期时间`);return date.toISOString();}
function parseMoq(value,row){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);if(!Number.isInteger(n)||n<1)throw rowError(row,'1688_moq 必须是正整数');return n;}
function uniqueNotes(rows){return [...new Set(rows.map(row=>row.notes).filter(Boolean))].join('；')||null;}
function rowError(row,message){return new Error(`第${row.rowNumber}行：${message}`);}
function text(value){return String(value??'').trim().replace(/^'/,'');}
function number(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function round(value,digits){const factor=10**digits;return Math.round((value+Number.EPSILON)*factor)/factor;}

function parseArgs(argv){const args={};for(let i=2;i<argv.length;i++){if(argv[i]==='--input')args.workbookPath=argv[++i];else if(argv[i]==='--config')args.appConfigPath=argv[++i];else if(argv[i]==='--sourcing-config')args.sourcingConfigPath=argv[++i];else if(argv[i]==='--database')args.databasePath=argv[++i];else if(argv[i]==='--dry-run')args.dryRun=true;else throw new Error(`未知参数：${argv[i]}`);}return args;}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{console.log(JSON.stringify(await importYingdaoResults(parseArgs(process.argv)),null,2));}catch(e){console.error(e.stack??e);process.exitCode=1;}}
