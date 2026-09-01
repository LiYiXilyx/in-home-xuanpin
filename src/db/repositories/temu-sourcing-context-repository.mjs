import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openTemuContextDatabase(databasePath) {
  return new DatabaseSync(path.resolve(databasePath),{readOnly:true});
}

export function createTemuSourcingContextRepository(db,{
  projectRoot=process.cwd(),
  imageCacheRoot=path.join(projectRoot,'outputs/week1-mvp/image-cache'),
}={}) {
  const root=path.resolve(projectRoot);
  const cacheRoot=path.resolve(imageCacheRoot);

  function getTemuContext(temuGoodsId) {
    const goodsId=String(temuGoodsId);
    const product=db.prepare(`SELECT id,external_product_id,title
      FROM products WHERE platform='temu' AND external_product_id=?`).get(goodsId);
    if(!product) return missingContext(goodsId);

    const image=db.prepare(`SELECT source_url,local_path,status,download_status,sha256,content_sha256
      FROM product_images WHERE product_id=? AND image_kind='main'
      ORDER BY CASE WHEN download_status='completed' OR status='downloaded' THEN 0 ELSE 1 END,id DESC LIMIT 1`).get(product.id);
    const classification=db.prepare(`SELECT level1,level2,level3
      FROM product_classifications WHERE product_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(product.id);
    const resolved=resolveValidatedImage(goodsId,image);
    const available=Boolean(product.title&&resolved);
    return {
      temu_context_status:available?'AVAILABLE':'MISSING',
      temu_goods_id:goodsId,
      temu_title:product.title??null,
      temu_image_local_path:resolved?.relativePath??null,
      temu_image_canonical_path:resolved?.canonicalPath??null,
      temu_image_source_url:image?.source_url??null,
      temu_image_sha256:image?.content_sha256??image?.sha256??null,
      level1:classification?.level1??null,
      level2:classification?.level2??null,
      level3:classification?.level3??null,
      similar_cluster:null,
    };
  }

  function getTemuContexts(temuGoodsIds) {
    const result=new Map();
    for(const goodsId of [...new Set((temuGoodsIds??[]).map(String))].sort(compareUtf8)) {
      result.set(goodsId,getTemuContext(goodsId));
    }
    return result;
  }

  function getActivePoolCount() {
    if(!tableExists('catalog_pool_versions')) return 0;
    const row=db.prepare(`SELECT product_count FROM catalog_pool_versions
      WHERE category_key='motorcycle-accessories' AND status='active'
      ORDER BY activated_at DESC,id DESC LIMIT 1`).get();
    return Number(row?.product_count??0);
  }

  function resolveValidatedImage(goodsId,image) {
    if(!image?.local_path) return null;
    if(image.status!=='downloaded'&&image.download_status!=='completed') return null;
    const relativePath=String(image.local_path).replaceAll('\\','/');
    if(path.isAbsolute(relativePath)) return null;
    if(path.parse(relativePath).name!==goodsId) return null;
    const requested=path.resolve(root,relativePath);
    if(!isContained(cacheRoot,requested)) return null;
    try {
      const canonicalRoot=fs.realpathSync(cacheRoot);
      const canonicalPath=fs.realpathSync(requested);
      if(!isContained(canonicalRoot,canonicalPath)) return null;
      fs.accessSync(canonicalPath,fs.constants.R_OK);
      if(!fs.statSync(canonicalPath).isFile()) return null;
      return {relativePath,canonicalPath};
    } catch {
      return null;
    }
  }

  function tableExists(name) {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  }

  return {getTemuContext,getTemuContexts,getActivePoolCount};
}

function missingContext(goodsId) {
  return {
    temu_context_status:'MISSING',temu_goods_id:goodsId,temu_title:null,
    temu_image_local_path:null,temu_image_canonical_path:null,temu_image_source_url:null,
    temu_image_sha256:null,level1:null,level2:null,level3:null,similar_cluster:null,
  };
}

function isContained(root,target) {
  const relative=path.relative(root,target);
  return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));
}

function compareUtf8(left,right) {
  return Buffer.compare(Buffer.from(left,'utf8'),Buffer.from(right,'utf8'));
}
