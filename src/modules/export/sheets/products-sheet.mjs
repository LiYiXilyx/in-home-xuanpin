import { applyBody,applyHeader,columnLetter,excelString } from '../workbook.mjs';
import { manualValuesForProduct } from '../manual-values.mjs';

export const PRODUCT_HEADERS=[
  '序号','商品主图','Top Sales rank','goods_id','商品标题','Temu链接','一级类目','子类目','价格','原价',
  '折扣','销量','评分','评论数','商品状态','抓取时间','数据完整度','初步分类','人工备注'
];

export function buildProductsSheet(sheet,products,{ manualState,imageDataByGoodsId }) {
  sheet.getRange(`A1:${columnLetter(PRODUCT_HEADERS.length)}1`).values=[PRODUCT_HEADERS];
  applyHeader(sheet.getRange(`A1:${columnLetter(PRODUCT_HEADERS.length)}1`));
  if (products.length === 0) return { imageCount:0,hyperlinkCount:0 };
  const rows=products.map((product,index) => {
    const manual=manualValuesForProduct(manualState,product);
    return [
      index+1,null,product.rank,product.goods_id,product.title,null,product.primary_category,product.subcategory,
      product.price_amount,product.original_price_amount,product.discount_percent,product.sales_count,product.rating,
      product.review_count,product.status,toDate(product.captured_at),null,
      manual['初步分类'] || product.classification || '待分类',manual['人工备注'] || ''
    ];
  });
  const lastRow=products.length+1;
  sheet.getRange(`A2:S${lastRow}`).values=rows;
  sheet.getRange(`F2:F${lastRow}`).formulas=products.map(product => [
    `=HYPERLINK("${excelString(product.product_url || product.source_url || product.canonical_url)}","${excelString(product.product_url || product.source_url || product.canonical_url)}")`
  ]);
  sheet.getRange(`Q2:Q${lastRow}`).formulas=products.map((_,index) => {
    const row=index+2;
    return [`=COUNTA(C${row}:F${row},I${row},L${row}:N${row})/8`];
  });
  applyBody(sheet.getRange(`A2:S${lastRow}`));
  sheet.getRange(`F2:F${lastRow}`).format.font={ color:'#0563C1',underline:true };
  sheet.getRange(`F2:F${lastRow}`).format.wrapText=true;
  sheet.getRange(`A2:A${lastRow}`).format.numberFormat='#,##0';
  sheet.getRange(`C2:C${lastRow}`).format.numberFormat='#,##0';
  sheet.getRange(`I2:J${lastRow}`).format.numberFormat='€#,##0.00';
  sheet.getRange(`K2:K${lastRow}`).format.numberFormat='0.0%';
  sheet.getRange(`L2:L${lastRow}`).format.numberFormat='#,##0';
  sheet.getRange(`M2:M${lastRow}`).format.numberFormat='0.0';
  sheet.getRange(`N2:N${lastRow}`).format.numberFormat='#,##0';
  sheet.getRange(`P2:P${lastRow}`).format.numberFormat='yyyy-mm-dd hh:mm';
  sheet.getRange(`Q2:Q${lastRow}`).format.numberFormat='0%';
  sheet.getRange(`E2:E${lastRow}`).format.wrapText=true;
  sheet.getRange(`R2:S${lastRow}`).format.wrapText=true;
  sheet.getRange(`A2:S${lastRow}`).format.rowHeight=72;
  const widths=[7,14,14,18,44,54,18,32,12,12,10,12,9,12,12,20,13,18,36];
  widths.forEach((width,index) => { sheet.getRange(`${columnLetter(index+1)}:${columnLetter(index+1)}`).format.columnWidth=width; });
  sheet.freezePanes.freezeRows(1);
  const table=sheet.tables.add(`A1:S${lastRow}`,true,'TemuOperationsProducts');
  table.style='TableStyleMedium2';
  table.showFilterButton=true;
  sheet.getRange(`Q2:Q${lastRow}`).conditionalFormats.add('cellIs',{
    operator:'lessThan',formula:1,format:{ fill:'#FFF2CC',font:{ color:'#7F6000',bold:true } }
  });
  let imageCount=0;
  products.forEach((product,index) => {
    const dataUrl=imageDataByGoodsId.get(String(product.goods_id));
    if (!dataUrl) return;
    sheet.images.add({ dataUrl,anchor:{ from:{ row:index+1,col:1,rowOffsetPx:4,colOffsetPx:4 },extent:{ widthPx:82,heightPx:64 } } });
    imageCount+=1;
  });
  return { imageCount,hyperlinkCount:products.length };
}

function toDate(value) {
  if (!value) return null;
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
