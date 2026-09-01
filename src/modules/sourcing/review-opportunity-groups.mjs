const INVALID=new Set(['','-','—','未知','其它','其他','待细分','其它/待细分','其他/待细分','未可靠分组','fallback','other','unknown']);

export function resolveOpportunityGroup(item) {
  const goodsId=String(item.temu_goods_id);
  const cluster=clean(item.similar_cluster);
  if(reliable(cluster)) return {group_key:`CLUSTER:${key(cluster)}`,group_label:cluster,group_source:'SIMILAR_CLUSTER',group_confidence:'HIGH'};
  const levels=[clean(item.level1),clean(item.level2),clean(item.level3)];
  if(levels.every(reliable)) return {
    group_key:`TAXONOMY:${levels.map(key).join('|')}`,group_label:levels[2],
    group_source:'TAXONOMY_PATH',group_confidence:'MEDIUM',
  };
  return {group_key:`GOODS:${goodsId}`,group_label:'未可靠分组',group_source:'SELF',group_confidence:'LOW'};
}

export function buildOpportunityGroups(items) {
  const grouped=new Map(),itemByGoodsId=new Map();
  for(const raw of [...items].sort((a,b)=>compareUtf8(String(a.temu_goods_id),String(b.temu_goods_id)))) {
    const group=resolveOpportunityGroup(raw),item={...raw,...group};itemByGoodsId.set(String(item.temu_goods_id),item);
    const list=grouped.get(group.group_key)??[];list.push(item);grouped.set(group.group_key,list);
  }
  const groupsByKey=new Map();
  for(const groupKey of [...grouped.keys()].sort(compareUtf8)) {
    const rows=grouped.get(groupKey),head=rows[0];
    groupsByKey.set(groupKey,{group_key:groupKey,group_label:head.group_label,group_source:head.group_source,
      group_confidence:head.group_confidence,metrics:metrics(rows),items:rows});
  }
  return {groupsByKey,itemByGoodsId};
}

export function sortGroupItems(items,{sort='DEFAULT',currentGoodsId=null}={}) {
  const rows=[...items],id=(x)=>String(x.temu_goods_id);
  if(sort==='GOODS_ID') return rows.sort((a,b)=>compareUtf8(id(a),id(b)));
  if(sort==='LISTED_PRICE') return rows.sort((a,b)=>nullable(a.temu_listed_price_eur,b.temu_listed_price_eur)||compareUtf8(id(a),id(b)));
  if(sort==='UNIT_PRICE') return rows.sort((a,b)=>nullable(a.temu_unit_price_eur,b.temu_unit_price_eur)||compareUtf8(id(a),id(b)));
  return rows.sort((a,b)=>(id(a)===String(currentGoodsId)?-1:0)-(id(b)===String(currentGoodsId)?-1:0)||
    nullableReliable(a,b)||compareUtf8(id(a),id(b)));
}

function metrics(rows) {
  const listed=rows.filter(x=>positive(x.temu_listed_price_eur)).sort(priceGoods('temu_listed_price_eur'));
  const reliableUnits=rows.filter(x=>['HIGH','MEDIUM'].includes(x.quantity_confidence)&&positive(x.temu_unit_price_eur)).sort(priceGoods('temu_unit_price_eur'));
  const values=reliableUnits.map(x=>Number(x.temu_unit_price_eur));
  return {
    group_item_count:rows.length,group_listed_price_count:listed.length,group_unit_price_count:reliableUnits.length,
    group_min_listed_price_eur:listed[0]?.temu_listed_price_eur??null,group_min_listed_goods_id:listed[0]?.temu_goods_id??null,
    group_min_unit_price_eur:reliableUnits[0]?.temu_unit_price_eur??null,group_min_unit_goods_id:reliableUnits[0]?.temu_goods_id??null,
    group_median_unit_price_eur:median(values),group_price_coverage:ratio(listed.length,rows.length),
    group_unit_price_coverage:ratio(reliableUnits.length,rows.length),includes_assumed_units:rows.some(x=>x.quantity_confidence==='LOW'&&positive(x.temu_unit_price_eur)),
  };
}

function reliable(value){return value!==null&&!INVALID.has(value.toLocaleLowerCase('en-US'));}
function clean(value){const text=String(value??'').normalize('NFC').trim().replace(/\s+/gu,' ');return text||null;}
function key(value){return value.toLocaleLowerCase('en-US');}
function positive(value){return Number.isFinite(Number(value))&&Number(value)>0;}
function priceGoods(field){return (a,b)=>Number(a[field])-Number(b[field])||compareUtf8(String(a.temu_goods_id),String(b.temu_goods_id));}
function median(values){if(!values.length)return null;const middle=Math.floor(values.length/2);return values.length%2?values[middle]:(values[middle-1]+values[middle])/2;}
function ratio(a,b){return b?Number((a/b).toFixed(6)):0;}
function nullable(a,b){const aa=positive(a)?Number(a):Infinity,bb=positive(b)?Number(b):Infinity;return aa-bb;}
function nullableReliable(a,b){const aa=['HIGH','MEDIUM'].includes(a.quantity_confidence)&&positive(a.temu_unit_price_eur)?Number(a.temu_unit_price_eur):Infinity;const bb=['HIGH','MEDIUM'].includes(b.quantity_confidence)&&positive(b.temu_unit_price_eur)?Number(b.temu_unit_price_eur):Infinity;return aa-bb;}
function compareUtf8(a,b){return Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));}
