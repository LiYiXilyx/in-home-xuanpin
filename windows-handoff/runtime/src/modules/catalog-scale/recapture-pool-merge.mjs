import {createHash} from 'node:crypto';
import {transaction} from '../../db/client.mjs';
import {createId} from '../../shared/ids.mjs';
import {AppError} from '../../shared/errors.mjs';
import {screenManualCatalogElectricalRisk} from './electronic-screening.mjs';
export function createRecapturePoolMerge({db,repository,now,activityRegistry}){
 db.exec(`CREATE TABLE IF NOT EXISTS catalog_recapture_pool_merges(request_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,revision TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL)`);
 const fail=message=>{throw new AppError(message,{code:'RECAPTURE_POOL_MERGE_INVALID'});};
 function model(campaignId){
  const c=repository.getCampaign(campaignId);if(!c?.config?.trackingRecapture)fail('请选择已有商品复采任务。');
  const pools=db.prepare("SELECT * FROM catalog_pool_versions WHERE category_key=? AND status='active'").all(c.categoryKey);if(pools.length!==1)fail('正式商品池不唯一，请先检查数据。');
  const pool=pools[0];if(pool.category_profile_version!==c.categoryProfileVersion)fail('类目配置版本不一致，不能合并。');
  const base=db.prepare('SELECT s.* FROM catalog_pool_version_items i JOIN catalog_staging_products s ON s.id=i.staging_product_id WHERE i.pool_version_id=? ORDER BY i.goods_id').all(pool.id);
  if(base.length!==pool.product_count)fail('正式池数据不完整。');
  const captured=db.prepare("SELECT * FROM catalog_staging_products WHERE campaign_id=? ORDER BY goods_id").all(c.id);
  const rows=new Map(base.map(r=>[r.platform+':'+r.goods_id,r]));if(rows.size!==base.length)fail('正式池存在重复商品。');
  let added=0,updated=0,excluded=0;
  for(const r of captured){if(r.category_key!==c.categoryKey)fail('采集数据类目不一致。');if(r.electronic_screening_status!=='passed'||screenManualCatalogElectricalRisk({title:r.latest_title}).decision!=='passed'){excluded++;continue;}
   const key=r.platform+':'+r.goods_id,old=rows.get(key);if(!old){added++;rows.set(key,r);}else if(Date.parse(r.last_seen_at)>Date.parse(old.last_seen_at)){updated++;rows.set(key,r);}
  }
  const merged=[...rows.values()];const revision=createHash('sha256').update(JSON.stringify({pool:pool.id,campaign:c.id,base,captured})).digest('hex');
  return {c,pool,rows:merged,summary:{campaignId:c.id,campaignName:c.name,category:c.categoryKey,previousPoolId:pool.id,previousCount:base.length,capturedCount:captured.length,added,updated,excluded,total:merged.length,revision}};
 }
 function preview(id){return model(id).summary;}
 function merge(input){return transaction(db,()=>{
  if(typeof input.requestId!=='string'||!input.requestId.trim())fail('缺少合并请求标识。');
  const prior=db.prepare('SELECT * FROM catalog_recapture_pool_merges WHERE request_id=?').get(input.requestId);if(prior){if(prior.campaign_id!==input.campaignId||prior.revision!==input.revision)fail('重复请求参数不一致。');return {...JSON.parse(prior.result_json),idempotentReplay:true};}
  const m=model(input.campaignId);if(input.revision!==m.summary.revision)fail('采集数据或正式池已有更新，请重新预览后合并。');
  if(!m.summary.added&&!m.summary.updated)return {...m.summary,poolId:m.pool.id,unchanged:true};
  if(!activityRegistry)fail('无法核验采集活动。');
  for(const q of repository.listRpaQueues(m.c.id)){const a=activityRegistry.snapshot({campaignId:m.c.id,queueId:q.id});if(Object.entries(a).some(([k,v])=>k!=='liveBinding'&&v))fail('正在采集或导出，请完成后再合并。');}
  const at=now();let frozen=repository.createCampaign({name:`${m.c.categoryKey} 正式池合并 ${createId('merge')}`,campaignType:'refresh',categoryKey:m.c.categoryKey,categoryProfileVersion:m.c.categoryProfileVersion,targetGate:m.c.targetGate,targetCount:m.rows.length,baselinePoolCount:m.pool.product_count,status:'running',config:{categoryProfile:m.c.config.categoryProfile,recaptureMerge:{sourceCampaignId:m.c.id,previousPoolId:m.pool.id,revision:input.revision}}});
  const source=repository.createSource(frozen,{sourceKey:'saved-recapture-merge',sourceType:'category',sortOrder:m.c.config.categoryProfile.sort_order,priority:1,targetQuota:m.rows.length,navigationHint:{entryMethod:'saved_data_only'}});
  const cols=db.prepare('PRAGMA table_info(catalog_staging_products)').all().map(x=>x.name).filter(x=>x!=='id');const insert=db.prepare(`INSERT INTO catalog_staging_products(${cols.map(x=>'"'+x+'"').join(',')}) VALUES(${cols.map(()=>'?').join(',')})`);
  for(const [i,r] of m.rows.entries()){const copy={...r,campaign_id:frozen.id,first_source_id:source.id,latest_source_id:source.id,first_seen_sequence:i+1};insert.run(...cols.map(k=>copy[k]??null));}
  frozen=repository.refreshCampaignCounts(frozen.id);if(frozen.nonElectronicUniqueCount!==m.rows.length)fail('合并数量校验失败。');
  repository.materializeRefresh(frozen);
  const pool=repository.activatePoolVersion(frozen,{kind:'recapture_union',...m.summary});if(pool.productCount!==m.rows.length)fail('正式池数量校验失败。');
  repository.transitionSource(source.id,'completed');const queue=repository.getRpaQueueForSource(source.id);if(queue)repository.transitionRpaQueue(queue.id,'completed');repository.transitionCampaign(frozen.id,'completed');
  const result={...m.summary,poolId:pool.id,mergeCampaignId:frozen.id,createdAt:at};db.prepare('INSERT INTO catalog_recapture_pool_merges VALUES(?,?,?,?,?)').run(input.requestId,m.c.id,input.revision,JSON.stringify(result),at);return result;
 });}
 return {preview,merge};
}
