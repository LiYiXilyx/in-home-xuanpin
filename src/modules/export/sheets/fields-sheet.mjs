import { applyBody,applyHeader,columnLetter } from '../workbook.mjs';

export const FIELD_HEADERS=['字段名称','MUST / SHOULD / OPTIONAL','来源','数据类型','缺失口径','是否人工字段','说明'];
export const FIELD_ROWS=[
  ['序号','MUST','导出层','INTEGER','不缺失','否','当前工作表显示顺序，不作为商品身份'],
  ['商品主图','SHOULD','product_images completed 本地缓存','IMAGE','无有效本地缓存则空白','否','仅嵌入本地缓存；不请求 CDN'],
  ['Top Sales rank','MUST','catalog_memberships.current_rank','INTEGER','空白；不得补 0','否','当前 active 商品池排名'],
  ['goods_id','MUST','products.external_product_id','TEXT','不允许缺失','否','商品稳定身份；人工字段优先匹配键'],
  ['商品标题','MUST','最新 product_snapshots.title','TEXT','空白','否','抓取时展示标题'],
  ['Temu链接','MUST','products.source_url；缺失时 products.canonical_url','HYPERLINK URL','不允许缺失','否','显示完整 URL 文本；单元格可点击，目标与显示 URL 一致'],
  ['一级类目','MUST','catalog_memberships.primary_category','TEXT','空白','否','当前 active membership'],
  ['子类目','MUST','catalog_memberships.subcategory','TEXT','空白','否','当前 active membership'],
  ['价格','MUST','product_snapshots.price_amount','DECIMAL','空白；不得补 0','否','当前 job 快照价格'],
  ['原价','SHOULD','product_snapshots.original_price_amount','DECIMAL','空白','否','页面未展示时为空'],
  ['折扣','SHOULD','product_snapshots.discount_percent','PERCENT','空白','否','页面未展示时为空'],
  ['销量','SHOULD','product_snapshots.sales_count','INTEGER','空白；不得补 0','否','页面展示销量'],
  ['评分','SHOULD','product_snapshots.rating','DECIMAL','空白；不得补 0','否','范围 0–5'],
  ['评论数','SHOULD','product_snapshots.review_count','INTEGER','空白；不得补 0','否','页面展示评论数'],
  ['商品状态','MUST','products.status','TEXT','unknown','否','稳定商品状态'],
  ['抓取时间','MUST','product_snapshots.captured_at','DATETIME','空白','否','当前 job 快照时间'],
  ['数据完整度','MUST','Excel 公式','PERCENT','按实际非空字段计算','否','rank、goods_id、标题、链接、价格、销量、评分、评论数共 8 项'],
  ['初步分类','OPTIONAL','product_classifications / 旧 Excel','TEXT','待分类','是','重新导出按 goods_id 优先保护'],
  ['人工备注','OPTIONAL','旧 Excel','TEXT','空白','是','重新导出按 goods_id 优先、canonical_url fallback 保护']
];

export function buildFieldsSheet(sheet) {
  sheet.getRange('A1:G1').values=[FIELD_HEADERS];
  applyHeader(sheet.getRange('A1:G1'));
  const last=FIELD_ROWS.length+1;
  sheet.getRange(`A2:G${last}`).values=FIELD_ROWS;
  applyBody(sheet.getRange(`A2:G${last}`));
  sheet.getRange(`A2:G${last}`).format.wrapText=true;
  const table=sheet.tables.add(`A1:G${last}`,true,'TemuFieldDefinitions');
  table.style='TableStyleMedium2';table.showFilterButton=true;
  [24,24,42,16,30,16,54].forEach((width,index) => { sheet.getRange(`${columnLetter(index+1)}:${columnLetter(index+1)}`).format.columnWidth=width; });
  sheet.freezePanes.freezeRows(1);
}
