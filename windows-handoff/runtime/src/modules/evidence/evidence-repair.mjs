import fs from 'node:fs/promises';
import path from 'node:path';
import { transaction } from '../../db/client.mjs';
import { createImageRepository } from '../../db/repositories/image-repository.mjs';
import { cacheProductImages,validateLocalImage } from '../products/image-cache.mjs';

// Evidence resolution intentionally never treats canonical_url as a source URL.
// The only permitted canonical use is a display-only fallback at export time.
export function resolveEvidence(db,identities,{ baseDir=process.cwd(),minimumBytes=1024 }={}) {
  const results=[];
  for (const identity of uniqueIdentities(identities)) {
    const product=db.prepare(`SELECT * FROM products WHERE platform=? AND external_product_id=?`).get(identity.platform,identity.goodsId);
    const canonical=clean(product?.canonical_url) ?? latestCanonical(db,identity);
    const snapshots=product ? db.prepare(`SELECT * FROM product_snapshots WHERE product_id=? ORDER BY captured_at DESC,id DESC`).all(product.id) : [];
    const stages=db.prepare(`SELECT * FROM catalog_staging_products WHERE platform=? AND goods_id=?
      ORDER BY last_seen_at DESC,id DESC`).all(identity.platform,identity.goodsId);
    const currentProductUrl=observationUrl(product?.source_url,canonical);
    const stageUrl=stages.map(row=>observationUrl(row.latest_source_url,canonical)).find(Boolean) ?? null;
    const latestSnapshotUrl=observationUrl(snapshots[0]?.source_url,canonical);
    const historicalSnapshotUrl=snapshots.slice(1).map(row=>observationUrl(row.source_url,canonical)).find(Boolean) ?? null;
    const currentUrl=currentProductUrl ?? stageUrl ?? latestSnapshotUrl ?? null;
    const historicalUrl=currentUrl ? null : historicalSnapshotUrl;
    const displayUrl=currentUrl ?? historicalUrl ?? canonical ?? null;
    const urlSource=currentUrl ? 'CURRENT_OBSERVATION' : historicalUrl ? 'HISTORICAL_OBSERVATION' : canonical ? 'CANONICAL_FALLBACK' : 'MISSING';
    const currentImage=clean(snapshots[0]?.image_url);
    const stageImage=stages.map(row=>clean(row.image_url)).find(Boolean) ?? null;
    const historicalImage=snapshots.slice(1).map(row=>clean(row.image_url)).find(Boolean) ?? null;
    const imageUrl=currentImage ?? stageImage ?? historicalImage ?? null;
    const images=product ? db.prepare(`SELECT * FROM product_images WHERE product_id=? AND image_kind='main'
      ORDER BY CASE WHEN download_status='completed' THEN 0 ELSE 1 END,updated_at DESC,id DESC`).all(product.id) : [];
    results.push({ platform:identity.platform,goods_id:identity.goodsId,scopes:identity.scopes,product_id:product ? Number(product.id) : null,
      canonical_url:canonical,current_source_url:currentUrl,historical_source_url:historicalSnapshotUrl,
      display_url:displayUrl,url_source:urlSource,image_url:imageUrl,image_provenance:currentImage?'current_snapshot':stageImage?'catalog_staging':historicalImage?'historical_snapshot':null,
      image_records:images,baseDir,minimumBytes });
  }
  return results;
}

export async function auditEvidence(db,{ baseDir=process.cwd(),minimumBytes=1024 }={}) {
  const identities=listAuditIdentities(db);
  const rows=resolveEvidence(db,identities,{baseDir,minimumBytes});
  for (const row of rows) {
    const local=await inspectLocalImages(row,{baseDir,minimumBytes});
    Object.assign(row,local);
    row.missing_current_source_url=!row.current_source_url;
    row.missing_image_url=!row.image_url;
    row.image_url_exists_but_local_cache_missing=Boolean(row.image_url) && !row.local_image_valid && !row.local_image_broken;
    row.canonical_only=!row.current_source_url && !row.historical_source_url && Boolean(row.canonical_url);
    row.both_url_missing=!row.display_url;
  }
  const fields=['missing_current_source_url','missing_image_url','image_url_exists_but_local_cache_missing','local_image_broken','canonical_only','both_url_missing'];
  const lists=Object.fromEntries(fields.map(field=>[field,rows.filter(row=>row[field]).map(key)]));
  return { total_rows:rows.length,active_rows:identities.filter(x=>x.scopes.includes('active')).length,
    opportunity_rows:identities.filter(x=>x.scopes.includes('opportunity')).length,
    counts:Object.fromEntries(fields.map(field=>[field,lists[field].length])),lists,rows };
}

export async function repairEvidence(db,{ baseDir=process.cwd(),cacheDir,minimumBytes=1024,timeoutMs=30000,delayMs=200,onProgress }={}) {
  const before=await auditEvidence(db,{baseDir,minimumBytes});
  const active=before.rows.filter(row=>row.scopes?.includes('active') && row.product_id);
  // Products and their latest snapshots are backfilled only from same-key observation evidence.
  transaction(db,()=>{
    for (const row of active) {
      if (!row.current_source_url) continue;
      db.prepare(`UPDATE products SET source_url=? WHERE id=? AND (source_url IS NULL OR TRIM(source_url)='' OR source_url=canonical_url)`).run(row.current_source_url,row.product_id);
    }
    for (const row of active) {
      if (!row.image_url) continue;
      db.prepare(`UPDATE product_snapshots SET image_url=? WHERE id=(SELECT id FROM product_snapshots WHERE product_id=? ORDER BY captured_at DESC,id DESC LIMIT 1)
        AND (image_url IS NULL OR TRIM(image_url)='')`).run(row.image_url,row.product_id);
    }
  });
  const refreshed=resolveEvidence(db,active,{baseDir,minimumBytes});
  for (const row of refreshed) Object.assign(row,await inspectLocalImages(row,{baseDir,minimumBytes}));
  const candidates=refreshed.filter(row=>row.image_url && !row.local_image_valid).map(row=>({ product_id:row.product_id,goods_id:row.goods_id,image_url:row.image_url,
    existing_local_path:row.valid_local_path ?? null }));
  const results=[];
  for (const candidate of candidates) {
    const result=(await cacheProductImages([candidate],{ cacheDir,baseDir,minimumBytes,timeoutMs,concurrency:1,attemptsPerStrategy:2,
      strategyOrder:['node'],fetchImpl:fetch } )).results[0];
    results.push(result);onProgress?.(result);
    if (delayMs>0) await delay(delayMs);
  }
  const repository=createImageRepository(db);
  transaction(db,()=>{for(const result of results){const candidate=candidates.find(x=>x.goods_id===result.goods_id);repository.upsert(candidate.product_id,result);}});
  const after=await auditEvidence(db,{baseDir,minimumBytes});
  return { before,after,candidates:candidates.length,results };
}

function listAuditIdentities(db) {
  const map=new Map();const add=(platform,goodsId,scope)=>{const k=`${platform}\u001f${goodsId}`;const row=map.get(k)??{platform:String(platform),goodsId:String(goodsId),scopes:[]};if(!row.scopes.includes(scope))row.scopes.push(scope);map.set(k,row);};
  for(const row of db.prepare(`SELECT p.platform,p.external_product_id goods_id FROM catalog_memberships m JOIN products p ON p.id=m.product_id WHERE m.active=1`).all()) add(row.platform,row.goods_id,'active');
  for(const row of db.prepare(`SELECT i.platform,i.goods_id FROM opportunity_snapshot_items i JOIN opportunity_analysis_snapshots s ON s.id=i.snapshot_id
    WHERE s.id=(SELECT id FROM opportunity_analysis_snapshots ORDER BY generated_at DESC,id DESC LIMIT 1)`).all()) add(row.platform,row.goods_id,'opportunity');
  return [...map.values()];
}
function uniqueIdentities(items){const map=new Map();for(const x of items)map.set(`${x.platform}\u001f${x.goodsId??x.goods_id}`, {platform:x.platform,goodsId:String(x.goodsId??x.goods_id),scopes:x.scopes??[]});return [...map.values()];}
function latestCanonical(db,identity){return clean(db.prepare(`SELECT canonical_url FROM catalog_staging_products WHERE platform=? AND goods_id=? ORDER BY last_seen_at DESC,id DESC LIMIT 1`).get(identity.platform,identity.goodsId)?.canonical_url);}
function observationUrl(value,canonical){const url=clean(value);return url && url!==canonical && /^https?:\/\//i.test(url) ? url : null;}
function clean(value){const text=String(value??'').trim();return text||null;}
function key(row){return `${row.platform}:${row.goods_id}`;}
async function inspectLocalImages(row,{baseDir,minimumBytes}) {
  let local_image_valid=false,local_image_broken=false,valid_local_path=null;
  for(const image of row.image_records){if(!image.local_path)continue;const localPath=path.isAbsolute(image.local_path)?image.local_path:path.resolve(baseDir,image.local_path);const checked=await validateLocalImage(localPath,{minimumBytes});
    if(checked.valid){local_image_valid=true;valid_local_path=image.local_path;break;}
    if(image.download_status==='completed')local_image_broken=true;
  }
  return { local_image_valid,local_image_broken,valid_local_path };
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
