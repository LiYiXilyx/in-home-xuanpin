import crypto from 'node:crypto';

export const SAMPLE_METHOD='SHA256_STABLE_ORDER_V1';

export function sampleStableRandom5(temuGoodsId,candidates) {
  const seed=String(temuGoodsId);
  const byProductId=new Map();

  for(const sourceCandidate of candidates) {
    const productId=String(sourceCandidate?.['1688_product_id']??'').trim();
    if(productId==='') continue;
    const candidate={ ...sourceCandidate,'1688_product_id':productId };
    const existing=byProductId.get(productId);
    if(!existing || compareDedupCandidate(candidate,existing)<0) byProductId.set(productId,candidate);
  }

  return [...byProductId.values()]
    .map(candidate=>({
      candidate,
      digest:crypto.createHash('sha256')
        .update(`${seed}\0${candidate['1688_product_id']}\0${candidate.original_rank}`,'utf8')
        .digest(),
    }))
    .sort(compareScoredCandidate)
    .slice(0,5)
    .map(({ candidate },index)=>({
      ...candidate,
      random_sample_rank:index+1,
      sample_seed:seed,
      sample_method:SAMPLE_METHOD,
      selected_candidate:null,
    }));
}

function compareDedupCandidate(left,right) {
  const rankDifference=Number(left.original_rank)-Number(right.original_rank);
  if(rankDifference!==0) return rankDifference;
  return compareUtf8(stableCandidateKey(left),stableCandidateKey(right));
}

function compareScoredCandidate(left,right) {
  const digestOrder=Buffer.compare(left.digest,right.digest);
  if(digestOrder!==0) return digestOrder;
  const productOrder=compareUtf8(left.candidate['1688_product_id'],right.candidate['1688_product_id']);
  if(productOrder!==0) return productOrder;
  return Number(left.candidate.original_rank)-Number(right.candidate.original_rank);
}

function stableCandidateKey(candidate) {
  return JSON.stringify(Object.keys(candidate).sort().map(key=>[key,candidate[key]]));
}

function compareUtf8(left,right) {
  return Buffer.compare(Buffer.from(String(left),'utf8'),Buffer.from(String(right),'utf8'));
}
