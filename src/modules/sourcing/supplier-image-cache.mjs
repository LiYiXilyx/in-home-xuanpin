import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS=15_000;
const DEFAULT_MAX_REDIRECTS=5;
const DEFAULT_MAX_RESPONSE_BYTES=20*1024*1024;
const METADATA_HOSTS=new Set(['metadata.google.internal']);
let sharpInstance=null;

export async function assertSafeSupplierImageUrl(value,{ resolveHost=defaultResolveHost }={}) {
  let url;
  try { url=value instanceof URL?new URL(value.href):new URL(value); }
  catch { throw imageError('IMAGE_URL_BLOCKED','invalid image URL'); }
  if(url.protocol!=='http:' && url.protocol!=='https:') throw imageError('IMAGE_URL_BLOCKED',`scheme is not allowed: ${url.protocol}`);
  const hostname=normalizeHostname(url.hostname);
  if(hostname==='' || hostname==='localhost' || hostname.endsWith('.localhost') || METADATA_HOSTS.has(hostname)) {
    throw imageError('IMAGE_URL_BLOCKED',`hostname is not allowed: ${hostname}`);
  }
  if(net.isIP(hostname)) {
    if(isForbiddenAddress(hostname)) throw imageError('IMAGE_URL_BLOCKED',`address is not public: ${hostname}`);
    return url;
  }
  let resolved;
  try { resolved=await resolveHost(hostname); }
  catch(error) { throw imageError('IMAGE_URL_BLOCKED',`DNS resolution failed: ${error.message}`); }
  const addresses=normalizeResolvedAddresses(resolved);
  if(addresses.length===0 || addresses.some(isForbiddenAddress)) {
    throw imageError('IMAGE_URL_BLOCKED',`hostname resolved to a forbidden address: ${hostname}`);
  }
  return url;
}

export async function cacheSupplierImage(candidate,{
  cacheRoot,
  fetchImpl=globalThis.fetch,
  resolveHost=defaultResolveHost,
  now=()=>new Date(),
  timeoutMs=DEFAULT_TIMEOUT_MS,
  maxRedirects=DEFAULT_MAX_REDIRECTS,
  maxResponseBytes=DEFAULT_MAX_RESPONSE_BYTES,
  existingRecord=null,
}={}) {
  const identity=imageIdentity(candidate);
  let finalPath=null;
  let temporaryPath=null;
  try {
    if(!identity.temu_goods_id || !identity['1688_product_id'] || !identity['1688_image_url']) {
      throw imageError('IMAGE_MAPPING_INVALID','candidate image identity is incomplete');
    }
    if(!cacheRoot) throw imageError('IMAGE_CACHE_CONFIG','cacheRoot is required');
    const relativePath=expectedRelativePath(identity.temu_goods_id,identity['1688_product_id']);
    finalPath=path.join(cacheRoot,...relativePath.split('/'));
    const reused=await reusableCache({ candidate:identity,existingRecord,relativePath,finalPath });
    if(reused) return {
      ...identity,
      '1688_image_local_path':relativePath,
      image_download_status:'SUCCESS',
      image_downloaded_at:recordField(existingRecord,'image_downloaded_at'),
      image_sha256:recordField(existingRecord,'image_sha256'),
      image_response_sha256:recordField(existingRecord,'image_response_sha256'),
      cache_reused:true,
    };

    await fs.mkdir(path.dirname(finalPath),{ recursive:true });
    await fs.rm(finalPath,{ force:true });
    const downloaded=await downloadImageBytes(identity['1688_image_url'],{
      fetchImpl,resolveHost,timeoutMs,maxRedirects,maxResponseBytes,
    });
    const sharp=loadSharp();
    let metadata;
    try { metadata=await sharp(downloaded.bytes,{ failOn:'error',animated:false }).metadata(); }
    catch(error) { throw imageError('IMAGE_DECODE_FAILED',error.message); }
    if(!metadata.format || !(metadata.width>0) || !(metadata.height>0)) throw imageError('IMAGE_DECODE_FAILED','image has no decodable dimensions');
    let pipeline=sharp(downloaded.bytes,{ failOn:'error',animated:false }).rotate();
    if(metadata.hasAlpha) pipeline=pipeline.flatten({ background:{ r:255,g:255,b:255 } });
    let finalBytes;
    try { finalBytes=await pipeline.jpeg({ quality:90 }).toBuffer(); }
    catch(error) { throw imageError('IMAGE_DECODE_FAILED',error.message); }
    if(sniffImageSignature(finalBytes)!=='jpeg') throw imageError('IMAGE_DECODE_FAILED','JPEG encoder did not produce JPEG bytes');
    try {
      const finalMetadata=await sharp(finalBytes,{ failOn:'error' }).metadata();
      if(finalMetadata.format!=='jpeg' || !(finalMetadata.width>0) || !(finalMetadata.height>0)) throw new Error('invalid JPEG metadata');
    } catch(error) { throw imageError('IMAGE_DECODE_FAILED',error.message); }

    temporaryPath=path.join(path.dirname(finalPath),`.${path.basename(finalPath)}.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temporaryPath,finalBytes,{ flag:'wx' });
    await fs.rename(temporaryPath,finalPath);
    temporaryPath=null;
    return {
      ...identity,
      '1688_image_local_path':relativePath,
      image_download_status:'SUCCESS',
      image_downloaded_at:isoTimestamp(now()),
      image_sha256:sha256(finalBytes),
      image_response_sha256:downloaded.responseSha256,
      cache_reused:false,
    };
  } catch(error) {
    if(temporaryPath) await fs.rm(temporaryPath,{ force:true }).catch(()=>{});
    if(finalPath) await fs.rm(finalPath,{ force:true }).catch(()=>{});
    return {
      ...identity,
      '1688_image_local_path':null,
      image_download_status:'FAILED',
      image_downloaded_at:null,
      image_sha256:null,
      image_response_sha256:null,
      cache_reused:false,
      error_code:error?.code??'IMAGE_DOWNLOAD_FAILED',
      error_message:error instanceof Error?error.message:String(error),
    };
  }
}

export async function cacheRandom5Images(candidates,options) {
  const results=[];
  for(const candidate of candidates) {
    results.push(await cacheSupplierImage(candidate,{ ...options,existingRecord:candidate }));
  }
  return {
    success:results.filter(result=>result.image_download_status==='SUCCESS').length,
    failed:results.filter(result=>result.image_download_status==='FAILED').length,
    results,
  };
}

async function reusableCache({ candidate,existingRecord,relativePath,finalPath }) {
  if(!existingRecord || recordField(existingRecord,'image_download_status')!=='SUCCESS') return false;
  if(String(recordField(existingRecord,'temu_goods_id')??'')!==candidate.temu_goods_id) return false;
  if(String(recordField(existingRecord,'1688_product_id','supplier_product_id')??'')!==candidate['1688_product_id']) return false;
  if(recordField(existingRecord,'1688_image_url','supplier_image_url')!==candidate['1688_image_url']) return false;
  if(recordField(existingRecord,'1688_image_local_path','supplier_image_local_path')!==relativePath) return false;
  const recordedSha=recordField(existingRecord,'image_sha256');
  if(!/^[a-f0-9]{64}$/.test(String(recordedSha??''))) return false;
  try {
    const bytes=await fs.readFile(finalPath);
    if(sniffImageSignature(bytes)!=='jpeg' || sha256(bytes)!==recordedSha) return false;
    const metadata=await loadSharp()(bytes,{ failOn:'error' }).metadata();
    return metadata.format==='jpeg' && metadata.width>0 && metadata.height>0;
  } catch { return false; }
}

async function downloadImageBytes(initialUrl,{ fetchImpl,resolveHost,timeoutMs,maxRedirects,maxResponseBytes }) {
  let current=await assertSafeSupplierImageUrl(initialUrl,{ resolveHost });
  for(let redirects=0;;) {
    let response;
    try {
      response=await fetchImpl(current,{ redirect:'manual',signal:AbortSignal.timeout(timeoutMs) });
    } catch(error) {
      if(error?.name==='AbortError' || error?.name==='TimeoutError' || error?.code==='ABORT_ERR') throw imageError('IMAGE_TIMEOUT','image request timed out');
      throw imageError('IMAGE_FETCH_FAILED',error.message);
    }
    if(response.status>=300 && response.status<400) {
      const location=response.headers?.get?.('location');
      if(!location) throw imageError('IMAGE_REDIRECT_INVALID','redirect has no Location header');
      if(redirects>=maxRedirects) throw imageError('IMAGE_REDIRECT_LIMIT','image redirect limit exceeded');
      current=await assertSafeSupplierImageUrl(new URL(location,current),{ resolveHost });
      redirects+=1;
      continue;
    }
    if(!(response.status>=200 && response.status<300)) throw imageError('IMAGE_HTTP_STATUS',`unexpected HTTP status: ${response.status}`);
    const contentType=String(response.headers?.get?.('content-type')??'').split(';',1)[0].trim().toLowerCase();
    if(!allowedContentTypes().has(contentType)) throw imageError('IMAGE_CONTENT_TYPE',`unsupported Content-Type: ${contentType||'missing'}`);
    const bytes=await readBoundedBody(response,maxResponseBytes);
    const signature=sniffImageSignature(bytes);
    if(!signature || !mimeMatchesSignature(contentType,signature)) throw imageError('IMAGE_SIGNATURE',`image signature does not match ${contentType}`);
    return { bytes,responseSha256:sha256(bytes) };
  }
}

async function readBoundedBody(response,maxBytes) {
  const declared=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(declared) && declared>maxBytes) throw imageError('IMAGE_TOO_LARGE',`response exceeds ${maxBytes} bytes`);
  if(!response.body?.getReader) {
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>maxBytes) throw imageError('IMAGE_TOO_LARGE',`response exceeds ${maxBytes} bytes`);
    return bytes;
  }
  const reader=response.body.getReader();
  const chunks=[];
  let total=0;
  try {
    for(;;) {
      const { done,value }=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>maxBytes) {
        await reader.cancel();
        throw imageError('IMAGE_TOO_LARGE',`response exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch(error) {
    if(error?.name==='AbortError' || error?.name==='TimeoutError' || error?.code==='ABORT_ERR') throw imageError('IMAGE_TIMEOUT','image response timed out');
    throw error;
  }
  return Buffer.concat(chunks,total);
}

function sniffImageSignature(bytes) {
  if(bytes.length>=3 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return 'jpeg';
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'png';
  if(bytes.length>=12 && bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WEBP') return 'webp';
  if(bytes.length>=6 && ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))) return 'gif';
  if(bytes.length>=12 && bytes.subarray(4,8).toString('ascii')==='ftyp') {
    const brand=bytes.subarray(8,12).toString('ascii');
    if(['avif','avis'].includes(brand)) return 'avif';
    if(['heic','heix','hevc','hevx','mif1','msf1'].includes(brand)) return 'heif';
  }
  return null;
}

function allowedContentTypes() {
  return new Set(['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']);
}

function mimeMatchesSignature(mime,signature) {
  if(signature==='jpeg') return mime==='image/jpeg' || mime==='image/jpg';
  if(signature==='heif') return mime==='image/heic' || mime==='image/heif';
  return mime===`image/${signature}`;
}

function imageIdentity(candidate) {
  const goodsId=String(candidate?.temu_goods_id??'').trim();
  const productId=String(candidate?.['1688_product_id']??candidate?.supplier_product_id??'').trim();
  const imageUrl=candidate?.['1688_image_url']??candidate?.supplier_image_url??null;
  return { temu_goods_id:goodsId,'1688_product_id':productId,'1688_image_url':imageUrl===null?null:String(imageUrl) };
}

function expectedRelativePath(goodsId,productId) {
  for(const segment of [goodsId,productId]) {
    if(segment==='.' || segment==='..' || segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
      throw imageError('IMAGE_MAPPING_INVALID','goods/product ID is not path-safe');
    }
  }
  return `${goodsId}/${productId}.jpg`;
}

function recordField(record,...names) {
  for(const name of names) if(record && record[name]!==undefined) return record[name];
  return null;
}

function loadSharp() {
  if(sharpInstance) return sharpInstance;
  const dependencyRoot=process.env.TEMU_ARTIFACT_NODE_MODULES;
  const require=dependencyRoot?createRequire(path.join(path.resolve(dependencyRoot),'package.json')):createRequire(import.meta.url);
  sharpInstance=require('sharp');
  return sharpInstance;
}

async function defaultResolveHost(hostname) {
  return (await dns.lookup(hostname,{ all:true,verbatim:true })).map(item=>item.address);
}

function normalizeResolvedAddresses(resolved) {
  const values=Array.isArray(resolved)?resolved:[resolved];
  return values.map(value=>typeof value==='string'?value:value?.address).filter(Boolean).map(normalizeHostname);
}

function normalizeHostname(value) {
  return String(value??'').trim().toLowerCase().replace(/^\[|\]$/g,'').replace(/%.*$/,'');
}

function isForbiddenAddress(value) {
  const address=normalizeMappedAddress(normalizeHostname(value));
  if(net.isIP(address)===4) {
    const parts=address.split('.').map(Number);
    const [a,b]=parts;
    return a===0 || a===10 || a===127 || (a===100 && b>=64 && b<=127) ||
      (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && b===168) ||
      (a===198 && (b===18 || b===19)) || a>=224 || address==='100.100.100.200';
  }
  if(net.isIP(address)===6) {
    if(address==='::' || address==='::1') return true;
    const first=firstIpv6Word(address);
    return (first&0xfe00)===0xfc00 || (first&0xffc0)===0xfe80;
  }
  return true;
}

function normalizeMappedAddress(address) {
  const marker='::ffff:';
  if(!address.startsWith(marker)) return address;
  const tail=address.slice(marker.length);
  if(net.isIP(tail)===4) return tail;
  const words=tail.split(':');
  if(words.length!==2 || words.some(word=>!/^[0-9a-f]{1,4}$/.test(word))) return address;
  const value=(Number.parseInt(words[0],16)*65536+Number.parseInt(words[1],16))>>>0;
  return [value>>>24,(value>>>16)&255,(value>>>8)&255,value&255].join('.');
}

function firstIpv6Word(address) {
  const word=address.split(':').find(Boolean)??'0';
  return Number.parseInt(word,16);
}

function isoTimestamp(value) {
  return value instanceof Date?value.toISOString():new Date(value).toISOString();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function imageError(code,message) {
  const error=new Error(`${code}: ${message}`);
  error.code=code;
  return error;
}
