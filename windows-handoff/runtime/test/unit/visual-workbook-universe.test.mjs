import test from 'node:test';
import assert from 'node:assert/strict';

import {parseVisualWorkbookUniverse} from '../../src/modules/sourcing/visual-workbook-universe.mjs';

const headers=['序号','Temu主图','goods_id','商品标题','用户场景','产品类型','Level3具体细分','相似产品簇','相似产品组','当前价格 EUR','销量','评分','评论数','当前排名','source_url','canonical_url','当前 Pool Version'];
const row=(id,title='cover')=>[1,null,id,title,'安全防护','车罩','摩托车车罩','车罩','车罩组',9.9,100,4.7,20,3,'https://temu/a','https://temu/a','pool-1'];

test('parses the complete workbook universe and maps embedded images by row',()=>{
  const parsed=parseVisualWorkbookUniverse([headers,row('001'),row('002')],{
    workbookPath:'/bound.xlsx',workbookSha256:'book',sheetFingerprint:{valuesSha256:'values'},
    images:[{anchor:{from:{row:1,col:1}},sha256:'image-1',bytes:Buffer.from('a')}],
  });
  assert.equal(parsed.items.length,2);
  assert.equal(parsed.items[0].goods_id,'001');
  assert.equal(parsed.items[0].visual_index_status,'IMAGE_AVAILABLE');
  assert.equal(parsed.items[1].visual_index_status,'IMAGE_MISSING');
  assert.equal(parsed.pool_version_id,'pool-1');
  assert.equal(parsed.source.workbook_path,'/bound.xlsx');
});

test('rejects duplicate goods and mixed pool versions',()=>{
  assert.throws(()=>parseVisualWorkbookUniverse([headers,row('001'),row('001')],{images:[]}),error=>error.code==='VISUAL_WORKBOOK_DUPLICATE_GOODS');
  const other=row('002'); other[16]='pool-2';
  assert.throws(()=>parseVisualWorkbookUniverse([headers,row('001'),other],{images:[]}),error=>error.code==='VISUAL_WORKBOOK_POOL_MIXED');
});

test('requires real Sheet05 headers rather than fixed column positions',()=>{
  assert.throws(()=>parseVisualWorkbookUniverse([headers.filter(x=>x!=='当前价格 EUR'),row('001')],{images:[]}),error=>error.code==='VISUAL_WORKBOOK_HEADERS_REQUIRED');
});
