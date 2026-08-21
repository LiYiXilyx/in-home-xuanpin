import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SIGNATURES = [
  { mime: 'image/png', extension: '.png', test: bytes => bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  { mime: 'image/jpeg', extension: '.jpg', test: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: 'image/webp', extension: '.webp', test: bytes => bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' },
  { mime: 'image/avif', extension: '.avif', test: bytes => bytes.subarray(4,12).toString().includes('ftyp') && bytes.subarray(8,32).toString().includes('avif') }
];
const EXTENSIONS = SIGNATURES.map(item => item.extension);

export function createBrowserImageFetcher(page) {
  return async (url,{ timeoutMs = 30_000 } = {}) => page.evaluate(async ({ url,timeoutMs }) => {
    const response = await fetch(url,{
      method: 'GET',credentials: 'omit',cache: 'force-cache',
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
    return {
      ok: response.ok,status: response.status,
      contentType: response.headers.get('content-type') || blob.type || null,
      bodyBase64: dataUrl.slice(dataUrl.indexOf(',') + 1)
    };
  },{ url,timeoutMs });
}

export async function cacheProductImage(product,options) {
  const { cacheDir,minimumBytes = 1024 } = options;
  if (!product.image_url) return failure(product,'IMAGE_URL_MISSING','商品主图 URL 缺失。',[]);
  const attempts = [];
  const cached = await findValidExisting(product,options,attempts);
  if (cached) return completed(product,cached.bytes,cached.signature,cached.absolutePath,options,'cache',attempts);

  const strategyOrder = options.strategyOrder ?? ['browser','node'];
  for (const strategy of strategyOrder) {
    const fetcher = strategy === 'browser' ? options.browserFetch : (options.fetchImpl ?? fetch);
    if (typeof fetcher !== 'function') continue;
    const maxAttempts = Math.max(1,Number(options.attemptsPerStrategy ?? 2));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = strategy === 'browser'
          ? await fetcher(product.image_url,{ timeoutMs: options.timeoutMs ?? 30_000 })
          : await fetcher(product.image_url,{
            redirect: 'follow',headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*',referer: 'https://www.temu.com/' },
            signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
          });
        const payload = await readResponse(response);
        if (!payload.ok) throw imageError('IMAGE_HTTP_ERROR',`HTTP ${payload.status}`);
        const validation = validateImagePayload(payload.bytes,payload.contentType,minimumBytes,{ requireContentType:true });
        await fs.mkdir(cacheDir,{ recursive: true });
        const targetPath = path.resolve(cacheDir,`${safeName(product.goods_id)}${validation.signature.extension}`);
        const temporaryPath = `${targetPath}.${process.pid}.tmp`;
        await fs.writeFile(temporaryPath,payload.bytes);
        await fs.rename(temporaryPath,targetPath);
        attempts.push({ strategy,attempt,result: 'completed' });
        return completed(product,payload.bytes,validation.signature,targetPath,options,strategy,attempts);
      } catch (error) {
        attempts.push({ strategy,attempt,result: 'failed',error_code: error.code ?? `${strategy.toUpperCase()}_FETCH_FAILED` });
      }
    }
  }
  const last = attempts.at(-1);
  return failure(product,last?.error_code ?? 'IMAGE_FETCH_FAILED','所有图片获取策略均失败。',attempts);
}

export async function cacheProductImages(products,options) {
  const concurrency = Math.max(1,Math.min(Number(options.concurrency ?? 3),6));
  const results = new Array(products.length);
  let next = 0;
  async function worker() {
    while (next < products.length) {
      const index = next++;
      results[index] = await cacheProductImage(products[index],options);
      options.onResult?.(results[index],index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency,products.length) },() => worker()));
  return {
    results,downloaded: results.filter(item => item.download_status === 'completed').length,
    failed: results.filter(item => item.download_status === 'failed').length,
    reused: results.filter(item => item.fetch_strategy === 'cache').length,
    browser: results.filter(item => item.fetch_strategy === 'browser').length,
    node: results.filter(item => item.fetch_strategy === 'node').length,
    errors: results.filter(item => item.download_status === 'failed')
  };
}

export async function validateLocalImage(filePath,{ minimumBytes = 1024 } = {}) {
  try {
    const bytes = await fs.readFile(filePath);
    const validation = validateImagePayload(bytes,null,minimumBytes);
    return { valid: true,bytes,signature: validation.signature,sha256: sha256(bytes),byteLength: bytes.length };
  } catch (error) {
    return { valid: false,errorCode: error.code ?? 'LOCAL_IMAGE_INVALID' };
  }
}

export function validateImagePayload(bytesValue,contentType,minimumBytes = 1024,{ requireContentType = false } = {}) {
  const bytes = Buffer.from(bytesValue);
  const declaredMime = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (requireContentType && !declaredMime) throw imageError('IMAGE_MIME_INVALID','Content-Type missing');
  if (declaredMime && !declaredMime.startsWith('image/')) throw imageError('IMAGE_MIME_INVALID',`Content-Type ${declaredMime}`);
  if (bytes.length < minimumBytes) throw imageError('IMAGE_TOO_SMALL',`${bytes.length} bytes < ${minimumBytes}`);
  const prefix = bytes.subarray(0,256).toString('utf8').trimStart().toLowerCase();
  if (prefix.startsWith('<!doctype html') || prefix.startsWith('<html')) throw imageError('IMAGE_HTML_BODY','响应正文是 HTML。');
  const signature = SIGNATURES.find(item => item.test(bytes));
  if (!signature) throw imageError('IMAGE_SIGNATURE_INVALID','文件头不是 AVIF/WebP/JPEG/PNG。');
  if (declaredMime && !mimeCompatible(declaredMime,signature.mime)) {
    throw imageError('IMAGE_MIME_MISMATCH',`声明 ${declaredMime}，文件头 ${signature.mime}`);
  }
  return { bytes,signature };
}

async function findValidExisting(product,options,attempts) {
  const candidates = [];
  if (product.existing_local_path) candidates.push(resolveLocalPath(product.existing_local_path,options));
  for (const extension of EXTENSIONS) candidates.push(path.resolve(options.cacheDir,`${safeName(product.goods_id)}${extension}`));
  for (const candidate of [...new Set(candidates)]) {
    const checked = await validateLocalImage(candidate,{ minimumBytes: options.minimumBytes ?? 1024 });
    if (checked.valid) {
      attempts.push({ strategy: 'cache',attempt: 1,result: 'completed' });
      return { ...checked,absolutePath: candidate };
    }
  }
  return null;
}

async function readResponse(response) {
  const status = Number(response?.status ?? 0);
  const ok = response?.ok ?? (status >= 200 && status < 300);
  const contentType = response?.contentType ?? response?.headers?.get?.('content-type') ?? null;
  const bytes = response?.bodyBase64 !== undefined
    ? Buffer.from(response.bodyBase64,'base64')
    : Buffer.from(await response.arrayBuffer());
  return { ok,status,contentType,bytes };
}

function completed(product,bytes,signature,absolutePath,options,strategy,attempts) {
  const timestamp = new Date().toISOString();
  const digest = sha256(bytes);
  return {
    goods_id: product.goods_id,status: 'downloaded',download_status: 'completed',source_url: product.image_url,
    local_path: relativeLocalPath(absolutePath,options),absolute_path: absolutePath,
    content_type: signature.mime,byte_length: bytes.length,sha256: digest,content_sha256: digest,
    downloaded_at: timestamp,fetch_strategy: strategy,error_code: null,error_message: null,attempts
  };
}

function failure(product,code,message,attempts) {
  return {
    goods_id: product.goods_id,status: 'failed',download_status: 'failed',source_url: product.image_url ?? null,
    local_path: null,absolute_path: null,content_type: null,byte_length: null,sha256: null,content_sha256: null,
    downloaded_at: null,fetch_strategy: 'failed',error_code: code,error_message: message,attempts
  };
}

function resolveLocalPath(value,options) {
  return path.isAbsolute(value) ? value : path.resolve(options.baseDir ?? process.cwd(),value);
}
function relativeLocalPath(value,options) {
  return path.relative(options.baseDir ?? process.cwd(),value).replaceAll('\\','/');
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function imageError(code,message) { return Object.assign(new Error(message),{ code }); }
function mimeCompatible(declared,detected) {
  return declared === detected || (declared === 'image/jpg' && detected === 'image/jpeg') || declared === 'application/octet-stream';
}
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g,'_'); }
