import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadArtifactTool } from '../../src/modules/analysis/artifact-runtime.mjs';
import {
  fingerprintSheet05,
  writeRandom5Sheet,
} from '../../src/modules/sourcing/random5-workbook.mjs';

const SHEET_11='11_1688随机候选';
const HEADERS=[
  'Temu goods_id','Temu主图','random_sample_rank','original_rank','1688主图',
  '1688_product_id','1688标题','RMB价格','是否包邮','MOQ','月销件数',
  '累计销售件数','店铺','店铺资质','1688_image_url','1688商品链接',
  'image_download_status','image_sha256','sample_method','是否最终选择','人工备注',
];
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const sharp=loadSharpForTest();

function loadSharpForTest() {
  const dependencyRoot=process.env.TEMU_ARTIFACT_NODE_MODULES;
  const require=dependencyRoot?createRequire(path.join(path.resolve(dependencyRoot),'package.json')):createRequire(import.meta.url);
  return require('sharp');
}

async function setup(t,{ withSheet05=true,withOldSheet11=true }={}) {
  const artifact=await loadArtifactTool();
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'random5-workbook-'));
  t.after(()=>fs.rm(directory,{ recursive:true,force:true }));
  const workbookPath=path.join(directory,'opportunity-analysis-with-1688.xlsx');
  const cacheRoot=path.join(directory,'1688-images');
  const workbook=artifact.Workbook.create();
  if(withSheet05) {
    const sheet=workbook.worksheets.add('05_细分商品明细');
    sheet.getRange('A1:F3').values=[
      ['序号','Temu主图','goods_id','保留值','保留公式','Temu链接'],
      [1,null,"'100",7,null,null],
      [2,null,"'200",9,null,null],
    ];
    sheet.getRange('E2:E3').formulas=[['=D2*2'],['=D3*2']];
    sheet.getRange('F2:F3').formulas=[
      ['=HYPERLINK("https://www.temu.com/100","打开")'],
      ['=HYPERLINK("https://www.temu.com/200","打开")'],
    ];
    sheet.getRange('A1:F1').format={ fill:'#17365D',font:{ bold:true,color:'#FFFFFF' } };
    sheet.getRange('A2:F3').format.rowHeight=72;
    const table=sheet.tables.add('A1:F3',true,'OpportunityDetail');
    table.style='TableStyleMedium2';
    table.showFilterButton=true;
    sheet.images.add({ dataUrl:`data:image/png;base64,${PNG.toString('base64')}`,anchor:{ from:{ row:1,col:1 },extent:{ widthPx:60,heightPx:60 } } });
    sheet.images.add({ dataUrl:`data:image/png;base64,${PNG.toString('base64')}`,anchor:{ from:{ row:2,col:1 },extent:{ widthPx:60,heightPx:60 } } });
    sheet.freezePanes.freezeRows(1);
  } else {
    workbook.worksheets.add('10_最终3-5机会产品').getRange('A1').values=[['only sheet']];
  }
  if(withSheet05) workbook.worksheets.add('10_最终3-5机会产品').getRange('A1:B2').values=[['排名','商品'],[1,'keep me']];
  if(withOldSheet11) workbook.worksheets.add(SHEET_11).getRange('A1').values=[['STALE']];
  await (await artifact.SpreadsheetFile.exportXlsx(workbook)).save(workbookPath);
  return { artifact,directory,workbookPath,cacheRoot };
}

async function cachedCandidate(context,{ goodsId,productId,rank,originalRank,status='SUCCESS' }) {
  let relativePath=null;
  let imageSha256=null;
  if(status==='SUCCESS') {
    const bytes=await sharp(PNG).jpeg().toBuffer();
    relativePath=`${goodsId}/${productId}.jpg`;
    await fs.mkdir(path.join(context.cacheRoot,String(goodsId)),{ recursive:true });
    await fs.writeFile(path.join(context.cacheRoot,...relativePath.split('/')),bytes);
    imageSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  }
  return {
    run_id:'run-sheet11',temu_goods_id:String(goodsId),candidate_rank:rank,original_rank:originalRank,
    supplier_product_id:String(productId),supplier_title:`Supplier ${productId}`,
    supplier_url:`https://detail.1688.com/offer/${productId}.html`,
    supplier_image_url:`https://cbu01.alicdn.com/${productId}.jpg`,
    supplier_image_local_path:relativePath,price_rmb:3.5,shipping_text:'包邮',moq:2,
    monthly_sales:93,cumulative_sales:370,shop_name:'测试店铺',shop_qualification:'实力商家',
    image_download_status:status,image_sha256:imageSha256,
    sample_method:'SHA256_STABLE_ORDER_V1',selected_candidate:null,
  };
}

async function importWorkbook(context) {
  return context.artifact.SpreadsheetFile.importXlsx(await context.artifact.FileBlob.load(context.workbookPath));
}

test('writer rebuilds Sheet 11 in stable order while preserving every Sheet 05 semantic fingerprint', async t => {
  const context=await setup(t);
  const before=await fingerprintSheet05(context.workbookPath,{ artifact:context.artifact });
  const candidates=[
    await cachedCandidate(context,{ goodsId:'100',productId:'p2',rank:2,originalRank:8 }),
    await cachedCandidate(context,{ goodsId:'200',productId:'p3',rank:1,originalRank:3,status:'FAILED' }),
    await cachedCandidate(context,{ goodsId:'100',productId:'p1',rank:1,originalRank:4 }),
  ];

  const qa=await writeRandom5Sheet({
    selectedWorkbookPath:context.workbookPath,candidates,cacheRoot:context.cacheRoot,artifact:context.artifact,
  });
  const after=await fingerprintSheet05(context.workbookPath,{ artifact:context.artifact });
  const workbook=await importWorkbook(context);
  const sheet=workbook.worksheets.getItem(SHEET_11);
  const values=sheet.getUsedRange(true).values;
  const formulas=sheet.getUsedRange(true).formulas;

  assert.deepEqual(after,before);
  assert.deepEqual(values[0],HEADERS);
  assert.deepEqual(values.slice(1).map(row=>[String(row[0]).replace(/^'/,''),row[2],row[3]]),[
    ['100',1,4],['100',2,8],['200',1,3],
  ]);
  assert.equal(values[3][4],'FAILED');
  assert.equal(values[3][14],'https://cbu01.alicdn.com/p3.jpg');
  assert.match(formulas[1][15],/^=HYPERLINK\("https:\/\/detail\.1688\.com\/offer\/p1\.html"/);
  assert.deepEqual(values.slice(1).map(row=>[row[19],row[20]]),[[null,null],[null,null],[null,null]]);
  assert.equal(sheet.images.items.length,5);
  assert.equal(workbook.worksheets.items.filter(item=>item.name===SHEET_11).length,1);
  assert.equal(qa.sheetName,SHEET_11);
  assert.equal(qa.rowCount,3);
  assert.equal(qa.uniqueTemuGoods,2);
  assert.equal(qa.maxRowsPerGoods,2);
  assert.equal(qa.temuImages,3);
  assert.equal(qa.supplierImages,2);
  assert.equal(qa.failedImageLabels,1);
  assert.equal(qa.selectedNonNull,0);
  assert.equal(qa.formulaErrors,0);
  assert.equal(qa.tempValidated,true);
  assert.equal(qa.atomicReplaced,true);
});

test('more than five candidates for one goods ID is rejected before replacing the workbook', async t => {
  const context=await setup(t);
  const before=crypto.createHash('sha256').update(await fs.readFile(context.workbookPath)).digest('hex');
  const candidates=[];
  for(let rank=1;rank<=6;rank+=1) candidates.push(await cachedCandidate(context,{
    goodsId:'100',productId:`p${rank}`,rank,originalRank:rank,
  }));

  await assert.rejects(
    ()=>writeRandom5Sheet({ selectedWorkbookPath:context.workbookPath,candidates,cacheRoot:context.cacheRoot,artifact:context.artifact }),
    error=>error?.code==='WORKBOOK_CANDIDATE_LIMIT',
  );

  const after=crypto.createHash('sha256').update(await fs.readFile(context.workbookPath)).digest('hex');
  assert.equal(after,before);
  assert.deepEqual((await fs.readdir(context.directory)).filter(name=>name.includes('.tmp-')),[]);
});

test('invalid SUCCESS cache is displayed as FAILED without losing source URL', async t => {
  const context=await setup(t);
  const candidate=await cachedCandidate(context,{ goodsId:'100',productId:'corrupt',rank:1,originalRank:1 });
  await fs.writeFile(path.join(context.cacheRoot,'100','corrupt.jpg'),'not a jpeg');

  const qa=await writeRandom5Sheet({
    selectedWorkbookPath:context.workbookPath,candidates:[candidate],cacheRoot:context.cacheRoot,artifact:context.artifact,
  });
  const workbook=await importWorkbook(context);
  const values=workbook.worksheets.getItem(SHEET_11).getUsedRange(true).values;

  assert.equal(values[1][4],'FAILED');
  assert.equal(values[1][14],candidate.supplier_image_url);
  assert.equal(values[1][16],'SUCCESS');
  assert.equal(qa.supplierImages,0);
  assert.equal(qa.failedImageLabels,1);
});

test('temporary validation or atomic replacement failure never damages the original workbook', async t => {
  const context=await setup(t);
  const candidate=await cachedCandidate(context,{ goodsId:'100',productId:'p1',rank:1,originalRank:1 });
  const before=crypto.createHash('sha256').update(await fs.readFile(context.workbookPath)).digest('hex');

  await assert.rejects(()=>writeRandom5Sheet({
    selectedWorkbookPath:context.workbookPath,candidates:[candidate],cacheRoot:context.cacheRoot,artifact:context.artifact,
    replaceFile:async()=>{ const error=new Error('replace denied');error.code='EACCES';throw error; },
  }),/replace denied/);

  const after=crypto.createHash('sha256').update(await fs.readFile(context.workbookPath)).digest('hex');
  assert.equal(after,before);
  assert.deepEqual((await fs.readdir(context.directory)).filter(name=>name.includes('.tmp-')),[]);
});

test('writer rejects missing, non-xlsx, and workbooks without Sheet 05', async t => {
  const context=await setup(t,{ withSheet05:false,withOldSheet11:false });
  await assert.rejects(
    ()=>writeRandom5Sheet({ selectedWorkbookPath:path.join(context.directory,'missing.xlsx'),candidates:[],cacheRoot:context.cacheRoot,artifact:context.artifact }),
    error=>error?.code==='WORKBOOK_NOT_FOUND',
  );
  await assert.rejects(
    ()=>writeRandom5Sheet({ selectedWorkbookPath:path.join(context.directory,'not-xlsx.xls'),candidates:[],cacheRoot:context.cacheRoot,artifact:context.artifact }),
    error=>error?.code==='WORKBOOK_EXTENSION',
  );
  await assert.rejects(
    ()=>writeRandom5Sheet({ selectedWorkbookPath:context.workbookPath,candidates:[],cacheRoot:context.cacheRoot,artifact:context.artifact }),
    error=>error?.code==='WORKBOOK_SHEET05_REQUIRED',
  );
});
