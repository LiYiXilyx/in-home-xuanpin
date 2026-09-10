export function purgeReviewRun(db,runId){
 if(typeof runId!=='string'||!runId)throw Error('请选择批次');
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!db.prepare('SELECT 1 FROM sourcing_review_recycle WHERE run_id=?').get(runId))throw Error('只能彻底删除回收站内的批次');
  const run=db.prepare('SELECT import_status FROM sourcing_runs WHERE run_id=?').get(runId);
  if(!run||!['COMPLETED','COMPLETED_WITH_WARNINGS'].includes(run.import_status))throw Error('批次尚未完成，不能删除');
  db.prepare('DELETE FROM temu_market_evidence_requests WHERE session_id IN (SELECT session_id FROM temu_market_evidence_sessions WHERE review_run_id=?)').run(runId);
  for(const table of ['temu_manual_price_assessments','temu_market_evidence_phases','temu_market_evidence_sessions'])db.prepare('DELETE FROM '+table+' WHERE review_run_id=?').run(runId);
  for(const table of ['supplier_matches','sourcing_goods_reviews','supplier_match_candidates','sourcing_run_files','sourcing_run_items','fx_rates','sourcing_pool_batches','sourcing_review_recycle','sourcing_runs'])db.prepare('DELETE FROM '+table+' WHERE run_id=?').run(runId);
  db.exec('COMMIT');return {ok:true,runId};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
