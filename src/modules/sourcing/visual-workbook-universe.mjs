import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {loadArtifactTool} from '../analysis/artifact-runtime.mjs';
import {fingerprintSheet05,readSheet05PackageSemantics} from './random5-workbook.mjs';

const SHEET='05_细分商品明细';
const REQUIRED=['Temu主图','goods_id','商品标题','当前价格 EUR','销量','评分','评论数','当前排名','用户场景','产品类型','Level3具体细分','相似产品簇','相似产品组','source_url','canonical_url','当前 Pool Version'];

export async function loadVisualWorkbookUniverse({workbookPath,artifact=null}={}) {
  const resolved=path.resolve(required(workbookPath,'workbookPath'));
  const bytes=await fs.readFile(resolved);
  const tools=artifact??await loadArtifactTool();
  const workbook=await tools.SpreadsheetFile.importXlsx(await tools.FileBlob.load(resolved));
  const sheet=workbook.worksheets.items.find(item=>item.name===SHEET);
  if(!sheet) throw fault('VISUAL_WORKBOOK_SHEET_REQUIRED',`workbook 缺少 ${SHEET}`);
  const [semantics,sheetFingerprint]=await Promise.all([
    readSheet05PackageSemantics(resolved,{includeBytes:true}),fingerprintSheet05(resolved,{artifact:tools}),
  ]);
  return parseVisualWorkbookUniverse(sheet.getUsedRange(true)?.values??[],{
    workbookPath:resolved,workbookSha256:sha256(bytes),sheetFingerprint,images:semantics.images,
  });
}

export function parseVisualWorkbookUniverse(values,{workbookPath=null,workbookSha256=null,sheetFingerprint=null,images=[]}={}) {
  const headers=(values[0]??[]).map(value=>text(value));
  const indexes=Object.fromEntries(headers.map((name,index)=>[name,index]));
  const missing=REQUIRED.filter(name=>indexes[name]===undefined);
  if(missing.length) throw fault('VISUAL_WORKBOOK_HEADERS_REQUIRED',`Sheet 05 缺少表头：${missing.join(', ')}`);
  const imageByRow=new Map();
  for(const image of images) if(image?.anchor?.from?.col===indexes['Temu主图']&&!imageByRow.has(image.anchor.from.row)) imageByRow.set(image.anchor.from.row,image);
  const seen=new Set(),items=[];
  for(let rowIndex=1;rowIndex<values.length;rowIndex+=1) {
    const row=values[rowIndex],goodsId=id(row[indexes.goods_id]);
    if(!goodsId) continue;
    if(seen.has(goodsId)) throw fault('VISUAL_WORKBOOK_DUPLICATE_GOODS',`goods_id 重复：${goodsId}`);
    seen.add(goodsId);
    const image=imageByRow.get(rowIndex)??null;
    items.push({goods_id:goodsId,workbook_row:rowIndex+1,title:nullable(row[indexes['商品标题']]),
      image_sha256:image?.sha256??null,image_bytes:image?.bytes?Buffer.from(image.bytes):null,
      visual_index_status:image?'IMAGE_AVAILABLE':'IMAGE_MISSING',price_eur:num(row[indexes['当前价格 EUR']]),
      sales_count:num(row[indexes['销量']]),rating:num(row[indexes['评分']]),review_count:num(row[indexes['评论数']]),rank:num(row[indexes['当前排名']]),
      level1:nullable(row[indexes['用户场景']]),level2:nullable(row[indexes['产品类型']]),level3:nullable(row[indexes['Level3具体细分']]),
      similar_cluster:nullable(row[indexes['相似产品簇']]),similar_group:nullable(row[indexes['相似产品组']]),
      pool_version_id:nullable(row[indexes['当前 Pool Version']]),source_url:nullable(row[indexes.source_url]),canonical_url:nullable(row[indexes.canonical_url])});
  }
  items.sort((a,b)=>compareUtf8(a.goods_id,b.goods_id));
  const pools=[...new Set(items.map(item=>item.pool_version_id).filter(Boolean))];
  if(pools.length>1) throw fault('VISUAL_WORKBOOK_POOL_MIXED',`Sheet 05 包含多个 Pool Version：${pools.join(',')}`);
  const identity={workbook_sha256:workbookSha256,sheet05_semantic_fingerprint:sheetFingerprint,pool_version_id:pools[0]??null};
  return {source:{workbook_path:workbookPath,sheet_name:SHEET,...identity},pool_version_id:pools[0]??null,items,
    universe_goods_count:items.length,universe_image_count:items.filter(item=>item.image_bytes).length,
    fingerprint:sha256(Buffer.from(JSON.stringify(identity),'utf8'))};
}

function required(value,name){if(!value)throw fault('VISUAL_WORKBOOK_REQUIRED',`${name} required`);return String(value);}
function id(value){return String(value??'').replace(/^'/,'').trim().normalize('NFC');}
function text(value){return String(value??'').trim().normalize('NFC');}
function nullable(value){const v=text(value);return v&&v!=='-'&&v!=='—'?v:null;}
function num(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function compareUtf8(a,b){return Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function fault(code,message){return Object.assign(new Error(message),{code});}
