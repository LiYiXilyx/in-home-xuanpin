import { transaction } from '../client.mjs';

export function createSourcingRepository(db) {
  function insertStructuredImport({run,files,items,candidates}) {
    if(db.prepare('SELECT 1 FROM sourcing_runs WHERE run_id=?').get(run.runId)) {
      throw new Error(`run_id 已存在，禁止覆盖或追加：${run.runId}`);
    }
    const now=run.importedAt;
    return transaction(db,()=>{
      db.prepare(`INSERT INTO sourcing_runs(
        run_id,git_commit_sha,machine_role,machine_name,started_at,finished_at,status,
        input_count,processed_count,target_count,input_manifest_sha256,created_at,updated_at,method,
        import_status,source_dir,source_file_count,source_manifest_sha256,image_cache_dir,
        selected_workbook_path,imported_at,sample_method
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        run.runId,run.gitCommitSha,'1688_RUNNER',run.machineName,run.startedAt,null,'RUNNING',
        items.length,items.length,Math.max(1,items.length),run.sourceManifestSha256,now,now,'YINGDAO_1688_ASSISTANT',
        'RUNNING',run.sourceDir,run.sourceFileCount,run.sourceManifestSha256,run.imageCacheDir??null,
        run.selectedWorkbookPath??null,run.importedAt,run.sampleMethod,
      );

      const insertFile=db.prepare(`INSERT INTO sourcing_run_files(
        run_id,temu_goods_id,filename,source_export_file,file_sha256,row_count,parse_status,parse_error,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`);
      for(const file of files) insertFile.run(
        run.runId,String(file.temu_goods_id),file.filename,file.source_export_file,file.file_sha256,
        file.row_count,file.parse_status,file.parse_error??null,now,
      );

      const insertItem=db.prepare(`INSERT INTO sourcing_run_items(
        run_id,temu_goods_id,temu_title,temu_image_path,status,updated_at,
        source_export_file,source_file_sha256,source_candidate_count,sampled_count,temu_context_status
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for(const item of items) insertItem.run(
        run.runId,String(item.temu_goods_id),item.temu_title??'',item.temu_image_path??'','COMPLETED',now,
        item.source_export_file,item.source_file_sha256,item.source_candidate_count,item.sampled_count,
        item.temu_context_status??'MISSING',
      );

      const insertCandidate=db.prepare(`INSERT INTO supplier_match_candidates(
        run_id,temu_goods_id,candidate_rank,supplier_platform,supplier_product_id,supplier_title,
        supplier_url,supplier_image_url,supplier_image_local_path,price_raw,moq,shop_name,
        captured_at,capture_status,manual_review_required,original_rank,sample_seed,sample_method,
        price_rmb,shipping_text,sales_amount_raw,moq_shipping_raw,monthly_sales,cumulative_sales,
        repurchase_rate,shipping_48h_rate,first_listed_at,updated_at,shop_qualification,
        image_download_status,image_downloaded_at,image_sha256,image_response_sha256,imported_at,selected_candidate
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for(const candidate of candidates) {
        const localPath=relativeImagePath(candidate['1688_image_local_path']??candidate.supplier_image_local_path??null);
        const importedAt=candidate.imported_at??run.importedAt;
        insertCandidate.run(
          run.runId,String(candidate.temu_goods_id),candidate.random_sample_rank,'1688',
          String(candidate['1688_product_id']),candidate['1688_title']??null,candidate['1688_product_url']??null,
          candidate['1688_image_url']??null,localPath,candidate.price_raw??null,candidate.moq??null,
          candidate.shop_name??null,importedAt,'IMPORTED',1,candidate.original_rank,
          candidate.sample_seed,candidate.sample_method,candidate.price_rmb??null,candidate.shipping_text??null,
          candidate.sales_amount_raw??null,candidate.moq_shipping_raw??null,candidate.monthly_sales??null,
          candidate.cumulative_sales??null,candidate.repurchase_rate??null,candidate.shipping_48h_rate??null,
          candidate.first_listed_at??null,candidate.updated_at??null,candidate.shop_qualification??null,
          candidate.image_download_status??'PENDING',candidate.image_downloaded_at??null,
          candidate.image_sha256??null,candidate.image_response_sha256??null,importedAt,null,
        );
      }
      return { runId:run.runId,inputCount:items.length,candidateCount:candidates.length };
    });
  }

  function markImportResult(runId,result) {
    const importStatus=result.status;
    const legacyStatus=importStatus==='COMPLETED_WITH_WARNINGS'?'COMPLETED':importStatus;
    const changed=db.prepare(`UPDATE sourcing_runs SET import_status=?,status=?,finished_at=?,updated_at=?,qa_json=? WHERE run_id=?`).run(
      importStatus,legacyStatus,result.finishedAt,result.finishedAt,JSON.stringify(result.qa??null),runId,
    );
    if(changed.changes!==1) throw new Error(`import run 不存在：${runId}`);
    return getImport(runId);
  }

  function failedImages(runId) {
    return db.prepare(`SELECT * FROM supplier_match_candidates
      WHERE run_id=? AND image_download_status='FAILED'
      ORDER BY temu_goods_id,candidate_rank`).all(runId).map(row=>({ ...row }));
  }

  function updateImageResult(runId,key,result) {
    const localPath=relativeImagePath(result.localPath??null);
    const changed=db.prepare(`UPDATE supplier_match_candidates SET
      supplier_image_local_path=?,image_download_status=?,image_downloaded_at=?,image_sha256=?,image_response_sha256=?
      WHERE run_id=? AND temu_goods_id=? AND supplier_product_id=?`).run(
      localPath,result.status,result.downloadedAt??null,result.imageSha256??null,result.responseSha256??null,
      runId,String(key.temuGoodsId),String(key.productId),
    );
    if(changed.changes!==1) throw new Error(`supplier candidate 不存在：${runId}/${key.temuGoodsId}/${key.productId}`);
    return changed.changes;
  }

  function getImport(runId) {
    const run=db.prepare('SELECT * FROM sourcing_runs WHERE run_id=?').get(runId);
    if(!run) return null;
    const files=db.prepare('SELECT * FROM sourcing_run_files WHERE run_id=? ORDER BY filename').all(runId).map(row=>({ ...row }));
    const items=db.prepare('SELECT * FROM sourcing_run_items WHERE run_id=? ORDER BY temu_goods_id').all(runId).map(row=>({ ...row }));
    const candidates=db.prepare('SELECT * FROM supplier_match_candidates WHERE run_id=? ORDER BY temu_goods_id,candidate_rank').all(runId).map(row=>({ ...row }));
    return {
      ...run,
      item_count:items.length,
      candidate_count:candidates.length,
      failed_image_count:candidates.filter(candidate=>candidate.image_download_status==='FAILED').length,
      files,items,candidates,
    };
  }

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
  return {
    insertImportedRun,insertStructuredImport,markImportResult,failedImages,updateImageResult,getImport,
    selectedMatches,formalSourcingState,
  };
}

function relativeImagePath(value) {
  if(value===null) return null;
  const text=String(value);
  if(text==='' || text.includes('\\') || text.startsWith('/') || /^[A-Za-z]:/.test(text)) {
    throw new Error(`supplier_image_local_path 必须是 POSIX 相对路径：${text}`);
  }
  return text;
}
