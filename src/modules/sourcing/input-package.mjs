import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIRECT_FORMATS=new Set(['JPEG','PNG','WEBP']);
const DERIVATIVE_FORMATS=new Set(['AVIF','HEIF']);

export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
export const sha256File=file=>sha256(fs.readFileSync(file));

function normalizedFormat(source,metadata){
  const ext=path.extname(source).toLowerCase();
  if(ext==='.avif'&&metadata.format==='heif')return 'AVIF';
  if(['.heif','.heic'].includes(ext)&&metadata.format==='heif')return 'HEIF';
  if(['.jpg','.jpeg'].includes(ext)&&metadata.format==='jpeg')return 'JPEG';
  if(ext==='.png'&&metadata.format==='png')return 'PNG';
  if(ext==='.webp'&&metadata.format==='webp')return 'WEBP';
  throw new Error(`图片扩展名与有效内容不匹配：${source}`);
}

async function inspectSource(source){
  if(!fs.existsSync(source)||!fs.statSync(source).isFile()||fs.statSync(source).size<=0)throw new Error(`主图不存在或为空：${source}`);
  let metadata;try{metadata=await sharp(source,{failOn:'error'}).metadata();}catch(error){throw new Error(`原始图片无效：${source} (${error.message})`);}
  if(!(metadata.width>0)||!(metadata.height>0))throw new Error(`原始图片尺寸无效：${source}`);
  const format=normalizedFormat(source,metadata);if(!DIRECT_FORMATS.has(format)&&!DERIVATIVE_FORMATS.has(format))throw new Error(`不支持的图片格式：${source}`);
  return {source,format,metadata,sha256:sha256File(source)};
}

function safeGoodsId(value){const goodsId=String(value??'').trim();if(!goodsId||!/^[a-zA-Z0-9_-]+$/.test(goodsId))throw new Error(`goods_id 格式无效：${value}`);return goodsId;}

function validSignature(buffer,format){
  if(format==='JPEG')return buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff;
  if(format==='PNG')return buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(format==='WEBP')return buffer.length>=12&&buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP';
  return false;
}

async function validateSearchImage(file,expectedFormat,goodsId){
  const stat=fs.statSync(file);if(stat.size<=0)throw new Error(`搜图文件为空：${goodsId}`);
  const buffer=fs.readFileSync(file);if(!validSignature(buffer,expectedFormat))throw new Error(`搜图文件 MIME/signature 无效：${goodsId}`);
  let metadata;try{metadata=await sharp(buffer,{failOn:'error'}).metadata();}catch(error){throw new Error(`搜图文件不可解码：${goodsId} (${error.message})`);}
  const actual=metadata.format==='jpeg'?'JPEG':String(metadata.format??'').toUpperCase();
  if(actual!==expectedFormat||!(metadata.width>0)||!(metadata.height>0))throw new Error(`搜图文件格式或尺寸无效：${goodsId}`);
  return {width:metadata.width,height:metadata.height,size:stat.size};
}

async function writeSearchImage(sourceInfo,destination,goodsId){
  if(DERIVATIVE_FORMATS.has(sourceInfo.format)){
    let pipeline=sharp(sourceInfo.source,{failOn:'error'}).rotate();
    if(sourceInfo.metadata.hasAlpha)pipeline=pipeline.flatten({background:{r:255,g:255,b:255}});
    await pipeline.jpeg({quality:90}).toFile(destination);await validateSearchImage(destination,'JPEG',goodsId);
    return {format:'JPEG',conversion:`${sourceInfo.format}_TO_JPEG`};
  }
  fs.copyFileSync(sourceInfo.source,destination);await validateSearchImage(destination,sourceInfo.format,goodsId);return {format:sourceInfo.format,conversion:'NONE'};
}

export async function createInputPackage({runId,gitCommit,goods,inputDir,createdAt=new Date().toISOString()}){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(runId))throw new Error('run_id 格式无效。');
  if(!Array.isArray(goods)||goods.length<1)throw new Error('输入商品不能为空。');
  const identities=goods.map(item=>safeGoodsId(item.temu_goods_id));if(new Set(identities).size!==goods.length)throw new Error('输入包存在重复 temu_goods_id。');
  if(fs.existsSync(inputDir))throw new Error(`输入目录已存在，拒绝覆盖：${inputDir}`);
  const sources=[];for(const [index,item] of goods.entries()){
    if(!String(item.temu_title??'').trim())throw new Error(`商品缺少 title：${identities[index]}`);
    sources.push(await inspectSource(path.resolve(item.temu_image_path)));
  }
  const parent=path.dirname(inputDir);fs.mkdirSync(parent,{recursive:true});const staging=fs.mkdtempSync(path.join(parent,`.${path.basename(inputDir)}-staging-`));
  try{
    const imagesDir=path.join(staging,'images');fs.mkdirSync(imagesDir);const normalized=[];
    for(const [index,item] of goods.entries()){
      const goodsId=identities[index],source=sources[index],willConvert=DERIVATIVE_FORMATS.has(source.format),extension=willConvert?'.jpg':path.extname(source.source).toLowerCase();
      const imageName=`${goodsId}${extension}`,relative=path.posix.join('images',imageName),destination=path.join(imagesDir,imageName);
      const derived=await writeSearchImage(source,destination,goodsId),sourceAfter=sha256File(source.source);if(sourceAfter!==source.sha256)throw new Error(`原始图片在派生过程中发生变化：${goodsId}`);
      const searchSha=sha256File(destination);
      normalized.push({temu_goods_id:goodsId,temu_title:String(item.temu_title),source_image_path:source.source,source_image_format:source.format,source_image_sha256:source.sha256,
        search_image_path:relative,search_image_format:derived.format,search_image_sha256:searchSha,image_conversion:derived.conversion,
        temu_image_path:relative,temu_image_sha256:searchSha,level1:item.level1??null,level2:item.level2??null,level3:item.level3??null,similar_cluster:item.similar_cluster??null});
    }
    const jsonl=`${normalized.map(x=>JSON.stringify(x)).join('\n')}\n`;fs.writeFileSync(path.join(staging,'goods.jsonl'),jsonl,'utf8');
    const imageRecords=normalized.map(item=>Object.fromEntries(Object.entries(item).filter(([key])=>key.startsWith('source_image_')||key.startsWith('search_image_')||key==='temu_goods_id'||key==='image_conversion')));
    const manifest={run_id:runId,created_at:createdAt,git_commit:gitCommit,input_count:normalized.length,goods_jsonl_sha256:sha256(jsonl),images:imageRecords};
    fs.writeFileSync(path.join(staging,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8');fs.renameSync(staging,inputDir);return {manifest,goods:normalized,inputDir};
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
}

export async function validateInputPackage(inputDir,{expectedRunId,expectedTarget}={}){
  const manifestPath=path.join(inputDir,'manifest.json'),goodsPath=path.join(inputDir,'goods.jsonl');
  if(!fs.existsSync(manifestPath)||!fs.existsSync(goodsPath))throw new Error('输入包缺少 manifest.json 或 goods.jsonl。');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),raw=fs.readFileSync(goodsPath,'utf8');
  const goods=raw.split(/\r?\n/).filter(Boolean).map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`goods.jsonl 第 ${index+1} 行不是有效 JSON。`);}});
  if(expectedRunId&&manifest.run_id!==expectedRunId)throw new Error('manifest run_id 不匹配。');
  if(manifest.input_count!==goods.length||manifest.goods_jsonl_sha256!==sha256(raw))throw new Error('输入包数量或摘要不匹配。');
  if(expectedTarget&&goods.length!==expectedTarget)throw new Error(`输入数量 ${goods.length} 与 target ${expectedTarget} 不一致。`);
  if(new Set(goods.map(x=>String(x.temu_goods_id))).size!==goods.length)throw new Error('输入包 goods_id 不唯一。');
  for(const item of goods){
    if(!item.temu_goods_id||!item.temu_title||!item.source_image_path||!item.source_image_format||!item.source_image_sha256||!item.search_image_path||!item.search_image_format||!item.search_image_sha256||!item.image_conversion)throw new Error('输入商品缺少图片溯源字段。');
    if(path.isAbsolute(item.search_image_path)||item.search_image_path.includes('..'))throw new Error(`搜图路径必须是包内相对路径：${item.search_image_path}`);
    const image=path.resolve(inputDir,item.search_image_path);if(!image.startsWith(`${path.resolve(inputDir)}${path.sep}`)||!fs.existsSync(image))throw new Error(`包内搜图不存在：${item.search_image_path}`);
    if(sha256File(image)!==item.search_image_sha256||item.temu_image_sha256!==item.search_image_sha256)throw new Error(`搜图摘要不一致：${item.temu_goods_id}`);
    await validateSearchImage(image,item.search_image_format,item.temu_goods_id);
    const manifestImage=manifest.images?.find(entry=>String(entry.temu_goods_id)===String(item.temu_goods_id));if(!manifestImage||manifestImage.search_image_sha256!==item.search_image_sha256||manifestImage.source_image_sha256!==item.source_image_sha256)throw new Error(`manifest 图片映射不一致：${item.temu_goods_id}`);
  }
  return {manifest,goods,manifestSha256:sha256File(manifestPath)};
}
