import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { loadArtifactTool } from '../analysis/artifact-runtime.mjs';

const SHEET_05='05_细分商品明细';
const SHEET_11='11_1688随机候选';
const HEADERS=[
  'Temu goods_id','Temu主图','random_sample_rank','original_rank','1688主图',
  '1688_product_id','1688标题','RMB价格','是否包邮','MOQ','月销件数',
  '累计销售件数','店铺','店铺资质','1688_image_url','1688商品链接',
  'image_download_status','image_sha256','sample_method','是否最终选择','人工备注',
];
const FORMULA_ERROR_PATTERN=/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/g;
const NAVY='#17365D';
const TEXT='#1F2937';

export async function writeRandom5Sheet({
  selectedWorkbookPath,candidates,cacheRoot,artifact=null,replaceFile=fs.rename,
}={}) {
  const workbookPath=await validateWorkbookPath(selectedWorkbookPath);
  const normalizedCandidates=normalizeCandidates(candidates??[]);
  assertCandidateContract(normalizedCandidates);
  const tools=artifact??await loadArtifactTool();
  const sourceWorkbook=await importWorkbook(workbookPath,tools);
  const sheet05=getRequiredSheet05(sourceWorkbook);
  const beforeFingerprint=await fingerprintSheet05(workbookPath,{ artifact:tools });
  const temuImages=await extractTemuImages(workbookPath,sheet05);
  removeSheet11(sourceWorkbook);
  const sheet11=sourceWorkbook.worksheets.add(SHEET_11);
  const rows=[];
  const supplierImages=[];
  let failedImageLabels=0;
  let temuImageCount=0;
  for(const [index,candidate] of normalizedCandidates.entries()) {
    const supplierImage=await verifiedSupplierImage(candidate,cacheRoot);
    const temuImage=temuImages.get(candidate.temu_goods_id)??null;
    if(temuImage) temuImageCount+=1;
    if(!supplierImage) failedImageLabels+=1;
    supplierImages.push(supplierImage);
    rows.push(candidateRow(candidate,{ supplierImage }));
    if(temuImage) addImage(sheet11,temuImage,index+1,1);
    if(supplierImage) addImage(sheet11,supplierImage,index+1,4);
  }
  buildSheet11(sheet11,rows,normalizedCandidates);

  const temporaryPath=siblingTemporaryPath(workbookPath);
  let replaced=false;
  try {
    await (await tools.SpreadsheetFile.exportXlsx(sourceWorkbook)).save(temporaryPath);
    const tempQa=await validateTemporaryWorkbook({
      workbookPath:temporaryPath,artifact:tools,beforeFingerprint,
      expectedCandidates:normalizedCandidates,expectedTemuImages:temuImageCount,
      expectedSupplierImages:supplierImages.filter(Boolean).length,expectedFailedLabels:failedImageLabels,
    });
    await replaceFile(temporaryPath,workbookPath);
    replaced=true;
    return {
      sheetName:SHEET_11,rowCount:normalizedCandidates.length,
      uniqueTemuGoods:new Set(normalizedCandidates.map(candidate=>candidate.temu_goods_id)).size,
      maxRowsPerGoods:maxRowsPerGoods(normalizedCandidates),temuImages:temuImageCount,
      supplierImages:supplierImages.filter(Boolean).length,failedImageLabels,
      selectedNonNull:tempQa.selectedNonNull,formulaErrors:tempQa.formulaErrors,
      sheet05Fingerprint:true,tempValidated:tempQa.pass,workbookReopenQa:tempQa.pass,
      atomicReplaced:replaced,
    };
  } finally {
    if(!replaced) await fs.rm(temporaryPath,{ force:true }).catch(()=>{});
  }
}

export async function fingerprintSheet05(workbookPath,{ artifact=null }={}) {
  const tools=artifact??await loadArtifactTool();
  const workbook=await importWorkbook(workbookPath,tools);
  const sheet=getRequiredSheet05(workbook);
  const used=sheet.getUsedRange(true);
  const values=used?.values??[];
  const formulas=used?.formulas??[];
  const hyperlinks=formulas.flat().filter(value=>/^=HYPERLINK\(/i.test(String(value??'')));
  const packageSemantics=await sheet05PackageSemantics(workbookPath);
  return {
    valuesSha256:hashJson(values),formulasSha256:hashJson(formulas),
    hyperlinksSha256:hashJson(hyperlinks),tableRangeSha256:hashJson(packageSemantics.tables),
    rangeSemanticsSha256:hashJson(packageSemantics.ranges),
    imageAnchorsSha256:hashJson(packageSemantics.images.map(image=>image.anchor)),
    imageContentSha256:hashJson(packageSemantics.images.map(image=>image.sha256)),
    imageCount:packageSemantics.images.length,
  };
}

async function validateWorkbookPath(value) {
  if(!value || path.extname(String(value)).toLowerCase()!=='.xlsx') {
    throw workbookError('WORKBOOK_EXTENSION','selected workbook must be an existing .xlsx file');
  }
  const resolved=path.resolve(String(value));
  try {
    const stat=await fs.stat(resolved);
    if(!stat.isFile()) throw new Error('not a file');
  } catch(error) {
    if(error?.code==='WORKBOOK_NOT_FOUND') throw error;
    throw workbookError('WORKBOOK_NOT_FOUND',`selected workbook does not exist: ${resolved}`);
  }
  return resolved;
}

async function importWorkbook(workbookPath,artifact) {
  try { return await artifact.SpreadsheetFile.importXlsx(await artifact.FileBlob.load(workbookPath)); }
  catch(error) { throw workbookError('WORKBOOK_MALFORMED',error.message); }
}

function getRequiredSheet05(workbook) {
  const sheet=workbook.worksheets.items.find(item=>item.name===SHEET_05);
  if(!sheet) throw workbookError('WORKBOOK_SHEET05_REQUIRED',`workbook must contain ${SHEET_05}`);
  return sheet;
}

function removeSheet11(workbook) {
  const existing=workbook.worksheets.items.find(item=>item.name===SHEET_11);
  if(existing) existing.delete();
}

function normalizeCandidates(candidates) {
  return candidates.map(raw=>({
    temu_goods_id:String(raw.temu_goods_id??'').trim(),
    random_sample_rank:numberOrNull(raw.random_sample_rank??raw.candidate_rank),
    original_rank:numberOrNull(raw.original_rank),
    '1688_product_id':String(raw['1688_product_id']??raw.supplier_product_id??'').trim(),
    '1688_title':raw['1688_title']??raw.supplier_title??null,
    '1688_product_url':raw['1688_product_url']??raw.supplier_url??null,
    '1688_image_url':raw['1688_image_url']??raw.supplier_image_url??null,
    '1688_image_local_path':raw['1688_image_local_path']??raw.supplier_image_local_path??null,
    price_rmb:numberOrNull(raw.price_rmb),shipping_text:raw.shipping_text??null,moq:numberOrNull(raw.moq),
    monthly_sales:numberOrNull(raw.monthly_sales),cumulative_sales:numberOrNull(raw.cumulative_sales),
    shop_name:raw.shop_name??null,shop_qualification:raw.shop_qualification??null,
    image_download_status:raw.image_download_status??'PENDING',image_sha256:raw.image_sha256??null,
    sample_method:raw.sample_method??null,selected_candidate:raw.selected_candidate??null,
  })).sort((left,right)=>compareUtf8(left.temu_goods_id,right.temu_goods_id)||
    left.random_sample_rank-right.random_sample_rank||compareUtf8(left['1688_product_id'],right['1688_product_id']));
}

function assertCandidateContract(candidates) {
  const counts=new Map();
  const pairs=new Set();
  for(const candidate of candidates) {
    if(!candidate.temu_goods_id || !candidate['1688_product_id'] || !Number.isInteger(candidate.random_sample_rank) || candidate.random_sample_rank<1) {
      throw workbookError('WORKBOOK_CANDIDATE_INVALID','candidate identity and ranks are required');
    }
    if(candidate.selected_candidate!==null) throw workbookError('WORKBOOK_SELECTED_CANDIDATE','V1 selected_candidate must remain null');
    const count=(counts.get(candidate.temu_goods_id)??0)+1;
    counts.set(candidate.temu_goods_id,count);
    if(count>5) throw workbookError('WORKBOOK_CANDIDATE_LIMIT',`more than five candidates for ${candidate.temu_goods_id}`);
    const pair=`${candidate.temu_goods_id}\0${candidate['1688_product_id']}`;
    if(pairs.has(pair)) throw workbookError('WORKBOOK_CANDIDATE_DUPLICATE',`duplicate candidate pair: ${pair}`);
    pairs.add(pair);
  }
}

function candidateRow(candidate,{ supplierImage }) {
  return [
    candidate.temu_goods_id,null,candidate.random_sample_rank,candidate.original_rank,
    supplierImage?null:'FAILED',candidate['1688_product_id'],candidate['1688_title'],candidate.price_rmb,
    candidate.shipping_text,candidate.moq,candidate.monthly_sales,candidate.cumulative_sales,
    candidate.shop_name,candidate.shop_qualification,candidate['1688_image_url'],null,
    candidate.image_download_status,candidate.image_sha256,candidate.sample_method,null,null,
  ];
}

function buildSheet11(sheet,rows,candidates) {
  sheet.showGridLines=false;
  sheet.getRange('A1:U1').values=[HEADERS];
  sheet.getRange('A1:U1').format={
    fill:NAVY,font:{ bold:true,color:'#FFFFFF',size:10 },horizontalAlignment:'center',
    verticalAlignment:'center',wrapText:true,borders:{ preset:'outside',style:'thin',color:'#95B3D7' },
  };
  sheet.getRange('A1:U1').format.rowHeight=34;
  if(rows.length) {
    const last=rows.length+1;
    sheet.getRange(`A2:U${last}`).values=rows;
    sheet.getRange(`A2:U${last}`).format={
      font:{ color:TEXT,size:9 },verticalAlignment:'center',wrapText:true,
      borders:{ insideHorizontal:{ style:'thin',color:'#E5E7EB' } },
    };
    sheet.getRange(`A2:U${last}`).format.rowHeight=74;
    sheet.getRange(`A2:A${last}`).format.numberFormat='@';
    sheet.getRange(`F2:F${last}`).format.numberFormat='@';
    sheet.getRange(`H2:H${last}`).format.numberFormat='¥#,##0.00';
    sheet.getRange(`C2:D${last}`).format.numberFormat='0';
    sheet.getRange(`J2:L${last}`).format.numberFormat='#,##0';
    sheet.getRange(`P2:P${last}`).formulas=candidates.map(candidate=>[
      candidate['1688_product_url']?`=HYPERLINK("${excel(candidate['1688_product_url'])}","打开1688商品")`:'',
    ]);
    sheet.getRange(`P2:P${last}`).format.font={ color:'#0563C1',underline:true };
    const table=sheet.tables.add(`A1:U${last}`,true,'Random5SupplierCandidates');
    table.style='TableStyleMedium2';
    table.showFilterButton=true;
  }
  [20,16,18,14,16,24,48,14,16,10,14,16,26,20,58,24,22,68,28,16,40]
    .forEach((width,index)=>sheet.getRange(`${column(index+1)}:${column(index+1)}`).format.columnWidth=width);
  sheet.freezePanes.freezeRows(1);
}

async function verifiedSupplierImage(candidate,cacheRoot) {
  if(candidate.image_download_status!=='SUCCESS' || !cacheRoot || !candidate.image_sha256) return null;
  const expected=`${candidate.temu_goods_id}/${candidate['1688_product_id']}.jpg`;
  if(candidate['1688_image_local_path']!==expected) return null;
  const resolvedRoot=path.resolve(cacheRoot);
  const resolvedFile=path.resolve(resolvedRoot,...expected.split('/'));
  if(!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  try {
    const bytes=await fs.readFile(resolvedFile);
    if(bytes.length<3 || bytes[0]!==0xff || bytes[1]!==0xd8 || bytes[2]!==0xff) return null;
    if(sha256(bytes)!==candidate.image_sha256) return null;
    const metadata=await loadSharp()(bytes,{ failOn:'error' }).metadata();
    if(metadata.format!=='jpeg' || !(metadata.width>0) || !(metadata.height>0)) return null;
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch { return null; }
}

async function extractTemuImages(workbookPath,sheet05) {
  const values=sheet05.getUsedRange(true)?.values??[];
  const headers=values[0]??[];
  const goodsIndex=headers.findIndex(header=>['goods_id','Temu goods_id'].includes(String(header??'').trim()));
  const imageIndex=headers.findIndex(header=>String(header??'').trim()==='Temu主图');
  if(goodsIndex<0 || imageIndex<0) throw workbookError('WORKBOOK_SHEET05_MAPPING','Sheet 05 goods_id/Temu主图 headers are required');
  const semantics=await sheet05PackageSemantics(workbookPath,{ includeBytes:true });
  const byGoods=new Map();
  for(const image of semantics.images) {
    if(image.anchor.from.col!==imageIndex) continue;
    const goodsId=normalizeGoodsId(values[image.anchor.from.row]?.[goodsIndex]);
    const mime=imageMime(image.bytes);
    if(!goodsId || !mime || byGoods.has(goodsId)) continue;
    byGoods.set(goodsId,`data:${mime};base64,${Buffer.from(image.bytes).toString('base64')}`);
  }
  return byGoods;
}

function addImage(sheet,dataUrl,row,col) {
  sheet.images.add({ dataUrl,anchor:{ from:{ row,col,rowOffsetPx:4,colOffsetPx:4 },extent:{ widthPx:86,heightPx:64 } } });
}

async function validateTemporaryWorkbook({
  workbookPath,artifact,beforeFingerprint,expectedCandidates,expectedTemuImages,expectedSupplierImages,expectedFailedLabels,
}) {
  const fingerprint=await fingerprintSheet05(workbookPath,{ artifact });
  if(JSON.stringify(fingerprint)!==JSON.stringify(beforeFingerprint)) {
    throw workbookError('WORKBOOK_SHEET05_CHANGED','Sheet 05 semantic fingerprint changed');
  }
  const workbook=await importWorkbook(workbookPath,artifact);
  const sheets=workbook.worksheets.items.filter(item=>item.name===SHEET_11);
  if(sheets.length!==1) throw workbookError('WORKBOOK_SHEET11_COUNT','Sheet 11 must exist exactly once');
  const sheet=sheets[0];
  const values=sheet.getUsedRange(true)?.values??[];
  if(JSON.stringify(values[0]??[])!==JSON.stringify(HEADERS)) throw workbookError('WORKBOOK_SHEET11_HEADERS','Sheet 11 headers differ');
  const rows=values.slice(1).filter(row=>normalizeGoodsId(row[0]));
  if(rows.length!==expectedCandidates.length) throw workbookError('WORKBOOK_SHEET11_ROWS','Sheet 11 row count differs');
  const expectedOrder=expectedCandidates.map(candidate=>[candidate.temu_goods_id,candidate.random_sample_rank]);
  const actualOrder=rows.map(row=>[normalizeGoodsId(row[0]),Number(row[2])]);
  if(JSON.stringify(actualOrder)!==JSON.stringify(expectedOrder)) throw workbookError('WORKBOOK_SHEET11_ORDER','Sheet 11 order differs');
  if(maxRowsPerGoods(actualOrder.map(([goodsId,rank])=>({ temu_goods_id:goodsId,random_sample_rank:rank })))>5) {
    throw workbookError('WORKBOOK_CANDIDATE_LIMIT','Sheet 11 exceeds five rows per goods ID');
  }
  const failedLabels=rows.filter(row=>row[4]==='FAILED').length;
  if(failedLabels!==expectedFailedLabels) throw workbookError('WORKBOOK_FAILED_IMAGE_LABELS','failed image labels differ');
  const selectedNonNull=rows.filter(row=>row[19]!==null && row[19]!==undefined && row[19]!=='').length;
  if(selectedNonNull!==0) throw workbookError('WORKBOOK_SELECTED_CANDIDATE','Sheet 11 selected candidate must be blank');
  const imageCount=sheet.images.items.length;
  if(imageCount!==expectedTemuImages+expectedSupplierImages) throw workbookError('WORKBOOK_IMAGE_COUNT','Sheet 11 image count differs');
  let errorInspection;
  try {
    errorInspection=await workbook.inspect({
      kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
      options:{ useRegex:true,maxResults:300 },summary:'Sheet 11 formula error scan',maxChars:1_000_000,
    });
  } finally {
    await fs.rm(`${workbookPath}.inspect.ndjson`,{ force:true }).catch(()=>{});
  }
  const formulaErrors=(String(errorInspection.ndjson??'').match(FORMULA_ERROR_PATTERN)??[]).length;
  if(formulaErrors!==0) throw workbookError('WORKBOOK_FORMULA_ERRORS',`${formulaErrors} formula errors found`);
  return { pass:true,selectedNonNull,formulaErrors };
}

async function sheet05PackageSemantics(workbookPath,{ includeBytes=false }={}) {
  const zip=await loadJsZip().loadAsync(await fs.readFile(workbookPath));
  const workbookXml=await textFile(zip,'xl/workbook.xml');
  const workbookRels=relationshipMap(await textFile(zip,'xl/_rels/workbook.xml.rels'));
  const sheetTag=[...workbookXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b[^>]*\/>/g)]
    .map(match=>match[0]).find(tag=>decodeXml(xmlAttr(tag,'name'))===SHEET_05);
  if(!sheetTag) throw workbookError('WORKBOOK_SHEET05_REQUIRED',`workbook must contain ${SHEET_05}`);
  const sheetTarget=workbookRels.get(xmlAttr(sheetTag,'r:id'));
  const sheetPath=resolvePackagePath('xl/workbook.xml',sheetTarget);
  const sheetXml=await textFile(zip,sheetPath);
  const sheetRelsPath=relationshipPartPath(sheetPath);
  const sheetRels=zip.file(sheetRelsPath)?relationshipMap(await textFile(zip,sheetRelsPath)):new Map();
  const tables=[];
  for(const match of sheetXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?tablePart\b[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const target=sheetRels.get(match[1]);
    if(!target) continue;
    const xml=await textFile(zip,resolvePackagePath(sheetPath,target));
    const tableTag=xml.match(/<(?:[A-Za-z_][\w.-]*:)?table\b[^>]*>/)?.[0]??'';
    const autoFilter=xml.match(/<(?:[A-Za-z_][\w.-]*:)?autoFilter\b[^>]*>/)?.[0]??'';
    const columns=[...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?tableColumn\b[^>]*>/g)].map(item=>decodeXml(xmlAttr(item[0],'name')));
    tables.push({
      name:xmlAttr(tableTag,'name'),displayName:xmlAttr(tableTag,'displayName'),ref:xmlAttr(tableTag,'ref'),
      autoFilterRef:xmlAttr(autoFilter,'ref'),columns,
    });
  }
  const ranges={
    dimension:xmlAttr(sheetXml.match(/<(?:[A-Za-z_][\w.-]*:)?dimension\b[^>]*\/>/)?.[0]??'','ref'),
    autoFilter:xmlAttr(sheetXml.match(/<(?:[A-Za-z_][\w.-]*:)?autoFilter\b[^>]*\/>/)?.[0]??'','ref'),
    merges:[...sheetXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?mergeCell\b[^>]*ref="([^"]+)"[^>]*\/>/g)].map(match=>match[1]).sort(),
  };
  const images=[];
  for(const drawingMatch of sheetXml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?drawing\b[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const drawingTarget=sheetRels.get(drawingMatch[1]);
    if(!drawingTarget) continue;
    const drawingPath=resolvePackagePath(sheetPath,drawingTarget);
    const drawingXml=await textFile(zip,drawingPath);
    const drawingRelsPath=relationshipPartPath(drawingPath);
    const drawingRels=zip.file(drawingRelsPath)?relationshipMap(await textFile(zip,drawingRelsPath)):new Map();
    for(const anchorMatch of drawingXml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:\1>/g)) {
      const body=anchorMatch[2];
      const embed=body.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1];
      const target=drawingRels.get(embed);
      if(!target) continue;
      const mediaPath=resolvePackagePath(drawingPath,target);
      const media=zip.file(mediaPath);
      if(!media) continue;
      const bytes=await media.async('uint8array');
      const anchor={ type:anchorMatch[1],from:anchorPoint(body,'from'),to:anchorPoint(body,'to'),extent:anchorExtent(body) };
      images.push({ anchor,sha256:sha256(bytes),...(includeBytes?{ bytes }: {}) });
    }
  }
  images.sort((left,right)=>JSON.stringify(left.anchor).localeCompare(JSON.stringify(right.anchor))||left.sha256.localeCompare(right.sha256));
  tables.sort((left,right)=>String(left.name).localeCompare(String(right.name)));
  return { tables,ranges,images };
}

async function textFile(zip,name) {
  const entry=zip.file(name);
  if(!entry) throw workbookError('WORKBOOK_PACKAGE_INVALID',`missing XLSX part: ${name}`);
  return entry.async('string');
}

function relationshipMap(xml) {
  const map=new Map();
  for(const match of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag=match[0];
    map.set(xmlAttr(tag,'Id'),decodeXml(xmlAttr(tag,'Target')));
  }
  return map;
}

function resolvePackagePath(ownerPart,target) {
  if(!target) return '';
  if(target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(ownerPart),target));
}

function relationshipPartPath(part) {
  return path.posix.join(path.posix.dirname(part),'_rels',`${path.posix.basename(part)}.rels`);
}

function anchorPoint(xml,name) {
  const content=xml.match(new RegExp(`<xdr:${name}>([\\s\\S]*?)<\\/xdr:${name}>`))?.[1];
  if(!content) return null;
  return {
    col:Number(content.match(/<xdr:col>(-?\d+)<\/xdr:col>/)?.[1]??0),
    colOff:Number(content.match(/<xdr:colOff>(-?\d+)<\/xdr:colOff>/)?.[1]??0),
    row:Number(content.match(/<xdr:row>(-?\d+)<\/xdr:row>/)?.[1]??0),
    rowOff:Number(content.match(/<xdr:rowOff>(-?\d+)<\/xdr:rowOff>/)?.[1]??0),
  };
}

function anchorExtent(xml) {
  const tag=xml.match(/<xdr:ext\b[^>]*\/>/)?.[0];
  return tag?{ cx:Number(xmlAttr(tag,'cx')??0),cy:Number(xmlAttr(tag,'cy')??0) }:null;
}

function xmlAttr(tag,name) {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return tag.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`))?.[1]??null;
}

function decodeXml(value) {
  return String(value??'').replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&lt;','<')
    .replaceAll('&gt;','>').replaceAll('&amp;','&');
}

function siblingTemporaryPath(workbookPath) {
  return path.join(path.dirname(workbookPath),`.${path.basename(workbookPath,'.xlsx')}.tmp-${crypto.randomUUID()}.xlsx`);
}

function maxRowsPerGoods(candidates) {
  const counts=new Map();
  for(const candidate of candidates) counts.set(candidate.temu_goods_id,(counts.get(candidate.temu_goods_id)??0)+1);
  return Math.max(0,...counts.values());
}

function normalizeGoodsId(value) { return String(value??'').trim().replace(/^'/,''); }
function numberOrNull(value) { if(value===null || value===undefined || value==='') return null;const number=Number(value);return Number.isFinite(number)?number:null; }
function compareUtf8(left,right) { return Buffer.compare(Buffer.from(left.normalize('NFC'),'utf8'),Buffer.from(right.normalize('NFC'),'utf8')); }
function hashJson(value) { return sha256(Buffer.from(JSON.stringify(value),'utf8')); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function excel(value) { return String(value??'').replaceAll('"','""'); }
function column(number) { let result='';for(let value=number;value;value=Math.floor((value-1)/26)) result=String.fromCharCode(65+(value-1)%26)+result;return result; }

function imageMime(bytes) {
  if(bytes?.length>=3 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return 'image/jpeg';
  if(bytes?.length>=8 && Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if(bytes?.length>=12 && Buffer.from(bytes.subarray(0,4)).toString('ascii')==='RIFF' && Buffer.from(bytes.subarray(8,12)).toString('ascii')==='WEBP') return 'image/webp';
  return null;
}

let sharpInstance=null;
let jsZipInstance=null;
function loadSharp() { if(!sharpInstance) sharpInstance=loadDependency('sharp');return sharpInstance; }
function loadJsZip() { if(!jsZipInstance) jsZipInstance=loadDependency('jszip');return jsZipInstance; }
function loadDependency(name) {
  const root=process.env.TEMU_ARTIFACT_NODE_MODULES;
  const require=root?createRequire(path.join(path.resolve(root),'package.json')):createRequire(import.meta.url);
  return require(name);
}

function workbookError(code,message) {
  const error=new Error(`${code}: ${message}`);
  error.code=code;
  return error;
}
