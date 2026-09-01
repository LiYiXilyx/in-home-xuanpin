export function parsePackQuantity(value) {
  const title=String(value??'').normalize('NFC');
  const patterns=[
    {re:/\b(pack|set)\s+of\s+(\d{1,4})\b/i,count:m=>num(m[2])},
    {re:/\b(\d{1,4})\s*[- ]?(?:pcs?|pieces?|count)\b/i,count:m=>num(m[1])},
    {re:/\b(\d{1,4})\s*[- ]?piece\s+set\b/i,count:m=>num(m[1])},
    {re:/\b(\d{1,4})\s+pack\b/i,count:m=>num(m[1])},
    {re:/\b(\d{1,4})\s+pairs?\b/i,count:m=>num(m[1])*2},
    {re:/\bpair\s+of\s+(\d{1,4})\b/i,count:m=>num(m[1])},
    {re:/(?:一|每)包\s*(\d{1,4})\s*[个只件套粒片]/u,count:m=>num(m[1])},
    {re:/(\d{1,4})\s*[个只件套粒片]\s*[\/]包/u,count:m=>num(m[1])},
    {re:/(\d{1,4})\s*[个只件套粒片]装/u,count:m=>num(m[1])},
  ];
  for(const {re,count} of patterns) {
    const match=title.match(re);
    if(!match) continue;
    const quantity=count(match);
    if(Number.isSafeInteger(quantity)&&quantity>0) return {
      pack_quantity:quantity,quantity_source:'TITLE_EXPLICIT_PACK',quantity_confidence:'HIGH',
      normalization_status:'NORMALIZED',evidence:match[0],
    };
  }
  return {pack_quantity:1,quantity_source:'ASSUMED_SINGLE',quantity_confidence:'LOW',normalization_status:'ASSUMED',evidence:null};
}

export function normalizeUnitPrice({listedPrice,currency,title,priceBasis='LISTED_SINGLE_VALUE'}={}) {
  const quantity=parsePackQuantity(title);
  const price=positiveNumber(listedPrice);
  return {
    listed_price:price,currency:currency??null,pack_quantity:quantity.pack_quantity,
    unit_price:price===null?null:round(price/quantity.pack_quantity,6),
    quantity_source:quantity.quantity_source,quantity_confidence:quantity.quantity_confidence,
    price_basis:priceBasis,normalization_status:quantity.normalization_status,evidence:quantity.evidence,
  };
}

function num(value) { return Number(value); }
function positiveNumber(value) { if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)&&n>0?n:null; }
function round(value,digits) { const factor=10**digits;return Math.round((value+Number.EPSILON)*factor)/factor; }
