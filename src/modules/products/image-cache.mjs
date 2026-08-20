import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SIGNATURES = [
  { mime: 'image/png', extension: '.png', test: bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  { mime: 'image/jpeg', extension: '.jpg', test: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: 'image/webp', extension: '.webp', test: bytes => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'image/gif', extension: '.gif', test: bytes => /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) },
  { mime: 'image/avif', extension: '.avif', test: bytes => bytes.subarray(4, 12).toString().includes('ftyp') && bytes.subarray(8, 32).toString().includes('avif') }
];

export async function cacheProductImage(product, options) {
  const { cacheDir, fetchImpl = fetch, minimumBytes = 1024 } = options;
  if (!product.image_url) return failure(product, 'IMAGE_URL_MISSING', '商品主图 URL 缺失。');
  let response;
  try {
    response = await fetchImpl(product.image_url, {
      redirect: 'follow', headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*', referer: 'https://www.temu.com/' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
    });
  } catch (error) {
    return failure(product, 'IMAGE_FETCH_FAILED', error.message);
  }
  if (!response.ok) return failure(product, 'IMAGE_HTTP_ERROR', `HTTP ${response.status}`);
  const declaredMime = String(response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
  if (!declaredMime.startsWith('image/')) return failure(product, 'IMAGE_MIME_INVALID', `Content-Type ${declaredMime || 'missing'}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < minimumBytes) return failure(product, 'IMAGE_TOO_SMALL', `${bytes.length} bytes < ${minimumBytes}`);
  const signature = SIGNATURES.find(item => item.test(bytes));
  if (!signature) return failure(product, 'IMAGE_SIGNATURE_INVALID', '文件头不是受支持的图片格式。');
  if (!mimeCompatible(declaredMime, signature.mime)) return failure(product, 'IMAGE_MIME_MISMATCH', `声明 ${declaredMime}，文件头 ${signature.mime}`);
  await fs.mkdir(cacheDir, { recursive: true });
  const targetPath = path.join(cacheDir, `${safeName(product.goods_id)}${signature.extension}`);
  await fs.writeFile(targetPath, bytes);
  return {
    goods_id: product.goods_id, status: 'downloaded', source_url: product.image_url, local_path: targetPath,
    content_type: signature.mime, byte_length: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    error_code: null, error_message: null
  };
}

export async function cacheProductImages(products, options) {
  const concurrency = Math.max(1, Math.min(Number(options.concurrency ?? 3), 6));
  const results = new Array(products.length);
  let next = 0;
  async function worker() {
    while (next < products.length) { const index = next++; results[index] = await cacheProductImage(products[index], options); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, () => worker()));
  return { results, downloaded: results.filter(item => item.status === 'downloaded').length,
    failed: results.filter(item => item.status === 'failed').length, errors: results.filter(item => item.status === 'failed') };
}
function failure(product, code, message) {
  return { goods_id: product.goods_id, status: 'failed', source_url: product.image_url ?? null, local_path: null,
    content_type: null, byte_length: null, sha256: null, error_code: code, error_message: message };
}
function mimeCompatible(declared, detected) {
  return declared === detected || (declared === 'image/jpg' && detected === 'image/jpeg') || declared === 'application/octet-stream';
}
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, '_'); }
