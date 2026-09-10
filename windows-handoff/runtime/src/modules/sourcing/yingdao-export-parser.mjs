export const REQUIRED_YINGDAO_HEADERS=Object.freeze([
  '标题',
  '产品ID',
  '产品链接',
  '图片链接',
  '价格',
  '是否包邮',
  '销售额',
  '起批量',
  '起批量运费',
  '月销件数',
  '累计销售件数',
  '复购率',
  '48h发货率',
  '最早上架时间',
  '最新更新时间',
  '店铺名称',
  '店铺资质',
]);

export function parseNullableText(value) {
  if(value===null || value===undefined) return null;
  const text=String(value).trim();
  return text==='' || text==='-'?null:text;
}

export function parseSingleRmb(value) {
  if(typeof value==='number') return Number.isFinite(value) && value>=0?value:null;
  const text=parseNullableText(value);
  if(text===null) return null;
  const match=text.match(/^(?:RMB\s*|[¥￥]\s*)?([0-9]+(?:\.[0-9]+)?)$/i);
  if(!match) return null;
  const amount=Number(match[1]);
  return Number.isFinite(amount)?amount:null;
}

export function parseNonNegativeInteger(value) {
  if(typeof value==='number') return Number.isSafeInteger(value) && value>=0?value:null;
  const text=parseNullableText(value);
  if(text===null || !/^[0-9]+$/.test(text)) return null;
  const integer=Number(text);
  return Number.isSafeInteger(integer)?integer:null;
}

export function parsePercent(value) {
  const text=parseNullableText(value);
  if(text===null) return null;
  const match=text.match(/^([0-9]+(?:\.[0-9]+)?)%$/);
  if(!match) return null;
  const percent=Number(match[1]);
  return Number.isFinite(percent) && percent>=0 && percent<=100?percent/100:null;
}

export function parseYingdaoRows({ temuGoodsId,sourceExportFile,headers,rows,importedAt }) {
  const index=new Map();
  for(let column=0;column<headers.length;column+=1) {
    const name=String(headers[column]??'').trim();
    if(name!=='' && !index.has(name)) index.set(name,column);
  }
  for(const name of REQUIRED_YINGDAO_HEADERS) {
    if(!index.has(name)) throw sourceError('MALFORMED_XLSX_HEADERS',sourceExportFile,`missing header: ${name}`);
  }

  const value=(row,name)=>row[index.get(name)];
  const candidates=[];
  for(let rowIndex=0;rowIndex<rows.length;rowIndex+=1) {
    const row=rows[rowIndex]??[];
    if(!row.some(cell=>parseNullableText(cell)!==null)) continue;
    candidates.push({
      temu_goods_id:String(temuGoodsId),
      original_rank:rowIndex+1,
      '1688_product_id':parseNullableText(value(row,'产品ID')),
      '1688_title':parseNullableText(value(row,'标题')),
      '1688_product_url':parseNullableText(value(row,'产品链接')),
      '1688_image_url':parseNullableText(value(row,'图片链接')),
      price_raw:parseNullableText(value(row,'价格')),
      price_rmb:parseSingleRmb(value(row,'价格')),
      shipping_text:parseNullableText(value(row,'是否包邮')),
      sales_amount_raw:parseNullableText(value(row,'销售额')),
      moq:parseNonNegativeInteger(value(row,'起批量')),
      moq_shipping_raw:parseNullableText(value(row,'起批量运费')),
      monthly_sales:parseNonNegativeInteger(value(row,'月销件数')),
      cumulative_sales:parseNonNegativeInteger(value(row,'累计销售件数')),
      repurchase_rate:parsePercent(value(row,'复购率')),
      shipping_48h_rate:parsePercent(value(row,'48h发货率')),
      first_listed_at:parseNullableText(value(row,'最早上架时间')),
      updated_at:parseNullableText(value(row,'最新更新时间')),
      shop_name:parseNullableText(value(row,'店铺名称')),
      shop_qualification:parseNullableText(value(row,'店铺资质')),
      source_export_file:sourceExportFile,
      imported_at:importedAt,
    });
  }
  return candidates;
}

function sourceError(code,sourceExportFile,detail) {
  const error=new Error(`${code}: ${sourceExportFile}: ${detail}`);
  error.code=code;
  error.sourceExportFile=sourceExportFile;
  return error;
}
