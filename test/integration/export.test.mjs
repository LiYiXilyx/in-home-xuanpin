import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileBlob,SpreadsheetFile } from '@oai/artifact-tool';
import { buildExportWorkbook } from '../../src/modules/export/export-service.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

test('export workbook has four sheets, embedded images, links and goods-bound manual values after rank order changes',async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'temu-export-'));
  t.after(() => fs.rm(dir,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }));
  const products=[product('g3',3),product('g2',2),product('g1',1)];
  const manualState={ sourcePath:'old.xlsx',byGoodsId:new Map([
    ['g1',{ '初步分类':'分类1','人工备注':'备注1' }],
    ['g2',{ '初步分类':'分类2','人工备注':'备注2' }],
    ['g3',{ '初步分类':'分类3','人工备注':'备注3' }]
  ]),byCanonicalUrl:new Map() };
  const imageDataByGoodsId=new Map(products.map(item => [item.goods_id,`data:image/png;base64,${png.toString('base64')}`]));
  const model={ products,quality:[{ job_id:'job',metric_name:'unique_goods_id',actual:3,threshold:3,passed:true,problem_samples:'',checked_at:'2026-08-21T00:00:00Z' }],jobs:[{
    job_id:'job',job_type:'catalog',target_count:3,started_at:'2026-08-21T00:00:00Z',finished_at:'2026-08-21T00:01:00Z',status:'completed',discovered:3,processed:3,success:3,failed:0,resume_count:1,error_summary:''
  }] };
  const built=buildExportWorkbook(model,{ manualState,imageDataByGoodsId });
  assert.equal(built.imageCount,3);
  const filePath=path.join(dir,'export.xlsx');
  await (await SpreadsheetFile.exportXlsx(built.workbook)).save(filePath);
  const imported=await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
  assert.deepEqual(imported.worksheets.items.map(sheet => sheet.name),['商品池','数据质量','任务记录','字段说明']);
  const sheet=imported.worksheets.getItem('商品池');
  const values=sheet.getUsedRange(true).values;
  const headers=values[0];
  const goodsIndex=headers.indexOf('goods_id');
  const noteIndex=headers.indexOf('人工备注');
  assert.deepEqual(values.slice(1).map(row => [row[goodsIndex],row[noteIndex]]),[['g3','备注3'],['g2','备注2'],['g1','备注1']]);
  assert.equal(sheet.images.items.length,3);
  assert.equal(sheet.getUsedRange(true).formulas.slice(1).filter(row => /^=HYPERLINK/.test(row[5])).length,3);
});

function product(goodsId,rank) {
  return { goods_id:goodsId,canonical_url:`https://example.test/${goodsId}`,title:`Product ${goodsId}`,status:'active',rank,
    primary_category:'Automotive',subcategory:'Motorcycles',price_amount:12.5,original_price_amount:null,
    discount_percent:null,sales_count:100,rating:4.8,review_count:20,captured_at:'2026-08-21T00:00:00Z',classification:null };
}
