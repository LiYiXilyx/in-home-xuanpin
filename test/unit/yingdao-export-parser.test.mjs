import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseNonNegativeInteger,
  parseNullableText,
  parsePercent,
  parseSingleRmb,
  parseYingdaoRows,
  REQUIRED_YINGDAO_HEADERS,
} from '../../src/modules/sourcing/yingdao-export-parser.mjs';

test('parser maps official Chinese headers by name instead of column position', () => {
  const headers=['产品ID','标题','图片链接','产品链接','价格','是否包邮','销售额','起批量','起批量运费','月销件数','累计销售件数','复购率','48h发货率','最早上架时间','最新更新时间','店铺名称','店铺资质'];
  const rows=[['1002743693455','供应商标题','https://cbu01.alicdn.com/a.jpg','https://detail.1688.com/offer/1002743693455.html','3.50','不包邮','200+','1','-','93','370','12.5%','99%','2025-12-12 19:42:54','2026-08-17 00:06:08','示例店铺','实力商家']];

  const [item]=parseYingdaoRows({ temuGoodsId:601,sourceExportFile:'/raw/601.xlsx',headers,rows,importedAt:'2026-08-31T00:00:00.000Z' });

  assert.deepEqual(item,{
    temu_goods_id:'601',
    original_rank:1,
    '1688_product_id':'1002743693455',
    '1688_title':'供应商标题',
    '1688_product_url':'https://detail.1688.com/offer/1002743693455.html',
    '1688_image_url':'https://cbu01.alicdn.com/a.jpg',
    price_raw:'3.50',
    price_rmb:3.5,
    shipping_text:'不包邮',
    sales_amount_raw:'200+',
    moq:1,
    moq_shipping_raw:null,
    monthly_sales:93,
    cumulative_sales:370,
    repurchase_rate:0.125,
    shipping_48h_rate:0.99,
    first_listed_at:'2025-12-12 19:42:54',
    updated_at:'2026-08-17 00:06:08',
    shop_name:'示例店铺',
    shop_qualification:'实力商家',
    source_export_file:'/raw/601.xlsx',
    imported_at:'2026-08-31T00:00:00.000Z',
  });
});

test('null and numeric normalization is conservative', () => {
  assert.equal(parseNullableText(' - '),null);
  assert.equal(parseNullableText('  '),null);
  assert.equal(parseNullableText(0),'0');
  assert.equal(parseSingleRmb('3.50'),3.5);
  assert.equal(parseSingleRmb('3.50-5.00'),null);
  assert.equal(parseSingleRmb('面议'),null);
  assert.equal(parseNonNegativeInteger('1,000'),null);
  assert.equal(parseNonNegativeInteger('1000'),1000);
  assert.equal(parsePercent('99%'),0.99);
  assert.equal(parsePercent('0.99'),null);
  assert.equal(parsePercent('101%'),null);
});

test('blank official rows are skipped without renumbering later original_rank', () => {
  const headers=[...REQUIRED_YINGDAO_HEADERS];
  const valueByHeader={ '产品ID':'998877665544','标题':'第二行' };
  const rows=[Array(headers.length).fill(''),headers.map(header=>valueByHeader[header]??'-')];
  const [item]=parseYingdaoRows({ temuGoodsId:'000601',sourceExportFile:'000601.xlsx',headers,rows,importedAt:'now' });
  assert.equal(item.temu_goods_id,'000601');
  assert.equal(item['1688_product_id'],'998877665544');
  assert.equal(item.original_rank,2);
});

test('missing official header fails the whole source file', () => {
  const headers=REQUIRED_YINGDAO_HEADERS.filter(name=>name!=='图片链接');
  assert.throws(
    ()=>parseYingdaoRows({ temuGoodsId:'601',sourceExportFile:'601.xlsx',headers,rows:[],importedAt:'now' }),
    error=>error?.code==='MALFORMED_XLSX_HEADERS' && error.message.includes('图片链接') && error.message.includes('601.xlsx'),
  );
});
