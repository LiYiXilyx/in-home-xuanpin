import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob,SpreadsheetFile } from '@oai/artifact-tool';

export const MANUAL_HEADERS = ['初步分类','人工备注'];

export async function findLatestValidWorkbook(outputDir,fixedPath) {
  const extension=path.extname(fixedPath);
  const base=path.basename(fixedPath,extension);
  const candidates=[];
  for (const directory of [outputDir,path.join(outputDir,'.excel-history')]) {
    for (const entry of await fs.readdir(directory,{ withFileTypes:true }).catch(() => [])) {
      if (entry.isDirectory() && directory.endsWith('.excel-history')) {
        for (const nested of await fs.readdir(path.join(directory,entry.name),{ withFileTypes:true }).catch(() => [])) {
          if (!nested.isFile() || !nested.name.startsWith(base) || path.extname(nested.name).toLowerCase() !== '.xlsx') continue;
          const filePath=path.join(directory,entry.name,nested.name);
          const stat=await fs.stat(filePath).catch(() => null);
          if (stat) candidates.push({ filePath,mtimeMs:stat.mtimeMs });
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.startsWith(base) || path.extname(entry.name).toLowerCase() !== '.xlsx') continue;
      const filePath=path.join(directory,entry.name);
      const stat=await fs.stat(filePath).catch(() => null);
      if (stat) candidates.push({ filePath,mtimeMs:stat.mtimeMs });
    }
  }
  candidates.sort((a,b) => b.mtimeMs-a.mtimeMs);
  for (const candidate of candidates) {
    try {
      const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(candidate.filePath));
      workbook.worksheets.getItem('商品池');
      return candidate.filePath;
    } catch {}
  }
  return null;
}

export async function loadManualValues(outputDir,fixedPath) {
  const sourcePath=await findLatestValidWorkbook(outputDir,fixedPath);
  const empty={ sourcePath:null,byGoodsId:new Map(),byCanonicalUrl:new Map() };
  if (!sourcePath) return empty;
  try {
    const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
    const sheet=workbook.worksheets.getItem('商品池');
    const used=sheet.getUsedRange(true);
    const values=used?.values ?? [];
    const formulas=used?.formulas ?? [];
    const headers=values[0] ?? [];
    const goodsIndex=headers.indexOf('goods_id');
    const urlIndex=headers.indexOf('Temu链接');
    const manualIndexes=MANUAL_HEADERS.map(header => [header,headers.indexOf(header)]).filter(([,index]) => index >= 0);
    const state={ sourcePath,byGoodsId:new Map(),byCanonicalUrl:new Map() };
    for (let rowIndex=1;rowIndex<values.length;rowIndex+=1) {
      const row=values[rowIndex] ?? [];
      const manual=Object.fromEntries(manualIndexes.map(([header,index]) => [header,row[index] ?? '']));
      const goodsId=goodsIndex >= 0 ? String(row[goodsIndex] ?? '').trim() : '';
      const canonicalUrl=urlIndex >= 0 ? extractHyperlink(formulas[rowIndex]?.[urlIndex]) || String(row[urlIndex] ?? '').trim() : '';
      if (goodsId) state.byGoodsId.set(goodsId,manual);
      if (canonicalUrl) state.byCanonicalUrl.set(canonicalUrl,manual);
    }
    return state;
  } catch (error) {
    console.warn(`读取旧 Excel 人工字段失败，将继续导出：${error.message}`);
    return empty;
  }
}

export function manualValuesForProduct(state,product) {
  return state.byGoodsId.get(String(product.goods_id)) ?? state.byCanonicalUrl.get(product.canonical_url) ?? {};
}

export function extractHyperlink(formula) {
  const match=String(formula ?? '').match(/^=HYPERLINK\("((?:[^"]|"")*)"[;,]/i);
  return match ? match[1].replaceAll('""','"') : '';
}

export function extractHyperlinkLabel(formula) {
  const match=String(formula ?? '').match(/^=HYPERLINK\("(?:[^"]|"")*"[;,]"((?:[^"]|"")*)"\)$/i);
  return match ? match[1].replaceAll('""','"') : '';
}

export function timestampedWorkbookPath(fixedPath,now=new Date()) {
  const extension=path.extname(fixedPath);
  const base=path.basename(fixedPath,extension);
  const stamp=now.toISOString().replace(/[-:]/g,'').replace('T','-').replace('Z','').replace('.','-');
  return path.join(path.dirname(fixedPath),`${base}-${stamp}${extension}`);
}
