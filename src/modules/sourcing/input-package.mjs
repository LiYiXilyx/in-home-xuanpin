import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
export const sha256File=file=>sha256(fs.readFileSync(file));

function safeImageName(goodsId,source,index){
  const ext=path.extname(source).toLowerCase();if(!['.jpg','.jpeg','.png','.webp'].includes(ext))throw new Error(`不支持的图片格式：${source}`);
  return `${String(goodsId).replace(/[^a-zA-Z0-9_-]/g,'_')}-${index+1}${ext}`;
}

export function createInputPackage({runId,gitCommit,goods,inputDir,createdAt=new Date().toISOString()}){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/.test(runId))throw new Error('run_id 格式无效。');
  if(!Array.isArray(goods)||goods.length<1)throw new Error('输入商品不能为空。');
  if(new Set(goods.map(x=>String(x.temu_goods_id))).size!==goods.length)throw new Error('输入包存在重复 temu_goods_id。');
  if(fs.existsSync(inputDir))throw new Error(`输入目录已存在，拒绝覆盖：${inputDir}`);
  const sources=goods.map(item=>{const source=path.resolve(item.temu_image_path);if(!String(item.temu_goods_id).trim()||!String(item.temu_title).trim())throw new Error('商品必须包含 goods_id 和 title。');if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw new Error(`主图不存在：${source}`);safeImageName(item.temu_goods_id,source,0);return source;});
  const imagesDir=path.join(inputDir,'images');fs.mkdirSync(imagesDir,{recursive:true});
  const normalized=goods.map((item,index)=>{
    const source=sources[index];
    const imageName=safeImageName(item.temu_goods_id,source,index),relative=path.posix.join('images',imageName),destination=path.join(imagesDir,imageName);
    fs.copyFileSync(source,destination);
    return {temu_goods_id:String(item.temu_goods_id),temu_title:String(item.temu_title),temu_image_path:relative,temu_image_sha256:sha256File(destination),level1:item.level1??null,level2:item.level2??null,level3:item.level3??null,similar_cluster:item.similar_cluster??null};
  });
  const jsonl=`${normalized.map(x=>JSON.stringify(x)).join('\n')}\n`;fs.writeFileSync(path.join(inputDir,'goods.jsonl'),jsonl,'utf8');
  const manifest={run_id:runId,created_at:createdAt,git_commit:gitCommit,input_count:normalized.length,goods_jsonl_sha256:sha256(jsonl)};
  fs.writeFileSync(path.join(inputDir,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8');return {manifest,goods:normalized,inputDir};
}

export function validateInputPackage(inputDir,{expectedRunId,expectedTarget}={}){
  const manifestPath=path.join(inputDir,'manifest.json'),goodsPath=path.join(inputDir,'goods.jsonl');
  if(!fs.existsSync(manifestPath)||!fs.existsSync(goodsPath))throw new Error('输入包缺少 manifest.json 或 goods.jsonl。');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),raw=fs.readFileSync(goodsPath,'utf8');
  const goods=raw.split(/\r?\n/).filter(Boolean).map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`goods.jsonl 第 ${index+1} 行不是有效 JSON。`);}});
  if(expectedRunId&&manifest.run_id!==expectedRunId)throw new Error('manifest run_id 不匹配。');
  if(manifest.input_count!==goods.length||manifest.goods_jsonl_sha256!==sha256(raw))throw new Error('输入包数量或摘要不匹配。');
  if(expectedTarget&&goods.length!==expectedTarget)throw new Error(`输入数量 ${goods.length} 与 target ${expectedTarget} 不一致。`);
  if(new Set(goods.map(x=>String(x.temu_goods_id))).size!==goods.length)throw new Error('输入包 goods_id 不唯一。');
  for(const item of goods){
    if(!item.temu_goods_id||!item.temu_title||!item.temu_image_path)throw new Error('输入商品缺少必填字段。');
    if(path.isAbsolute(item.temu_image_path)||item.temu_image_path.includes('..'))throw new Error(`图片路径必须是包内相对路径：${item.temu_image_path}`);
    const image=path.resolve(inputDir,item.temu_image_path);if(!image.startsWith(`${path.resolve(inputDir)}${path.sep}`)||!fs.existsSync(image))throw new Error(`包内图片不存在：${item.temu_image_path}`);
    if(item.temu_image_sha256&&sha256File(image)!==item.temu_image_sha256)throw new Error(`图片摘要不一致：${item.temu_goods_id}`);
  }
  return {manifest,goods,manifestSha256:sha256File(manifestPath)};
}
