import { transaction } from '../client.mjs';

export function createSourcingRepository(db) {
  function insertImportedRun({run,items,candidates}) {
    if(db.prepare('SELECT 1 FROM sourcing_runs WHERE run_id=?').get(run.runId))throw new Error(`run_id 已存在，禁止覆盖历史 run：${run.runId}`);
    return transaction(db,()=>{
      db.prepare(`INSERT INTO sourcing_runs(run_id,method,started_at,finished_at,status,input_count,processed_count,
        fx_pair,fx_rate,fx_source,fx_observed_at,scoring_weights_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        run.runId,run.method,run.startedAt,run.finishedAt,run.status,run.inputCount,run.processedCount,
        run.fxPair,run.fxRate,run.fxSource,run.fxObservedAt,JSON.stringify(run.scoringWeights));
      const insertItem=db.prepare(`INSERT INTO sourcing_run_items(run_id,temu_goods_id,temu_title,temu_image_path,level1,level2,level3,
        similar_cluster,search_status,candidate_count,manual_review_required,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
      for(const item of items)insertItem.run(run.runId,item.goodsId,item.title,item.imagePath,item.level1,item.level2,item.level3,item.similarCluster,
        item.searchStatus,item.candidateCount,item.manualReviewRequired?1:0,item.notes??null);
      const insertCandidate=db.prepare(`INSERT INTO supplier_match_candidates(run_id,temu_goods_id,candidate_rank,supplier_platform,
        supplier_product_id,supplier_title,supplier_url,supplier_image_url,supplier_image_local_path,price_raw,price_min_rmb,price_max_rmb,
        price_min_eur,price_max_eur,moq,shop_name,image_similarity,image_similarity_status,title_similarity,category_similarity,overall_similarity,
        captured_at,search_status,manual_review_required,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for(const c of candidates)insertCandidate.run(run.runId,c.goodsId,c.candidateRank,'1688',c.supplierProductId,c.supplierTitle,c.supplierUrl,
        c.supplierImageUrl,c.supplierImageLocalPath,c.priceRaw,c.priceMinRmb,c.priceMaxRmb,c.priceMinEur,c.priceMaxEur,c.moq,c.shopName,
        c.imageSimilarity,c.imageSimilarityStatus,c.titleSimilarity,c.categorySimilarity,c.overallSimilarity,c.capturedAt,c.searchStatus,
        c.manualReviewRequired?1:0,c.notes??null);
      return {runId:run.runId,inputCount:items.length,candidateCount:candidates.length};
    });
  }

  function selectedMatches() {
    const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_match_selections'").get();
    if(!table)return new Map();
    const rows=db.prepare(`SELECT s.temu_goods_id,s.decision_method,s.confirmed_at,s.notes AS selection_notes,c.*
      FROM supplier_match_selections s JOIN supplier_match_candidates c
        ON c.run_id=s.run_id AND c.temu_goods_id=s.temu_goods_id AND c.candidate_rank=s.candidate_rank
      ORDER BY s.confirmed_at DESC`).all();
    const map=new Map();for(const row of rows)if(!map.has(String(row.temu_goods_id)))map.set(String(row.temu_goods_id),row);return map;
  }
  function formalSourcingState() {
    const itemTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sourcing_run_items'").get();
    if(!itemTable)return new Map();
    const map=new Map();
    const items=db.prepare(`SELECT i.*,r.started_at FROM sourcing_run_items i JOIN sourcing_runs r ON r.run_id=i.run_id ORDER BY r.started_at DESC`).all();
    for(const row of items)if(!map.has(String(row.temu_goods_id)))map.set(String(row.temu_goods_id),{
      temu_goods_id:String(row.temu_goods_id),match_status:Number(row.candidate_count)>0?'AWAITING_MANUAL_REVIEW':row.search_status,
      manual_review_required:1,notes:row.notes,run_id:row.run_id,
    });
    for(const [goodsId,row] of selectedMatches())map.set(goodsId,{...row,match_status:'MATCH_CONFIRMED'});
    return map;
  }
  return {insertImportedRun,selectedMatches,formalSourcingState};
}
