import crypto from 'node:crypto';
import fs from 'node:fs/promises';import path from 'node:path';
import {sampleStableRandom5} from './stable-random5.mjs';

export const QA_METRIC_NAMES=Object.freeze(['source_export_files','parsed_files','failed_files','unique_temu_goods_id','total_source_candidates','goods_sampled','samples_total','goods_with_5','goods_with_less_than_5','duplicate_1688_product_id_within_goods','duplicate_temu_1688_pair','image_url_retained','image_download_success','image_download_failed','invalid_downloaded_image','image_mapping_error','random_sampling_reproducible']);

export function buildImportQa(input={}) {
  const candidates=input.candidates??[];const grouped=new Map();const pairs=new Map();let duplicateWithin=0;
  for(const row of candidates) {
    const goods=String(row.temu_goods_id),product=String(row.supplier_product_id??row['1688_product_id']??'');
    const products=grouped.get(goods)??[];if(products.includes(product))duplicateWithin+=1;products.push(product);grouped.set(goods,products);
    const pair=`${goods}\0${product}`;pairs.set(pair,(pairs.get(pair)??0)+1);
  }
  const duplicatePairs=[...pairs.values()].reduce((n,count)=>n+Math.max(0,count-1),0);
  const reproducible=input.reproducible===true||input.randomSamplingReproducible==='PASS';
  const report={
    source_export_files:Number(input.sourceExportFiles??0),parsed_files:Number(input.parsedFiles??0),failed_files:Array.isArray(input.failedFiles)?input.failedFiles.length:Number(input.failedFiles??0),
    unique_temu_goods_id:Number(input.uniqueTemuGoodsId??new Set(candidates.map(x=>String(x.temu_goods_id))).size),total_source_candidates:Number(input.totalSourceCandidates??0),
    goods_sampled:grouped.size,samples_total:candidates.length,goods_with_5:[...grouped.values()].filter(x=>x.length===5).length,goods_with_less_than_5:[...grouped.values()].filter(x=>x.length<5).length,
    duplicate_1688_product_id_within_goods:duplicateWithin,duplicate_temu_1688_pair:duplicatePairs,
    image_url_retained:candidates.filter(x=>Boolean(x.supplier_image_url??x['1688_image_url'])).length,
    image_download_success:candidates.filter(x=>x.image_download_status==='SUCCESS').length,image_download_failed:candidates.filter(x=>x.image_download_status==='FAILED').length,
    invalid_downloaded_image:Number(input.invalidDownloadedImage??0),image_mapping_error:Number(input.imageMappingError??0),random_sampling_reproducible:reproducible?'PASS':'FAIL',
  };
  report.manual_field_error=Number(input.manualFieldError??0);
  report.source_manifest_matches=input.manifestMatches!==false?'PASS':'FAIL';
  report.pass=report.duplicate_1688_product_id_within_goods===0&&report.duplicate_temu_1688_pair===0&&report.invalid_downloaded_image===0&&report.image_mapping_error===0&&report.manual_field_error===0&&report.random_sampling_reproducible==='PASS'&&report.source_manifest_matches==='PASS';
  report.final_status=report.pass?'PASS — YingDao Random5 + Image Cache V1 validated':'BLOCKED — YingDao export import validation failed';
  return report;
}

export function selectManualAuditGoods(goodsIds,limit=10) {
  return [...new Set((goodsIds??[]).map(String))].map(goodsId=>({goodsId,digest:crypto.createHash('sha256').update(`MANUAL_QA_V1\0${goodsId}`,'utf8').digest()}))
    .sort((a,b)=>Buffer.compare(a.digest,b.digest)||Buffer.compare(Buffer.from(a.goodsId),Buffer.from(b.goodsId))).slice(0,limit).map(x=>x.goodsId);
}

export function classifyImageRecheck({recordedResponseSha,recheckedResponseSha,mappingValid,recheckSucceeded=true}={}) {
  if(mappingValid===false)return 'MAPPING_ERROR';
  if(!recheckSucceeded)return 'RECHECK_INCONCLUSIVE';
  if(!recordedResponseSha||!recheckedResponseSha)return 'RECHECK_INCONCLUSIVE';
  if(recordedResponseSha&&recheckedResponseSha&&recordedResponseSha!==recheckedResponseSha)return 'SOURCE_CHANGED/RECHECK_INCONCLUSIVE';
  return mappingValid?'MATCH':'MAPPING_ERROR';
}

export function buildManualAuditModel({goodsIds,candidates,rechecks=[]}={}) {
  const selected=selectManualAuditGoods(goodsIds);const recheckByPair=new Map(rechecks.map(x=>[`${x.temu_goods_id}\0${x.product_id}`,x]));
  return {method:'MANUAL_QA_V1',selected_goods_ids:selected,items:selected.map(goodsId=>({temu_goods_id:goodsId,candidates:(candidates??[]).filter(x=>String(x.temu_goods_id)===goodsId).map(row=>{const productId=String(row.supplier_product_id??row['1688_product_id']);const check=recheckByPair.get(`${goodsId}\0${productId}`)??{};return {product_id:productId,original_rank:row.original_rank,random_sample_rank:row.candidate_rank??row.random_sample_rank,image_recheck:classifyImageRecheck(check)};})}))};
}
export function verifyRandom5Reproducible(sourceCandidates,storedCandidates){const byGoods=new Map();for(const row of sourceCandidates??[]){const id=String(row.temu_goods_id),list=byGoods.get(id)??[];list.push(row);byGoods.set(id,list);}const expected=[];for(const [id,rows] of byGoods){const a=sampleStableRandom5(id,rows),b=sampleStableRandom5(id,[...rows].reverse());if(JSON.stringify(identity(a))!==JSON.stringify(identity(b)))return false;expected.push(...a);}return JSON.stringify(identity(expected))===JSON.stringify(identity((storedCandidates??[]).map(x=>({temu_goods_id:x.temu_goods_id,'1688_product_id':x.supplier_product_id,original_rank:x.original_rank,random_sample_rank:x.candidate_rank})))) ;}
function identity(rows){return rows.map(x=>[String(x.temu_goods_id),String(x['1688_product_id']),Number(x.original_rank),Number(x.random_sample_rank)]).sort((a,b)=>Buffer.compare(Buffer.from(`${a[0]}\0${a[3]}`),Buffer.from(`${b[0]}\0${b[3]}`)));}
export async function validateCachedCandidates(candidates,cacheRoot,{decode=null}={}){let invalidDownloadedImage=0,imageMappingError=0;for(const row of candidates??[]){const goods=String(row.temu_goods_id),product=String(row.supplier_product_id??row['1688_product_id']),expected=`${goods}/${product}.jpg`,local=row.supplier_image_local_path??row['1688_image_local_path'];if(row.image_download_status==='SUCCESS'){if(local!==expected){imageMappingError+=1;continue;}try{const root=path.resolve(cacheRoot),file=path.resolve(root,...expected.split('/'));if(!file.startsWith(`${root}${path.sep}`))throw new Error('escape');const bytes=await fs.readFile(file);if(bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)throw new Error('signature');if(crypto.createHash('sha256').update(bytes).digest('hex')!==row.image_sha256)throw new Error('sha');const meta=decode?await decode(bytes):(await (await import('sharp')).default(bytes).metadata());if(meta.format!=='jpeg'||!(meta.width>0)||!(meta.height>0))throw new Error('decode');}catch{invalidDownloadedImage+=1;}}else if(local)imageMappingError+=1;}return{invalidDownloadedImage,imageMappingError};}
