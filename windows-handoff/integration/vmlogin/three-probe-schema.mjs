export function validateThreeProbe(input){
 if(!input||input.kind!=='visible_dom_three'||input.page_origin!=='https://www.temu.com'||!Array.isArray(input.items)||input.items.length<1||input.items.length>3)throw new Error('只接受当前页 1–3 个商品字段。');
 if(Object.keys(input).some(k=>!['ok','kind','page_origin','items'].includes(k)))throw new Error('禁止提交额外页面数据。');
 const ids=new Set();const items=input.items.map(row=>{
  if(!row||Object.keys(row).some(k=>!['goods_id','price_amount','currency','price_status','price_candidates'].includes(k)))throw new Error('仅接受商品ID、价格与币种字段。');
  if(!/^\d{5,20}$/.test(row.goods_id||'')||ids.has(row.goods_id))throw new Error('商品 ID 无效或重复。');ids.add(row.goods_id);
  const validCurrency=v=>v===null||['EUR','USD','GBP'].includes(v);const validAmount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000000;
  if(!['READY','AMBIGUOUS','MISSING'].includes(row.price_status)||!validCurrency(row.currency)||!Array.isArray(row.price_candidates)||row.price_candidates.length>4)throw new Error('价格字段无效。');
  const candidates=row.price_candidates.map(x=>{if(!x||Object.keys(x).some(k=>!['amount','currency'].includes(k))||!validAmount(x.amount)||!validCurrency(x.currency))throw new Error('候选价格无效。');return {amount:x.amount,currency:x.currency};});
  if(row.price_status==='READY'){
   if(!validAmount(row.price_amount)||!row.currency||candidates.length!==1||candidates[0].amount!==row.price_amount||candidates[0].currency!==row.currency)throw new Error('明确价格与候选不一致。');
  }else if(row.price_amount!==null||row.currency!==null)throw new Error('不确定价格不得自动确定金额或币种。');
  if(row.price_status==='MISSING'&&candidates.length)throw new Error('缺失状态不得携带候选。');
  return {goods_id:row.goods_id,price_amount:row.price_amount,currency:row.currency,price_status:row.price_status,price_candidates:candidates};
 });
 return {kind:'visible_dom_three',page_origin:'https://www.temu.com',items};
}
