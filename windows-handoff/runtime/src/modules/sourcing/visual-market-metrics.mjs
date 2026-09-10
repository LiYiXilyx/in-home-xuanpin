import {normalizeUnitPrice} from './unit-price-normalizer.mjs';

export function calculateVisualMarketMetrics({anchor,matches=[]}={}) {
  const normalizedAnchor=normalize(anchor??{}),anchorId=String(normalizedAnchor.goods_id??'');
  const seen=new Set(),otherRows=[];
  for(const raw of matches) {
    const row=normalize(raw??{}),id=String(row.goods_id??'');
    if(id&&id===anchorId) continue;
    const key=id||`anonymous-${otherRows.length}`;
    if(seen.has(key)) continue;
    seen.add(key);otherRows.push(row);
  }
  const validListed=otherRows.filter(row=>positive(row.price_eur)!==null),anchorListed=positive(normalizedAnchor.price_eur);
  const allListed=[...(anchorListed===null?[]:[{goods_id:anchorId,value:anchorListed}]),...validListed.map(row=>({goods_id:String(row.goods_id),value:positive(row.price_eur)}))];
  const otherListed=validListed.map(row=>({goods_id:String(row.goods_id),value:positive(row.price_eur)}));
  const reliable=otherRows.filter(row=>row.unit_price_eur!==null&&['HIGH','MEDIUM'].includes(row.quantity_confidence)&&row.normalization_status!=='ASSUMED'&&row.metadata_consistency!=='CONFLICT');
  const provisional=otherRows.filter(row=>row.unit_price_eur!==null&&row.quantity_confidence==='LOW'&&row.quantity_source==='ASSUMED_SINGLE'&&row.normalization_status==='ASSUMED');
  const reliableValues=reliable.map(row=>row.unit_price_eur).sort(numeric),provisionalValues=provisional.map(row=>row.unit_price_eur).sort(numeric);
  const conflictCount=otherRows.filter(row=>row.metadata_consistency==='CONFLICT').length,reasons=[];
  if(validListed.length===0) reasons.push('NO_VALID_EUR_LISTED_PRICE');
  if(reliable.length===0) reasons.push('NO_RELIABLE_UNIT_PRICE');
  if(provisional.length>0) reasons.push('PROVISIONAL_ASSUMED_SINGLE');
  if(conflictCount>0) reasons.push('METADATA_CONFLICT_PRESENT');
  const otherMin=minEntry(otherListed),allMin=minEntry(allListed);
  return {
    anchor_listed_price_eur:anchorListed,anchor_unit_price_eur:normalizedAnchor.unit_price_eur,
    visual_match_count:otherRows.length,listed_price_sample_count:allListed.length,other_listed_price_sample_count:otherListed.length,
    min_listed_price_eur:allMin?.value??null,visual_min_listed_price_eur:allMin?.value??null,visual_min_listed_goods_id:allMin?.goods_id??null,
    min_other_listed_price_eur:otherMin?.value??null,other_min_listed_price_eur:otherMin?.value??null,visual_other_min_listed_price_eur:otherMin?.value??null,visual_other_min_listed_goods_id:otherMin?.goods_id??null,
    median_listed_price_eur:median(allListed.map(row=>row.value)),visual_median_listed_price_eur:median(allListed.map(row=>row.value)),other_median_listed_price_eur:median(otherListed.map(row=>row.value)),visual_other_median_listed_price_eur:median(otherListed.map(row=>row.value)),
    reliable_unit_price_sample_count:reliable.length,reliable_unit_price_count:reliable.length,min_reliable_unit_price_eur:reliableValues[0]??null,visual_min_reliable_unit_price_eur:reliableValues[0]??null,median_reliable_unit_price_eur:median(reliableValues),visual_median_reliable_unit_price_eur:median(reliableValues),visual_min_reliable_unit_goods_id:minUnitGoods(reliable),
    provisional_unit_price_sample_count:provisional.length,min_provisional_unit_price_eur:provisionalValues[0]??null,median_provisional_unit_price_eur:median(provisionalValues),visual_min_provisional_unit_price_eur:provisionalValues[0]??null,visual_median_provisional_unit_price_eur:median(provisionalValues),visual_min_provisional_unit_goods_id:minUnitGoods(provisional),
    metadata_conflict_count:conflictCount,listed_price_metadata_conflict_count:validListed.filter(row=>row.metadata_consistency==='CONFLICT').length,listed_price_clean_sample_count:validListed.filter(row=>row.metadata_consistency!=='CONFLICT').length,listed_price_includes_conflicts:validListed.some(row=>row.metadata_consistency==='CONFLICT'),
    matched_price_count:otherListed.length,metric_status:validListed.length?'AVAILABLE':'NO_USABLE_PRICE',metric_reasons:reasons,normalized_anchor:normalizedAnchor,normalized_matches:otherRows,
  };
}

function normalize(item) {const {image_bytes,...metadata}=item;const unit=normalizeUnitPrice({listedPrice:item.price_eur,currency:'EUR',title:item.title});return {...metadata,pack_quantity:unit.pack_quantity,unit_price_eur:unit.unit_price,quantity_confidence:unit.quantity_confidence,quantity_source:unit.quantity_source,normalization_status:unit.normalization_status};}
function positive(value){if(value===null||value===undefined||String(value).trim()==='')return null;const number=Number(value);return Number.isFinite(number)&&number>0?number:null;}
function numeric(a,b){return a-b;}
function median(values){const sorted=values.filter(value=>positive(value)!==null).map(Number).sort(numeric);if(!sorted.length)return null;const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;}
function minEntry(rows){return rows.length?[...rows].sort((a,b)=>a.value-b.value||Buffer.compare(Buffer.from(a.goods_id),Buffer.from(b.goods_id)))[0]:null;}
function minUnitGoods(rows){return rows.length?[...rows].sort((a,b)=>a.unit_price_eur-b.unit_price_eur||Buffer.compare(Buffer.from(String(a.goods_id)),Buffer.from(String(b.goods_id))))[0].goods_id:null;}
