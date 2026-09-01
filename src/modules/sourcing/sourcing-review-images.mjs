import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

let sharpInstance=null;

export function createSourcingReviewImageResolver({
  projectRoot=process.cwd(),
  temuPathBase=projectRoot,
  temuImageRoot=path.join(projectRoot,'outputs/week1-mvp/image-cache'),
  decode=decodeWithSharp,
}={}) {
  const projectPath=path.resolve(projectRoot);
  const temuBase=path.resolve(temuPathBase);
  const temuRoot=path.resolve(temuImageRoot);

  async function resolveSupplierImage({run,candidate}) {
    const goodsId=String(candidate?.temu_goods_id??'');
    const productId=String(candidate?.['1688_product_id']??candidate?.supplier_product_id??'');
    const imageUrl=candidate?.['1688_image_url']??candidate?.supplier_image_url??null;
    const status=String(candidate?.image_download_status??'');
    if(status==='SUCCESS') {
      const bytes=await validSupplierBytes({run,candidate,goodsId,productId});
      if(bytes) return {kind:'LOCAL',contentType:'image/jpeg',bytes,display_anomaly:false,image_failed:false};
      return imageUrl?{kind:'URL_FALLBACK',url:String(imageUrl),display_anomaly:true,image_failed:true}:
        {kind:'PLACEHOLDER',display_anomaly:true,image_failed:true};
    }
    return imageUrl?{kind:'URL_FALLBACK',url:String(imageUrl),display_anomaly:false,image_failed:true}:
      {kind:'PLACEHOLDER',display_anomaly:false,image_failed:true};
  }

  async function validSupplierBytes({run,candidate,goodsId,productId}) {
    if(!safeSegment(goodsId)||!safeSegment(productId)) return null;
    const relativePath=String(candidate?.['1688_image_local_path']??candidate?.supplier_image_local_path??'').replaceAll('\\','/');
    const expected=`${goodsId}/${productId}.jpg`;
    if(relativePath!==expected) return null;
    const cacheRootValue=run?.image_cache_dir??run?.imageCacheDir;
    if(!cacheRootValue) return null;
    const cacheRoot=path.isAbsolute(String(cacheRootValue))?path.resolve(String(cacheRootValue)):path.resolve(projectPath,String(cacheRootValue));
    const requested=path.resolve(cacheRoot,...expected.split('/'));
    if(!isContained(cacheRoot,requested)) return null;
    try {
      const [canonicalRoot,canonicalPath]=await Promise.all([fs.realpath(cacheRoot),fs.realpath(requested)]);
      if(!isContained(canonicalRoot,canonicalPath)) return null;
      const bytes=await fs.readFile(canonicalPath);
      if(!isJpeg(bytes)) return null;
      const recorded=String(candidate?.image_sha256??'');
      if(!/^[a-f0-9]{64}$/i.test(recorded)||sha256(bytes)!==recorded.toLowerCase()) return null;
      const metadata=await decode(bytes);
      if(metadata.format!=='jpeg'||!(metadata.width>0)||!(metadata.height>0)) return null;
      return bytes;
    } catch {
      return null;
    }
  }

  async function resolveTemuImage(context) {
    if(context?.temu_context_status!=='AVAILABLE') return {kind:'MISSING'};
    const goodsId=String(context?.temu_goods_id??'');
    const relativePath=String(context?.temu_image_local_path??'').replaceAll('\\','/');
    if(!safeSegment(goodsId)||path.parse(relativePath).name!==goodsId||path.isAbsolute(relativePath)) return {kind:'MISSING'};
    const requested=path.resolve(temuBase,relativePath);
    if(!isContained(temuRoot,requested)) return {kind:'MISSING'};
    try {
      const [canonicalRoot,canonicalPath]=await Promise.all([fs.realpath(temuRoot),fs.realpath(requested)]);
      if(!isContained(canonicalRoot,canonicalPath)) return {kind:'MISSING'};
      if(context.temu_image_canonical_path&&await fs.realpath(context.temu_image_canonical_path)!==canonicalPath) return {kind:'MISSING'};
      const bytes=await fs.readFile(canonicalPath);
      const metadata=await decode(bytes);
      if(!(metadata.width>0)||!(metadata.height>0)) return {kind:'MISSING'};
      return {kind:'LOCAL',contentType:contentTypeFor(metadata.format),bytes};
    } catch {
      return {kind:'MISSING'};
    }
  }

  return {resolveSupplierImage,resolveTemuImage};
}

async function decodeWithSharp(bytes) {
  return loadSharp()(bytes,{failOn:'error',animated:false}).metadata();
}

function loadSharp() {
  if(sharpInstance) return sharpInstance;
  const dependencyRoot=process.env.TEMU_ARTIFACT_NODE_MODULES;
  const require=dependencyRoot?createRequire(path.join(path.resolve(dependencyRoot),'package.json')):createRequire(import.meta.url);
  sharpInstance=require('sharp');
  return sharpInstance;
}

function contentTypeFor(format) {
  const value=String(format??'').toLowerCase();
  if(value==='jpg'||value==='jpeg') return 'image/jpeg';
  if(value==='svg') return 'image/svg+xml';
  return value?`image/${value}`:'application/octet-stream';
}

function isJpeg(bytes) {
  return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeSegment(value) {
  return value!==''&&value!=='.'&&value!=='..'&&!value.includes('/')&&!value.includes('\\')&&!value.includes('\0');
}

function isContained(root,target) {
  const relative=path.relative(root,target);
  return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));
}
