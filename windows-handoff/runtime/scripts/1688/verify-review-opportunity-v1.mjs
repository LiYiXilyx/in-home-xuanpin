import path from 'node:path';import {pathToFileURL} from 'node:url';

export async function verifyReviewOpportunity({baseUrl='http://127.0.0.1:37821',runId,expectedGoods=50,expectedCandidates=250,fetchImpl=fetch}={}) {
  if(!runId) throw new TypeError('runId is required');
  const query=`run_id=${encodeURIComponent(runId)}`,bootstrap=await json(fetchImpl,`${baseUrl}/api/sourcing/review/bootstrap?${query}`);
  const details=[];for(const item of bootstrap.goods??[])details.push(await json(fetchImpl,`${baseUrl}/api/sourcing/review/goods/${encodeURIComponent(item.temu_goods_id)}?${query}`));
  let temuImages=0,supplierImages=0,imageErrors=0;
  for(const detail of details) {
    const temu=await fetchImpl(`${baseUrl}/api/sourcing/review/images/temu/${encodeURIComponent(detail.temu_goods_id)}?${query}`);if(temu.ok)temuImages++;else imageErrors++;
    for(const candidate of detail.candidates??[]) {const productId=candidate['1688_product_id']??candidate.supplier_product_id;const image=await fetchImpl(`${baseUrl}/api/sourcing/review/images/supplier/${encodeURIComponent(detail.temu_goods_id)}/${encodeURIComponent(productId)}?${query}`);if(image.ok&&image.headers.get('content-type')?.startsWith('image/jpeg'))supplierImages++;else imageErrors++;}
  }
  const candidates=details.flatMap(x=>x.candidates??[]),groups=new Map();for(const detail of details)groups.set(detail.group_context?.group_key,detail.group_context);
  const failures=[];if(details.length!==expectedGoods)failures.push('GOODS_COUNT_MISMATCH');if(candidates.length!==expectedCandidates)failures.push('CANDIDATE_COUNT_MISMATCH');if(temuImages!==details.length)failures.push('TEMU_IMAGE_FAILURE');if(supplierImages!==candidates.length)failures.push('SUPPLIER_IMAGE_FAILURE');
  const bands={};for(const candidate of candidates)bands[candidate.opportunity_band]=(bands[candidate.opportunity_band]??0)+1;
  const priceCount=details.filter(x=>finite(x.temu_context?.temu_listed_price_eur)).length,reliableCount=details.filter(x=>['HIGH','MEDIUM'].includes(x.temu_context?.quantity_confidence)&&finite(x.temu_context?.temu_unit_price_eur)).length;
  return {pass:failures.length===0,failures,TEMU_REVIEW_GOODS:details.length,SUPPLIER_REVIEW_CANDIDATES:candidates.length,
    TEMU_IMAGES_LOCAL_OK:`${temuImages}/${details.length}`,SUPPLIER_IMAGES_LOCAL_OK:`${supplierImages}/${candidates.length}`,IMAGE_MAPPING_ERRORS:imageErrors,
    TEMU_PRICE_COVERAGE:`${priceCount}/${details.length}`,TEMU_RELIABLE_UNIT_PRICE_COVERAGE:`${reliableCount}/${details.length}`,
    GROUP_COUNT:groups.size,MULTI_ITEM_GROUP_COUNT:[...groups.values()].filter(x=>x?.item_count>1).length,MAX_GROUP_SIZE:Math.max(0,...[...groups.values()].map(x=>Number(x?.item_count??0))),
    RATIO_COMPUTABLE_CANDIDATES:`${candidates.filter(x=>finite(x.opportunity_ratio)).length}/${candidates.length}`,
    HIGH_COUNT:bands.HIGH??0,MEDIUM_COUNT:bands.MEDIUM??0,LOW_COUNT:bands.LOW??0,REVIEW_REQUIRED_COUNT:bands.REVIEW_REQUIRED??0,
    UNIT_REVIEW_REQUIRED_COUNT:bands.UNIT_REVIEW_REQUIRED??0,FX_RATE_REQUIRED_COUNT:bands.FX_RATE_REQUIRED??0,
    PRICE_TIER_REVIEW_REQUIRED_COUNT:bands.PRICE_TIER_REVIEW_REQUIRED??0,GROUP_REVIEW_REQUIRED_COUNT:bands.GROUP_REVIEW_REQUIRED??0,TEMU_UNIT_PRICE_REQUIRED_COUNT:bands.TEMU_UNIT_PRICE_REQUIRED??0,
  };
}

async function json(fetchImpl,url){const response=await fetchImpl(url);if(!response.ok)throw new Error(`GET ${url} failed: ${response.status}`);return response.json();}
function finite(value){return Number.isFinite(Number(value));}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const runIndex=process.argv.indexOf('--run-id'),baseIndex=process.argv.indexOf('--base-url');const result=await verifyReviewOpportunity({runId:runIndex>=0?process.argv[runIndex+1]:null,baseUrl:baseIndex>=0?process.argv[baseIndex+1]:undefined});console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
}
