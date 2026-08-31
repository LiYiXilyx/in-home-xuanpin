import { transaction } from '../client.mjs';

export function createSourcingReviewRepository(db,{now=()=>new Date().toISOString()}={}) {
  function listReviewGoods(runId) {
    requireRun(runId);
    return db.prepare(`SELECT i.* FROM sourcing_run_items i
      WHERE i.run_id=? ORDER BY i.temu_goods_id`).all(String(runId)).map(item=>{
      const review=readReview(String(runId),String(item.temu_goods_id));
      return {...item,...review};
    });
  }

  function getReviewGoods(runId,temuGoodsId) {
    const runKey=String(runId),goodsKey=String(temuGoodsId);
    const run=requireRun(runKey);
    const item=requireGoods(runKey,goodsKey);
    const candidates=db.prepare(`SELECT * FROM supplier_match_candidates
      WHERE run_id=? AND temu_goods_id=? ORDER BY candidate_rank ASC`).all(runKey,goodsKey).map(mapCandidate);
    return {...item,run, ...readReview(runKey,goodsKey),candidates};
  }

  function selectCandidate(input) {
    return mutate(input,{candidateRequired:true},({runId,temuGoodsId,productId,timestamp})=>{
      db.prepare(`UPDATE supplier_match_candidates SET selected_candidate=0
        WHERE run_id=? AND temu_goods_id=?`).run(runId,temuGoodsId);
      db.prepare(`UPDATE supplier_match_candidates SET selected_candidate=1,review_excluded=0,review_updated_at=?
        WHERE run_id=? AND temu_goods_id=? AND supplier_product_id=?`).run(timestamp,runId,temuGoodsId,productId);
      return 'CONFIRMED';
    });
  }

  function clearSelection(input) {
    return mutate(input,{candidateRequired:false},({runId,temuGoodsId})=>{
      db.prepare(`UPDATE supplier_match_candidates SET selected_candidate=0
        WHERE run_id=? AND temu_goods_id=?`).run(runId,temuGoodsId);
      return deriveStatus(runId,temuGoodsId);
    });
  }

  function excludeCandidate(input) {
    return mutate(input,{candidateRequired:true},({runId,temuGoodsId,productId,timestamp})=>{
      db.prepare(`UPDATE supplier_match_candidates SET selected_candidate=0,review_excluded=1,review_updated_at=?
        WHERE run_id=? AND temu_goods_id=? AND supplier_product_id=?`).run(timestamp,runId,temuGoodsId,productId);
      return deriveStatus(runId,temuGoodsId);
    });
  }

  function restoreCandidate(input) {
    return mutate(input,{candidateRequired:true},({runId,temuGoodsId,productId,timestamp})=>{
      db.prepare(`UPDATE supplier_match_candidates SET review_excluded=0,review_updated_at=?
        WHERE run_id=? AND temu_goods_id=? AND supplier_product_id=?`).run(timestamp,runId,temuGoodsId,productId);
      return deriveStatus(runId,temuGoodsId);
    });
  }

  function saveCandidateNote(input) {
    const operatorNote=normalizeNote(input.operatorNote);
    return mutate(input,{candidateRequired:true},({runId,temuGoodsId,productId,timestamp})=>{
      db.prepare(`UPDATE supplier_match_candidates SET operator_note=?,review_updated_at=?
        WHERE run_id=? AND temu_goods_id=? AND supplier_product_id=?`).run(
        operatorNote,timestamp,runId,temuGoodsId,productId,
      );
      return deriveStatus(runId,temuGoodsId);
    });
  }

  function mutate(input,{candidateRequired},operation) {
    const runId=requiredIdentity(input?.runId,'run_id');
    const temuGoodsId=requiredIdentity(input?.temuGoodsId,'temu_goods_id');
    const productId=candidateRequired?requiredIdentity(input?.productId,'product_id'):null;
    const expectedRevision=input?.expectedRevision;
    if(!Number.isInteger(expectedRevision)||expectedRevision<0) throw reviewError('REVIEW_REVISION_REQUIRED','expectedRevision 必须是非负整数');
    const timestamp=now();
    transaction(db,()=>{
      requireRun(runId);
      requireGoods(runId,temuGoodsId);
      if(candidateRequired) requireCandidate(runId,temuGoodsId,productId);
      const current=readReview(runId,temuGoodsId);
      if(current.review_revision!==expectedRevision) throw reviewError(
        'REVIEW_CONFLICT',`review revision 已变化：expected=${expectedRevision}, actual=${current.review_revision}`,
      );
      db.prepare(`INSERT OR IGNORE INTO sourcing_goods_reviews(
        run_id,temu_goods_id,review_status,review_revision,review_updated_at
      ) VALUES(?,?,?,?,NULL)`).run(runId,temuGoodsId,current.review_status,current.review_revision);
      const status=operation({runId,temuGoodsId,productId,timestamp});
      const changed=db.prepare(`UPDATE sourcing_goods_reviews SET
        review_status=?,review_revision=review_revision+1,review_updated_at=?
        WHERE run_id=? AND temu_goods_id=? AND review_revision=?`).run(
        status,timestamp,runId,temuGoodsId,expectedRevision,
      );
      if(changed.changes!==1) throw reviewError('REVIEW_CONFLICT','review revision 已变化');
    });
    return getReviewGoods(runId,temuGoodsId);
  }

  function readReview(runId,temuGoodsId) {
    const row=db.prepare(`SELECT review_status,review_revision,review_updated_at
      FROM sourcing_goods_reviews WHERE run_id=? AND temu_goods_id=?`).get(runId,temuGoodsId);
    if(row) return {...row};
    return {review_status:deriveStatus(runId,temuGoodsId),review_revision:0,review_updated_at:null};
  }

  function deriveStatus(runId,temuGoodsId) {
    const counts=db.prepare(`SELECT
      SUM(CASE WHEN selected_candidate=1 THEN 1 ELSE 0 END) AS selected_count,
      SUM(CASE WHEN review_excluded=0 THEN 1 ELSE 0 END) AS available_count
      FROM supplier_match_candidates WHERE run_id=? AND temu_goods_id=?`).get(runId,temuGoodsId);
    if(Number(counts?.selected_count??0)>0) return 'CONFIRMED';
    return Number(counts?.available_count??0)>0?'PENDING':'NO_SELECTION';
  }

  function requireRun(runId) {
    const row=db.prepare('SELECT * FROM sourcing_runs WHERE run_id=?').get(String(runId));
    if(!row) throw reviewError('REVIEW_RUN_NOT_FOUND',`sourcing run 不存在：${runId}`);
    return {...row};
  }

  function requireGoods(runId,temuGoodsId) {
    const row=db.prepare('SELECT * FROM sourcing_run_items WHERE run_id=? AND temu_goods_id=?').get(runId,temuGoodsId);
    if(!row) throw reviewError('REVIEW_GOODS_NOT_FOUND',`sourcing goods 不存在：${runId}/${temuGoodsId}`);
    return {...row};
  }

  function requireCandidate(runId,temuGoodsId,productId) {
    const row=db.prepare(`SELECT * FROM supplier_match_candidates
      WHERE run_id=? AND temu_goods_id=? AND supplier_product_id=?`).get(runId,temuGoodsId,productId);
    if(!row) throw reviewError('REVIEW_CANDIDATE_NOT_FOUND',`supplier candidate 不存在：${runId}/${temuGoodsId}/${productId}`);
    return {...row};
  }

  return {
    listReviewGoods,getReviewGoods,selectCandidate,clearSelection,excludeCandidate,
    restoreCandidate,saveCandidateNote,
  };
}

function mapCandidate(row) {
  return {
    ...row,
    random_sample_rank:Number(row.candidate_rank),
    '1688_product_id':String(row.supplier_product_id),
    '1688_title':row.supplier_title,
    '1688_product_url':row.supplier_url,
    '1688_image_url':row.supplier_image_url,
    '1688_image_local_path':row.supplier_image_local_path,
  };
}

function normalizeNote(value) {
  if(value===null||value===undefined) return null;
  const text=String(value);
  if(Array.from(text).length>2000) throw reviewError('OPERATOR_NOTE_TOO_LONG','operator_note 最多 2000 个字符');
  return text.trim()===''?null:text;
}

function requiredIdentity(value,name) {
  const text=value===null||value===undefined?'':String(value);
  if(text==='') throw reviewError('REVIEW_IDENTITY_REQUIRED',`${name} 不能为空`);
  return text;
}

function reviewError(code,message) {
  return Object.assign(new Error(message),{code});
}
