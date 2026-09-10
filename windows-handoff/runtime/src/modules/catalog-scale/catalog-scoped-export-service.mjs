import sharp from 'sharp';
import crypto from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';
import {loadArtifactTool} from '../analysis/artifact-runtime.mjs';

export const SCOPED_SHEETS=Object.freeze(['01_商品明细','02_数据质量','03_采集任务','04_类目配置','05_待分类说明']);

export function createCatalogScopedExportService({repository,outputDir,artifactLoader=loadArtifactTool,imageLoader=loadMainImage}={}){
  async function save(result){const model=buildCatalogScopedWorkbookModel(result),artifact=await artifactLoader();
    if(model.metadata.export_type==='FORMAL_POOL'){for(const row of model.products){try{row.image_data=await imageLoader(row.image_url);row.image_status='OK';}catch(e){row.image_status='MISS';row.image_error=e.message;}}model.quality.missing_images=model.products.filter(r=>r.image_status!=='OK').length;model.sheetNames.push('05_细分商品明细');}
    const built=buildCatalogScopedWorkbook(artifact,model);
    await fs.mkdir(outputDir,{recursive:true});const filename=`catalog-${safe(model.metadata.category_key)}-${model.metadata.export_type.toLowerCase()}-${safe(model.metadata.pool_version_id??model.metadata.campaign_id)}-${Date.now()}-${crypto.randomUUID().slice(0,8)}.xlsx`;
    const target=path.join(outputDir,filename),temporary=path.join(outputDir,`.${filename}.tmp-${crypto.randomUUID()}`);
    try{const output=await artifact.SpreadsheetFile.exportXlsx(built.workbook);await output.save(temporary);await fs.rename(temporary,target);}
    catch(error){await fs.rm(temporary,{force:true});throw error;}
    finally{await fs.rm(`${temporary}.inspect.ndjson`,{force:true});}
    await fs.writeFile(target+'.images.json',JSON.stringify(model.products.map(r=>({goods_id:r.goods_id,image_url:r.image_url}))));
    return{saved_path:target,file_name:filename,product_count:model.products.length,scope:model.metadata,sheet_names:model.sheetNames};}
  return Object.freeze({exportPreview:input=>save(repository.readPreview(input)),exportFormalPool:input=>save(repository.readFormalPool(input))});
}

export function buildCatalogScopedWorkbookModel({scope,products}){const rows=products.map(row=>{const title=String(row.title??'').replace(/^item picture\s+/i,'').replace(/\s*Open in new tab\.?$/i,'').replace(/^Top pick(?:\s+|(?=[A-Z0-9]))/,'').trim();const raw=row.raw?.raw_card_text||'';return {...row,title:title||null,currency:row.currency??(/[€]|\bEUR\b/.test(raw)&&Number.isFinite(row.price_amount)?'EUR':null),image_url:/^https?:\/\//i.test(row.image_url||'')&&!/\/(?:ad_tag|badge|icon)(?:\/|[_.-])/i.test(row.image_url||'')?row.image_url:null};}).sort((a,b)=>String(a.platform).localeCompare(String(b.platform))||String(a.goods_id).localeCompare(String(b.goods_id)));
  return{sheetNames:[...SCOPED_SHEETS],metadata:{...scope},products:rows.map(row=>({...row,image_status:row.image_status==='OK'?'OK':'MISS'}),),
    quality:{product_count:rows.length,missing_images:rows.filter(row=>row.image_status!=='OK').length},
    classification:{status:'BLOCKED_UNCONFIGURED',message:'Raw Pool export；未配置 taxonomy 时禁止借用 Motorcycle 分类。'}};}

export function buildCatalogScopedWorkbook({Workbook},model){const workbook=Workbook.create();const sheets=Object.fromEntries(SCOPED_SHEETS.map(name=>[name,workbook.worksheets.add(name)]));
  const headers=['序号','platform','goods_id','title','price','currency','sales','rating','review_count','rank','source_url','canonical_url','image_url','image_status','category_key','category_profile_version','pool_version_id','campaign_id','capture_time'];
  const rows=model.products.map((row,index)=>[index+1,row.platform,`'${row.goods_id}`,row.title??null,row.price_amount??null,row.currency??null,row.sales_count??null,row.rating??null,row.review_count??null,row.listing_rank??null,row.source_url??null,row.canonical_url??null,row.image_url??null,row.image_status,model.metadata.category_key,model.metadata.category_profile_version,model.metadata.pool_version_id,model.metadata.campaign_id,row.capture_time==null?null:String(row.capture_time)]);
  write(sheets['01_商品明细'],[headers,...rows]);write(sheets['02_数据质量'],[['指标','值'],['商品数',model.quality.product_count],['缺失图片',model.quality.missing_images],['币种缺失',model.products.filter(r=>!r.currency).length],['有效图片链接缺失',model.products.filter(r=>!r.image_url).length],['标题缺失',model.products.filter(r=>!r.title).length]]);
  write(sheets['03_采集任务'],Object.entries(model.metadata).map(([key,value])=>[key,value]));
  write(sheets['04_类目配置'],[['category_key',model.metadata.category_key],['category_profile_version',model.metadata.category_profile_version],['export_type',model.metadata.export_type],['activation_status',model.metadata.activation_status]]);
  write(sheets['05_待分类说明'],[['status','说明'],[model.classification.status,model.classification.message]]);
  if(model.metadata.export_type==='FORMAL_POOL'){
    const sheet=workbook.worksheets.add('05_细分商品明细');
    const cols=['序号','Temu主图','1688匹配主图','goods_id','商品标题','当前价格 EUR','销量','评分','评论数','评论密度','当前排名','source_url','canonical_url','图片状态','当前 Pool Version','用户场景','产品类型','Level3具体细分','人工确认','寻源备注','1688匹配状态','1688标题','1688价格RMB','MOQ','1688店铺','1688链接','相似产品簇'];
    write(sheet,[cols,...model.products.map((r,i)=>[i+1,r.image_data?'':'图片缺失','',String(r.goods_id),r.title,r.price_amount,r.sales_count,r.rating,r.review_count,r.sales_count>0&&r.review_count!=null?r.review_count/r.sales_count:null,r.listing_rank,r.source_url,r.canonical_url,r.image_status,model.metadata.pool_version_id,'','','','','','','','','','','',''])]);
    for(let i=0;i<model.products.length;i++){const r=model.products[i];if(r.image_data)sheet.images.add({dataUrl:r.image_data,anchor:{from:{row:i+1,col:1,rowOffsetPx:4,colOffsetPx:4},extent:{widthPx:86,heightPx:64}}});}
    sheet.getRange('A1:Z1').format.fill='#17365D';sheet.getRange('A1:Z1').format.font.color='#FFFFFF';
    sheet.getRange('B:B').format.columnWidth=100;sheet.getRange('E:E').format.columnWidth=320;
    sheet.getRange('A2:Z'+(model.products.length+1)).format.rowHeight=76;
  }
  return{workbook,sheetNames:model.sheetNames};}
function write(sheet,values){const width=Math.max(...values.map(row=>row.length)),last=column(width);sheet.getRange(`A1:${last}${values.length}`).values=values;sheet.freezePanes.freezeRows(1);}
function column(number){let result='';for(let value=number;value>0;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;}
function safe(value){return String(value).replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,120);}

async function loadMainImage(value){
 const url=new URL(value);if(url.protocol!=='https:'||!(url.hostname==='img.kwcdn.com'||url.hostname.endsWith('.kwcdn.com')))throw Error('图片链接不可用');
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('图片请求失败 '+response.status);
 const chunks=[];let size=0;for await(const part of response.body){size+=part.length;if(size>5*1024*1024)throw Error('图片超过5MB');chunks.push(part);}
 const bytes=await sharp(Buffer.concat(chunks),{limitInputPixels:40000000}).rotate().flatten({background:'#fff'}).jpeg({quality:85}).toBuffer();return 'data:image/jpeg;base64,'+bytes.toString('base64');
}
