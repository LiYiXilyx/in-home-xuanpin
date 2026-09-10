import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function compareUtf8(left,right) {
  return Buffer.compare(Buffer.from(left.normalize('NFC'),'utf8'),Buffer.from(right.normalize('NFC'),'utf8'));
}

export function classifySourceEntries(entries,{ previewLimit=10 }={}) {
  const valid=[];
  const invalidFiles=[];
  let excelFileCount=0;

  for(const entry of entries) {
    if(!entry.isFile()) continue;
    const normalizedName=entry.name.normalize('NFC');
    if(path.extname(normalizedName).toLowerCase()!=='.xlsx') continue;
    excelFileCount+=1;
    const match=normalizedName.match(/^([0-9]+)\.xlsx$/);
    if(!match) invalidFiles.push(normalizedName);
    else valid.push({ filename:normalizedName,temu_goods_id:match[1] });
  }

  valid.sort((left,right)=>compareUtf8(left.filename,right.filename));
  invalidFiles.sort(compareUtf8);
  const counts=new Map();
  for(const file of valid) counts.set(file.temu_goods_id,(counts.get(file.temu_goods_id)??0)+1);
  const duplicateGoodsId=[...counts.entries()].filter(([,count])=>count>1).map(([goodsId])=>goodsId).sort(compareUtf8);

  return {
    excelFileCount,
    valid,
    invalidFiles,
    duplicateGoodsId,
    preview:valid.slice(0,previewLimit),
  };
}

export function canonicalManifest(files) {
  const entries=files.map(file => ({
    filename:path.posix.basename(path.win32.basename(String(file.filename))).normalize('NFC'),
    fileSha256:String(file.fileSha256),
  })).sort((left,right)=>compareUtf8(left.filename,right.filename));
  const canonicalText=entries.map(file=>`${file.filename}\0${file.fileSha256}\n`).join('');
  return {
    canonicalText,
    sourceManifestSha256:crypto.createHash('sha256').update(canonicalText,'utf8').digest('hex'),
  };
}

export async function scanYingdaoDirectory({
  sourceDir,
  previewLimit=10,
  loadWorkbook=defaultLoadWorkbook,
  parseRows=null,
  importedAt=null,
}={}) {
  if(!sourceDir) throw new TypeError('sourceDir is required');
  const entries=await fs.readdir(sourceDir,{ withFileTypes:true });
  const classified=classifySourceEntries(entries,{ previewLimit });
  const manifestFiles=[];
  const failedFiles=[];
  const candidates=[];
  let parsedFiles=0;
  const parser=parseRows??(await import('./yingdao-export-parser.mjs')).parseYingdaoRows;
  const scanImportedAt=importedAt??new Date().toISOString();

  for(const source of classified.valid) {
    const filePath=path.join(sourceDir,source.filename);
    const bytes=await fs.readFile(filePath);
    const fileSha256=crypto.createHash('sha256').update(bytes).digest('hex');
    manifestFiles.push({ ...source,fileSha256 });
    try {
      const workbook=await loadWorkbook(filePath);
      const parsed=parser({
        temuGoodsId:source.temu_goods_id,
        sourceExportFile:source.filename,
        headers:workbook.headers,
        rows:workbook.rows,
        importedAt:scanImportedAt,
      });
      candidates.push(...parsed);
      parsedFiles+=1;
    } catch(error) {
      failedFiles.push({
        filename:source.filename,
        temu_goods_id:source.temu_goods_id,
        code:error?.code??'MALFORMED_XLSX',
        message:error instanceof Error?error.message:String(error),
      });
    }
  }

  const manifest=canonicalManifest(manifestFiles);
  return {
    sourceDir,
    excelFileCount:classified.excelFileCount,
    sourceExportFiles:classified.valid.length,
    parsedFiles,
    failedFiles,
    uniqueTemuGoodsId:new Set(classified.valid.map(file=>file.temu_goods_id)).size,
    totalSourceCandidates:candidates.length,
    invalidFiles:classified.invalidFiles,
    duplicateGoodsId:classified.duplicateGoodsId,
    preview:classified.preview,
    files:manifestFiles,
    candidates,
    ...manifest,
  };
}

async function defaultLoadWorkbook(filePath) {
  const { loadArtifactTool }=await import('../analysis/artifact-runtime.mjs');
  const artifact=await loadArtifactTool();
  const workbook=await artifact.SpreadsheetFile.importXlsx(await artifact.FileBlob.load(filePath));
  const sheet=workbook.worksheets.items[0];
  if(!sheet) throw sourceError('MALFORMED_XLSX','Workbook has no worksheet');
  const values=sheet.getUsedRange(true)?.values??[];
  if(values.length===0) throw sourceError('MALFORMED_XLSX','Worksheet is empty');
  return { headers:values[0],rows:values.slice(1) };
}

function sourceError(code,message) {
  const error=new Error(message);
  error.code=code;
  return error;
}
