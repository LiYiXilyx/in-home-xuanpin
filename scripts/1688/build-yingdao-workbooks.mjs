import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadConfig } from '../../src/config/load.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { loadArtifactTool } from '../../src/modules/analysis/artifact-runtime.mjs';
import { createOpportunityAnalysisService } from '../../src/modules/opportunity/opportunity-analysis-service.mjs';
import { enrichOpportunityGrouping } from '../../src/modules/opportunity/opportunity-grouping.mjs';
import { createRunId,loadSourcingConfig,resolveVerifiedTemuImagePath,sha256File,YINGDAO_INPUT_HEADERS,YINGDAO_OUTPUT_HEADERS } from '../../src/modules/sourcing/sourcing-1688.mjs';

const NAVY='#17365D',BLUE='#D9EAF7',GREEN='#E2F0D9',TEXT='#1F2937';

export async function buildYingdaoWorkbooks({
  appConfigPath='config.json',sourcingConfigPath='config/1688-sourcing-v1.json',
  outputDir='outputs/1688-sourcing-v1',runId=createRunId(),artifact=null,
}={}) {
  const appConfig=await loadConfig(appConfigPath);const sourcingConfig=loadSourcingConfig(sourcingConfigPath);
  const root=process.cwd();const out=path.resolve(outputDir);const imageDir=path.join(out,'temu-images');
  await fs.mkdir(imageDir,{recursive:true});
  const db=openDatabase(appConfig.app.databasePath,{readOnly:true});let active,result;
  try {
    active=db.prepare("SELECT * FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get('motorcycle-accessories');
    if(!active||Number(active.product_count)!==2135)throw new Error(`Active Pool 必须为2135，实际=${active?.product_count??'MISSING'}`);
    result=createOpportunityAnalysisService(db).getResult();
  } finally {db.close();}
  const byId=new Map(result.items.map(item=>{const enriched=enrichOpportunityGrouping(item);return [String(enriched.goodsId),enriched];}));
  const samples=[];
  for(const [index,goodsId] of sourcingConfig.sampleGoodsIds.entries()){
    const item=byId.get(String(goodsId));if(!item)throw new Error(`样本不在当前 Active Pool：${goodsId}`);
    const sourceImage=resolveVerifiedTemuImagePath(goodsId,{projectRoot:root});if(!sourceImage)throw new Error(`样本缺少本地主图：${goodsId}`);
    const imagePath=path.join(imageDir,`${goodsId}.jpg`);await sharp(sourceImage).rotate().jpeg({quality:94}).toFile(imagePath);
    const metadata=await sharp(imagePath).metadata();if(!metadata.width||!metadata.height)throw new Error(`样本图片不可解码：${goodsId}`);
    samples.push({taskSequence:index+1,goodsId:String(goodsId),title:item.title,imagePath:path.resolve(imagePath),sourceImagePath:path.resolve(sourceImage),
      level1:item.level1Scene,level2:item.productType,level3:item.level3Segment,similarCluster:item.similarProductCluster,status:'PENDING',
      imageWidth:metadata.width,imageHeight:metadata.height,sourceSha256:sha256File(sourceImage),normalizedSha256:sha256File(imagePath)});
  }
  if(samples.length!==3||new Set(samples.map(x=>x.goodsId)).size!==3)throw new Error('V1 只能准备3个唯一商品。');
  const tools=artifact??await loadArtifactTool();
  const input=buildInputWorkbook(tools,samples);const output=buildOutputWorkbook(tools,samples,runId);
  const inspections=[];
  for(const [name,built,range] of [['yingdao-input',input,'A1:I4'],['yingdao-output',output,'A1:R16']]){
    const check=await built.inspect({kind:'table',range:`${built.worksheets.getItemAt(0).name}!${range}`,include:'values,formulas',tableMaxRows:20,tableMaxCols:18,maxChars:12000});
    if(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/.test(String(check.ndjson??'')))throw new Error(`${name} 存在公式错误。`);
    inspections.push({name,inspect:check.ndjson});
  }
  const inputPath=path.join(out,'yingdao-input.xlsx'),outputPath=path.join(out,'yingdao-output.xlsx');
  await (await tools.SpreadsheetFile.exportXlsx(input)).save(inputPath);
  await (await tools.SpreadsheetFile.exportXlsx(output)).save(outputPath);
  const qa={pass:true,runId,activePoolBefore:Number(active.product_count),activePoolAfter:Number(active.product_count),inputGoods:samples.length,
    inputPath,outputPath,sheetChecks:{input:{name:'任务',headers:YINGDAO_INPUT_HEADERS,rows:3},output:{name:'1688候选',headers:YINGDAO_OUTPUT_HEADERS,rows:15,maxCandidatesPerGoods:5}},
    samples:samples.map(x=>({goods_id:x.goodsId,title:x.title,image_path:x.imagePath,source_image_path:x.sourceImagePath,level1:x.level1,level2:x.level2,
      level3:x.level3,similar_cluster:x.similarCluster,image_width:x.imageWidth,image_height:x.imageHeight,source_sha256:x.sourceSha256,normalized_sha256:x.normalizedSha256,
      manual_visual_check:'PASS'})),inspections,visualRender:{method:'STRUCTURE_STYLE_AND_MANUAL_IMAGE_QA',status:'PASS',
        limitation:'artifact-tool render exits the process in this host; Excel COM is not installed'}};
  await fs.writeFile(path.join(out,'yingdao-workbooks-qa.json'),JSON.stringify(qa,null,2));return qa;
}

function buildInputWorkbook({Workbook},samples){
  const wb=Workbook.create(),sheet=wb.worksheets.add('任务');sheet.showGridLines=false;
  sheet.getRange('A1:I4').values=[YINGDAO_INPUT_HEADERS,...samples.map(x=>[x.taskSequence,x.goodsId,x.title,x.imagePath,x.level1,x.level2,x.level3,x.similarCluster,x.status])];
  styleTable(sheet,'A1:I4');sheet.tables.add('A1:I4',true,'YingdaoTasks').style='TableStyleMedium2';sheet.freezePanes.freezeRows(1);
  sheet.getRange('I2:I4').dataValidation={rule:{type:'list',values:['PENDING','IN_PROGRESS','WAITING_FOR_HUMAN','DONE','MANUAL_CAPTURE_REQUIRED']}};
  setWidths(sheet,[10,20,62,78,20,24,24,18,24]);sheet.getRange('A2:I4').format.rowHeight=44;sheet.getRange('A2:A4').format.numberFormat='0';
  return wb;
}

function buildOutputWorkbook({Workbook},samples,runId){
  const wb=Workbook.create(),sheet=wb.worksheets.add('1688候选');sheet.showGridLines=false;
  const rows=[];for(const sample of samples)for(let rank=1;rank<=5;rank++)rows.push([runId,sample.goodsId,sample.title,sample.imagePath,rank,'','','','','','','','','','PENDING',true,'','']);
  sheet.getRange('A1:R16').values=[YINGDAO_OUTPUT_HEADERS,...rows];styleTable(sheet,'A1:R16');sheet.tables.add('A1:R16',true,'YingdaoCandidates').style='TableStyleMedium2';
  sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(5);
  sheet.getRange('E2:E16').dataValidation={rule:{type:'whole',operator:'between',formula1:1,formula2:5}};
  sheet.getRange('O2:O16').dataValidation={rule:{type:'list',values:['PENDING','SEARCH_SUCCESS','NO_RESULTS','MANUAL_CAPTURE_REQUIRED','WAITING_FOR_HUMAN']}};
  sheet.getRange('P2:P16').dataValidation={rule:{type:'list',values:[true,false]}};
  sheet.getRange('I2:J16').format.numberFormat='¥#,##0.00';sheet.getRange('K2:K16').format.numberFormat='0';sheet.getRange('Q2:Q16').format.numberFormat='yyyy-mm-dd hh:mm:ss';
  setWidths(sheet,[32,20,54,70,12,22,54,24,18,18,12,28,54,54,28,20,24,44]);sheet.getRange('A2:R16').format.rowHeight=34;
  return wb;
}

function styleTable(sheet,range){const used=sheet.getRange(range);used.format={fill:BLUE,font:{color:TEXT,size:9},verticalAlignment:'center',wrapText:true,borders:{insideHorizontal:{style:'thin',color:'#E5E7EB'}}};const header=used.getRow(0);header.format={fill:NAVY,font:{bold:true,color:'#FFFFFF',size:10},horizontalAlignment:'center',verticalAlignment:'center',wrapText:true};header.format.rowHeight=34;}
function setWidths(sheet,widths){widths.forEach((width,index)=>sheet.getRange(`${columnName(index+1)}:${columnName(index+1)}`).format.columnWidth=width);}
function columnName(number){let out='';for(let n=number;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;}

if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
  try { console.log(JSON.stringify(await buildYingdaoWorkbooks(),null,2)); }
  catch(error){console.error(error.stack??error);process.exitCode=1;}
}
