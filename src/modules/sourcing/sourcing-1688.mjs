import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const YINGDAO_INPUT_HEADERS=['任务序号','temu_goods_id','temu_title','temu_image_path','level1','level2','level3','similar_cluster','status'];
export const YINGDAO_OUTPUT_HEADERS=['run_id','temu_goods_id','temu_title','temu_image_path','candidate_rank','1688_product_id','1688_title','1688_price_raw','1688_price_min_rmb','1688_price_max_rmb','1688_moq','1688_shop_name','1688_product_url','1688_image_url','search_status','manual_review_required','captured_at','notes'];
export const SEARCH_STATUSES=new Set(['PENDING','SEARCH_SUCCESS','NO_RESULTS','MANUAL_CAPTURE_REQUIRED','WAITING_FOR_HUMAN']);

export function loadSourcingConfig(configPath='config/1688-sourcing-v1.json') {
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  const weights=config.similarityWeights??{};
  const total=Number(weights.image)+Number(weights.title)+Number(weights.category);
  if(Math.abs(total-1)>1e-9)throw new Error(`相似度权重必须合计为1，当前=${total}`);
  if(config.imageSimilarity?.implementationStatus!=='NOT_IMPLEMENTED')throw new Error('V1 图片相似度只能显式标记 NOT_IMPLEMENTED，禁止伪造分数。');
  if(config.fx?.pair!=='CNY/EUR'||!(Number(config.fx?.rate)>0))throw new Error('汇率配置无效。');
  if(config.fx?.source==='MANUAL_CONFIG'&&!/^\d{4}-\d{2}-\d{2}/.test(config.fx?.observedAt??''))throw new Error('人工汇率必须保存观察日期。');
  return config;
}

export function createRunId(now=new Date()) {
  const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  return `yingdao_1688_${stamp}_${crypto.randomBytes(3).toString('hex')}`;
}

export function resolveVerifiedTemuImagePath(goodsId,{ projectRoot=process.cwd() }={}) {
  const id=String(goodsId);
  const candidates=[
    ...['.avif','.webp','.jpg','.png'].map(ext=>path.join(projectRoot,'outputs','week1-mvp','image-cache',`${id}${ext}`)),
    path.join(projectRoot,'backups','day6-baseline-1500-20260827','.catalog-images',`${id}.jpg`),
  ];
  return candidates.find(candidate=>fs.existsSync(candidate))??null;
}

export function validateHttpUrl(value,{ platform=null,allowBlank=false }={}) {
  if(allowBlank&&!String(value??'').trim())return null;
  let parsed;
  try { parsed=new URL(String(value)); } catch { throw new Error(`URL格式无效：${value}`); }
  if(!['http:','https:'].includes(parsed.protocol))throw new Error(`URL协议无效：${value}`);
  if(platform==='1688'&&!(parsed.hostname==='1688.com'||parsed.hostname.endsWith('.1688.com')))throw new Error(`不是1688域名：${value}`);
  return parsed.href;
}

export function parseRmbPrice({ raw,min,max }) {
  const text=String(raw??'').trim();
  if(!text)throw new Error('1688_price_raw 不能为空。');
  if(!/(?:¥|￥|元|rmb|cny|\d)/i.test(text))throw new Error(`RMB价格格式无效：${text}`);
  const numbers=[...text.matchAll(/\d+(?:\.\d+)?/g)].map(match=>Number(match[0]));
  let low=numberOrNull(min),high=numberOrNull(max);
  if(low===null&&numbers.length)low=numbers[0];
  if(high===null&&numbers.length)high=numbers.length>1?numbers[1]:numbers[0];
  if(low===null||high===null||low<0||high<low)throw new Error(`RMB价格上下限无效：raw=${text}, min=${min}, max=${max}`);
  return { raw:text,min:round(low,4),max:round(high,4) };
}

export function derive1688ProductId(url) {
  const match=String(url??'').match(/\/offer\/(\d+)\.html/i);
  return match?.[1]??null;
}

export function scoreCandidate({temuTitle,supplierTitle,level1,level2,level3,similarCluster,weights}) {
  const titleSimilarity=jaccard(tokens(temuTitle),tokens(supplierTitle));
  const categoryText=[level1,level2,level3,similarCluster].filter(Boolean).join(' ');
  const categorySimilarity=jaccard(tokens(categoryText),tokens(supplierTitle));
  const imageSimilarity=null;
  const overallSimilarity=null;
  return {
    imageSimilarity,
    imageSimilarityStatus:'NOT_IMPLEMENTED',
    titleSimilarity:round(titleSimilarity,6),
    categorySimilarity:round(categorySimilarity,6),
    overallSimilarity,
    weights:{...weights},
    manualReviewRequired:true,
  };
}

export function assertExactHeaders(actual,expected,label) {
  if(actual.length!==expected.length||actual.some((value,index)=>String(value??'').trim()!==expected[index]))throw new Error(`${label}表头不符合约定顺序。`);
}

export function sha256File(filePath){return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');}

function tokens(value){return new Set(String(value??'').toLowerCase().replace(/^item picture\s+/,'').match(/[\p{L}\p{N}]+/gu)??[]);}
function jaccard(a,b){if(!a.size||!b.size)return 0;let common=0;for(const item of a)if(b.has(item))common++;return common/(a.size+b.size-common);}
function round(value,digits){const factor=10**digits;return Math.round((value+Number.EPSILON)*factor)/factor;}
function numberOrNull(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
