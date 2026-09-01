import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { loadArtifactTool } from '../analysis/artifact-runtime.mjs';

const SHEET='05_细分商品明细';
const REQUIRED=['goods_id','当前价格 EUR','当前 Pool Version','相似产品簇','用户场景','产品类型','Level3具体细分'];

export async function loadRunOpportunityWorkbook({workbookPath,runGoodsIds,artifact=null}={}) {
  const bytes=await fs.readFile(workbookPath);
  const tools=artifact??await loadArtifactTool();
  const workbook=await tools.SpreadsheetFile.importXlsx(await tools.FileBlob.load(workbookPath));
  const sheet=workbook.worksheets.items.find(item=>item.name===SHEET);
  if(!sheet) throw fault('REVIEW_WORKBOOK_SHEET_REQUIRED',`workbook 缺少 ${SHEET}`);
  const sourceId=`${crypto.createHash('sha256').update(bytes).digest('hex')}#${SHEET}`;
  return parseRunOpportunitySheet(sheet.getUsedRange(true)?.values??[],{runGoodsIds,sourceId});
}

export function parseRunOpportunitySheet(values,{runGoodsIds,sourceId}={}) {
  const headers=(values[0]??[]).map(value=>String(value??'').trim());
  const indexes=Object.fromEntries(headers.map((name,index)=>[name,index]));
  const absent=REQUIRED.filter(name=>indexes[name]===undefined);
  if(absent.length) throw fault('REVIEW_WORKBOOK_HEADERS_REQUIRED',`workbook 缺少表头：${absent.join(', ')}`);
  const requested=new Set((runGoodsIds??[]).map(normalizeId));
  const found=new Map();
  for(const row of values.slice(1)) {
    const goodsId=normalizeId(row[indexes.goods_id]);
    if(!requested.has(goodsId)) continue;
    if(found.has(goodsId)) throw fault('REVIEW_WORKBOOK_DUPLICATE_GOODS',`workbook goods_id 重复：${goodsId}`);
    const pool=text(row[indexes['当前 Pool Version']]);
    found.set(goodsId,{
      temu_goods_id:goodsId,
      temu_listed_price_eur:positiveNumber(row[indexes['当前价格 EUR']]),
      temu_currency:'EUR',temu_price_source:'RUN_SELECTED_WORKBOOK_SHEET05',
      temu_price_source_id:`${sourceId}#${pool??'NO_POOL'}`,pool_version_id:pool,
      similar_cluster:text(row[indexes['相似产品簇']]),
      level1:text(row[indexes['用户场景']]),level2:text(row[indexes['产品类型']]),
      level3:text(row[indexes['Level3具体细分']]),
    });
  }
  const missing=[...requested].filter(id=>!found.has(id));
  if(missing.length) throw fault('REVIEW_WORKBOOK_GOODS_MISSING',`workbook 缺少 run goods：${missing.join(',')}`);
  return {sourceId,itemsByGoodsId:new Map([...found].sort(([a],[b])=>compareUtf8(a,b)))};
}

function normalizeId(value) { return String(value??'').replace(/^'/,'').trim().normalize('NFC'); }
function text(value) { const result=String(value??'').trim().normalize('NFC');return result&&result!=='-'&&result!=='—'?result:null; }
function positiveNumber(value) { const n=Number(value);return Number.isFinite(n)&&n>0?n:null; }
function compareUtf8(a,b) { return Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8')); }
function fault(code,message) { return Object.assign(new Error(message),{code}); }
