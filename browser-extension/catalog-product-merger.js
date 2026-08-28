'use strict';

(() => {
  const NETWORK_FIELDS=['title','image_url','price_amount','sales_count','rating','review_count'];
  function mergeDomNetwork(dom,record){if(!dom)return null;const network=record?.latestProduct;if(!network)return withTransport(dom,'DOM');if(String(dom.goods_id)!==String(network.goods_id))return withTransport(dom,'DOM');const merged={...dom},provenance={goods_id:'identity',source_url:'dom',canonical_url:'identity'};let enriched=false;
    for(const field of NETWORK_FIELDS){if(valid(field,network[field])){merged[field]=network[field];provenance[field]='network';enriched=true;}else provenance[field]=valid(field,dom[field])?'dom':'missing';}
    merged.field_provenance=provenance;merged.capture_transport=enriched?'NETWORK_ENRICHED':'DOM';merged.raw_network=enriched?network.raw_network??null:null;return merged;}
  function withTransport(dom,transport){const provenance={goods_id:'identity',source_url:'dom',canonical_url:'identity'};for(const field of NETWORK_FIELDS)provenance[field]=valid(field,dom[field])?'dom':'missing';return {...dom,field_provenance:provenance,capture_transport:transport};}
  function valid(field,value){if(value===null||value===undefined||value==='')return false;if(['price_amount','sales_count','review_count'].includes(field))return Number.isFinite(Number(value))&&Number(value)>=0;if(field==='rating')return Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=5;return typeof value==='string'&&Boolean(value.trim());}
  globalThis.TemuCatalogProductMerger=Object.freeze({mergeDomNetwork,valid});
})();
