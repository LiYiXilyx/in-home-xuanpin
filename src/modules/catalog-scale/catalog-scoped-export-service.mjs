import crypto from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';
import {loadArtifactTool} from '../analysis/artifact-runtime.mjs';

export const SCOPED_SHEETS=Object.freeze(['01_商品明细','02_数据质量','03_采集任务','04_类目配置','05_待分类说明']);

export function createCatalogScopedExportService({repository,outputDir,artifactLoader=loadArtifactTool}={}){
  async function save(result){const model=buildCatalogScopedWorkbookModel(result),artifact=await artifactLoader(),built=buildCatalogScopedWorkbook(artifact,model);
    await fs.mkdir(outputDir,{recursive:true});const filename=`catalog-${safe(model.metadata.category_key)}-${model.metadata.export_type.toLowerCase()}-${safe(model.metadata.pool_version_id??model.metadata.campaign_id)}.xlsx`;
    const target=path.join(outputDir,filename),temporary=path.join(outputDir,`.${filename}.tmp-${crypto.randomUUID()}`);
    try{const output=await artifact.SpreadsheetFile.exportXlsx(built.workbook);await output.save(temporary);await fs.rename(temporary,target);}
    catch(error){await fs.rm(temporary,{force:true});throw error;}
    finally{await fs.rm(`${temporary}.inspect.ndjson`,{force:true});}
    return{saved_path:target,file_name:filename,product_count:model.products.length,scope:model.metadata,sheet_names:model.sheetNames};}
  return Object.freeze({exportPreview:input=>save(repository.readPreview(input)),exportFormalPool:input=>save(repository.readFormalPool(input))});
}

export function buildCatalogScopedWorkbookModel({scope,products}){const rows=[...products].sort((a,b)=>String(a.platform).localeCompare(String(b.platform))||String(a.goods_id).localeCompare(String(b.goods_id)));
  return{sheetNames:[...SCOPED_SHEETS],metadata:{...scope},products:rows.map(row=>({...row,image_status:row.image_status==='OK'?'OK':'MISS'}),),
    quality:{product_count:rows.length,missing_images:rows.filter(row=>row.image_status!=='OK').length},
    classification:{status:'BLOCKED_UNCONFIGURED',message:'Raw Pool export；未配置 taxonomy 时禁止借用 Motorcycle 分类。'}};}

export function buildCatalogScopedWorkbook({Workbook},model){const workbook=Workbook.create();const sheets=Object.fromEntries(SCOPED_SHEETS.map(name=>[name,workbook.worksheets.add(name)]));
  const headers=['序号','platform','goods_id','title','price','currency','sales','rating','review_count','rank','source_url','canonical_url','image_url','image_status','category_key','category_profile_version','pool_version_id','campaign_id','capture_time'];
  const rows=model.products.map((row,index)=>[index+1,row.platform,`'${row.goods_id}`,row.title??null,row.price_amount??null,row.currency??null,row.sales_count??null,row.rating??null,row.review_count??null,row.listing_rank??null,row.source_url??null,row.canonical_url??null,row.image_url??null,row.image_status,model.metadata.category_key,model.metadata.category_profile_version,model.metadata.pool_version_id,model.metadata.campaign_id,row.capture_time??null]);
  write(sheets['01_商品明细'],[headers,...rows]);write(sheets['02_数据质量'],[['指标','值'],['商品数',model.quality.product_count],['缺失图片',model.quality.missing_images]]);
  write(sheets['03_采集任务'],Object.entries(model.metadata).map(([key,value])=>[key,value]));
  write(sheets['04_类目配置'],[['category_key',model.metadata.category_key],['category_profile_version',model.metadata.category_profile_version],['export_type',model.metadata.export_type],['activation_status',model.metadata.activation_status]]);
  write(sheets['05_待分类说明'],[['status','说明'],[model.classification.status,model.classification.message]]);
  return{workbook,sheetNames:[...SCOPED_SHEETS]};}
function write(sheet,values){const width=Math.max(...values.map(row=>row.length)),last=column(width);sheet.getRange(`A1:${last}${values.length}`).values=values;sheet.freezePanes.freezeRows(1);}
function column(number){let result='';for(let value=number;value>0;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;}
function safe(value){return String(value).replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,120);}
