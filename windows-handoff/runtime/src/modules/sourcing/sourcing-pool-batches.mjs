export function createPoolBatches(sourceDb,sourcingDb){
 sourcingDb.exec('CREATE TABLE IF NOT EXISTS sourcing_pool_batches(run_id TEXT PRIMARY KEY,pool_id TEXT NOT NULL,category_key TEXT NOT NULL,pool_created_at TEXT,pool_count INTEGER NOT NULL,batch_name TEXT NOT NULL,created_at TEXT NOT NULL)');
 function pools(){return sourceDb.prepare("SELECT id,category_key,product_count,activated_at,status FROM catalog_pool_versions WHERE status IN ('active','superseded') ORDER BY category_key,activated_at DESC,id").all();}
 function resolve(poolId){const pool=pools().find(p=>p.id===poolId);if(!pool)throw Object.assign(Error('请选择有效的正式商品池版本。'),{code:'SOURCING_POOL_REQUIRED'});return {...pool,goodsIds:sourceDb.prepare('SELECT goods_id FROM catalog_pool_version_items WHERE pool_version_id=?').all(poolId).map(r=>String(r.goods_id))};}
 function save(runId,pool,name){const now=new Date().toISOString();sourcingDb.prepare('INSERT INTO sourcing_pool_batches VALUES(?,?,?,?,?,?,?)').run(runId,pool.id,pool.category_key,pool.activated_at,pool.product_count,String(name??'').trim().slice(0,100)||pool.category_key+' · '+pool.product_count+'件池 · '+now,pool?now:now);}
 function get(runId){return sourcingDb.prepare('SELECT * FROM sourcing_pool_batches WHERE run_id=?').get(runId)??null;}
 return {pools,resolve,save,get};
}
