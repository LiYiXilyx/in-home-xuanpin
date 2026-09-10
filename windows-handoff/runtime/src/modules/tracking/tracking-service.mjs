import {sameDailyReading,compactObservations} from './tracking-observation-policy.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const DAY=86400000;
export function createTrackingService({sourceDb,databasePath,now=()=>Date.now()}){
 fs.mkdirSync(path.dirname(databasePath),{recursive:true});
 const db=new DatabaseSync(databasePath);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS tracking_plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,pool_id TEXT NOT NULL,category_key TEXT NOT NULL,started_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active');
 CREATE TABLE IF NOT EXISTS tracking_points(plan_id TEXT NOT NULL REFERENCES tracking_plans(id),goods_id TEXT NOT NULL,day INTEGER NOT NULL,data_json TEXT NOT NULL,observed_at TEXT NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(plan_id,goods_id,day));`);
 db.exec(`CREATE TABLE IF NOT EXISTS tracking_observations(plan_id TEXT NOT NULL REFERENCES tracking_plans(id),goods_id TEXT NOT NULL,event_key TEXT NOT NULL,data_json TEXT NOT NULL,observed_at TEXT NOT NULL,saved_at TEXT NOT NULL,PRIMARY KEY(plan_id,goods_id,event_key));CREATE INDEX IF NOT EXISTS tracking_observations_time ON tracking_observations(plan_id,goods_id,observed_at);`);
 const eventKey=r=>r.source_observation_id!=null?'raw:'+r.source_observation_id:'snapshot:'+createHash('sha256').update(JSON.stringify([r.last_seen_at,r.price_amount,r.currency,r.sales_count,r.review_count,r.rating,r.latest_title,r.image_url])).digest('hex');
 function saveObservation(id,r,key=eventKey(r)){if(key!=='baseline'){const prior=db.prepare('SELECT data_json,event_key FROM tracking_observations WHERE plan_id=? AND goods_id=? AND observed_at<=? AND event_key<>? ORDER BY observed_at DESC,event_key DESC LIMIT 1').get(id,r.goods_id,r.last_seen_at,key);if(prior&&sameDailyReading({...JSON.parse(prior.data_json),is_baseline:prior.event_key==='baseline'},r))return 0;}return Number(db.prepare('INSERT OR IGNORE INTO tracking_observations VALUES(?,?,?,?,?,?)').run(id,r.goods_id,key,JSON.stringify(r),r.last_seen_at,new Date(now()).toISOString()).changes);}
 // Preserve existing frozen baseline/period records while adding continuous history.
 for(const old of db.prepare('SELECT * FROM tracking_points ORDER BY day').all()){const r=JSON.parse(old.data_json);saveObservation(old.plan_id,r,old.day===0?'baseline':eventKey(r));}
 const history=id=>compactObservations(db.prepare('SELECT * FROM tracking_observations WHERE plan_id=? ORDER BY observed_at,event_key').all(id).map(r=>({...JSON.parse(r.data_json),observed_at:r.observed_at,event_key:r.event_key,is_baseline:r.event_key==='baseline'})));
 const hasObservations=Boolean(sourceDb.prepare("SELECT name FROM sqlite_master WHERE name='catalog_product_source_observations'").get());
 const pools=()=>sourceDb.prepare(`SELECT id,category_key,product_count,activated_at FROM catalog_pool_versions WHERE status='active' ORDER BY category_key`).all();
 const plans=()=>db.prepare('SELECT * FROM tracking_plans ORDER BY started_at DESC').all();
 const points=id=>db.prepare('SELECT * FROM tracking_points WHERE plan_id=? ORDER BY goods_id,day').all(id).map(r=>({...r,data:JSON.parse(r.data_json)}));
 function save(id,day,r){return db.prepare('INSERT OR IGNORE INTO tracking_points VALUES(?,?,?,?,?,?)').run(id,r.goods_id,day,JSON.stringify(r),r.last_seen_at,new Date(now()).toISOString()).changes;}
 function create({poolId,name}){
  const pool=pools().find(p=>p.id===poolId);if(!pool)throw Error('请选择有效的正式商品池');
  name=String(name||pool.category_key+' 周期跟踪').trim();if(!name||name.length>100)throw Error('计划名称限 1–100 字');
  const existing=plans().find(p=>p.pool_id===poolId&&p.status==='active');if(existing)return detail(existing.id);
  const rows=sourceDb.prepare(`SELECT s.* FROM catalog_pool_version_items i JOIN catalog_staging_products s ON s.id=i.staging_product_id WHERE i.pool_version_id=?`).all(poolId);
  if(!rows.length)throw Error('商品池没有可跟踪的商品');
  const id=randomUUID();db.exec('BEGIN IMMEDIATE');try{
   db.prepare('INSERT INTO tracking_plans(id,name,pool_id,category_key,started_at) VALUES(?,?,?,?,?)').run(id,name,poolId,pool.category_key,new Date(now()).toISOString());
   for(const r of rows){save(id,0,r);saveObservation(id,r,'baseline');}db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}return detail(id);
 }
 function sync(){let added=0;db.exec('BEGIN IMMEDIATE');try{
  for(const p of plans().filter(p=>p.status==='active')){
   const start=Date.parse(p.started_at),baselines=points(p.id).filter(r=>r.day===0);
   const basemap=new Map(baselines.map(b=>[b.data.platform+':'+b.goods_id,b]));
   let observations;
   if(hasObservations){
    observations=sourceDb.prepare(`SELECT o.* FROM catalog_product_source_observations o JOIN catalog_campaigns c ON c.id=o.campaign_id WHERE c.category_key=? AND o.observed_at>=? AND o.observed_at<? ORDER BY o.observed_at,o.id`).all(p.category_key,new Date(start).toISOString(),new Date(now()+1).toISOString()).map(o=>{
     let raw;try{raw=JSON.parse(o.raw_json);}catch{return null;}
     const number=(...keys)=>{for(const k of keys)if(Object.hasOwn(raw,k))return Number.isFinite(raw[k])?raw[k]:null;return null;};
     return {goods_id:o.goods_id,platform:o.platform,campaign_id:o.campaign_id,batch_id:o.batch_id,source_observation_id:o.id,last_seen_at:o.observed_at,latest_title:raw.title??null,image_url:raw.image_url??raw.imageUrl??null,canonical_url:raw.canonical_url??raw.href??raw.sourceUrl??null,currency:raw.currency??null,price_amount:number('price_amount','priceAmount'),sales_count:number('sales_count','salesCount'),review_count:number('review_count','reviewCount'),rating:number('rating'),raw_sales_text:raw.raw_sales_text??null};
    }).filter(Boolean);
   }else observations=sourceDb.prepare(`SELECT * FROM catalog_staging_products WHERE category_key=? ORDER BY last_seen_at,id`).all(p.category_key);
   for(const r of observations){const base=basemap.get(r.platform+':'+r.goods_id);if(!base)continue;const at=Date.parse(r.last_seen_at);
    if(!Number.isFinite(at)||at<start||at>now()||at<=Date.parse(base.observed_at))continue;
    added+=saveObservation(p.id,r);
    for(const day of [7,14,21])if(at>=start+day*DAY&&at<start+(day+7)*DAY)save(p.id,day,r);
   }
  }db.exec('COMMIT');return {added};
 }catch(e){db.exec('ROLLBACK');throw e;}}
 function detail(id){const p=plans().find(p=>p.id===id);if(!p)throw Error('跟踪计划不存在');
  const timeline=history(id);const all=points(id),base=all.filter(r=>r.day===0),periods=[7,14,21].map(day=>{
   const due=Date.parse(p.started_at)+day*DAY,end=due+7*DAY,count=all.filter(r=>r.day===day).length;
   return {day,due_at:new Date(due).toISOString(),end_at:new Date(end).toISOString(),count,total:base.length,status:count===base.length?'complete':now()<due?'scheduled':now()>=end?'missed':'due'};
  });
  return {...p,periods,products:base.map(b=>({goods_id:b.goods_id,title:b.data.latest_title,image_url:b.data.image_url,url:b.data.canonical_url,history:timeline.filter(r=>r.goods_id===b.goods_id).map((r,i,rows)=>({...r,changes:comparePoints(rows[i-1],r),changed:i>0&&['price_delta','sales_delta','review_delta','rating_delta'].some(k=>{const n=comparePoints(rows[i-1],r)[k];return n!==null&&n!==0;})})),points:all.filter(r=>r.goods_id===b.goods_id).map(r=>({day:r.day,observed_at:r.observed_at,...r.data}))}))};
 }
 function list(){return {pools:pools(),plans:plans().map(p=>{const d=detail(p.id);return {...p,product_count:d.products.length,periods:d.periods};}),mode:'continuous_capture_sync'};}
 function setStatus(id,status){if(!['active','paused'].includes(status))throw Error('状态无效');detail(id);db.prepare('UPDATE tracking_plans SET status=? WHERE id=?').run(status,id);return detail(id);}
 return {list,detail,create,sync,setStatus,close:()=>db.close()};
}
export function comparePoints(base,current){
 const delta=k=>Number.isFinite(base?.[k])&&Number.isFinite(current?.[k])?current[k]-base[k]:null;
 const same=base?.currency&&base.currency===current?.currency;
 const price=same?delta('price_amount'):null;
 return {price_delta:price,price_rate:price!==null&&base.price_amount>0?price/base.price_amount:null,sales_delta:delta('sales_count'),review_delta:delta('review_count'),rating_delta:delta('rating')};
}
