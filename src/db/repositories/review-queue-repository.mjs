import { transaction } from '../client.mjs';
import { AppError } from '../../shared/errors.mjs';
import { createId } from '../../shared/ids.mjs';

const TRANSITIONS=Object.freeze({
  pending:['opening','failed'],
  opening:['waiting_operator','capturing','failed','pending'],
  waiting_operator:['capturing','failed','pending'],
  capturing:['completed','failed','pending'],
  completed:[],
  failed:['pending']
});

export function createReviewQueueRepository(db,{ now=() => new Date().toISOString() }={}) {
  function enqueue(jobId,items) {
    const timestamp=now();
    transaction(db,() => {
      const insert=db.prepare(`INSERT INTO review_queue(
        id,job_id,product_id,goods_id,source_url,status,created_at,updated_at
      ) VALUES(?,?,?,?,?,'pending',?,?)
      ON CONFLICT(job_id,product_id) DO UPDATE SET
        goods_id=excluded.goods_id,source_url=excluded.source_url,updated_at=excluded.updated_at`);
      for (const item of items) insert.run(createId('review_queue'),jobId,item.productId,item.goodsId,item.sourceUrl,timestamp,timestamp);
    });
    return list(jobId);
  }

  function claimNext(jobId) {
    return transaction(db,() => {
      const row=db.prepare(`SELECT * FROM review_queue WHERE job_id=? AND status='pending'
        ORDER BY created_at,id LIMIT 1`).get(jobId);
      if (!row) return null;
      const timestamp=now();
      db.prepare(`UPDATE review_queue SET status='opening',attempt_count=attempt_count+1,
        opened_at=?,failed_at=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND status='pending'`)
        .run(timestamp,timestamp,row.id);
      return get(row.id);
    });
  }

  function transition(id,nextStatus,{ errorCode=null,errorMessage=null,checkpoint }={}) {
    const current=get(id);
    if (!current) throw new AppError('评论队列项不存在。',{ code:'REVIEW_QUEUE_NOT_FOUND' });
    if (current.status === nextStatus) return current;
    if (!TRANSITIONS[current.status]?.includes(nextStatus)) throw new AppError(
      `评论队列状态 ${current.status} 不允许转为 ${nextStatus}。`,
      { code:'REVIEW_QUEUE_INVALID_TRANSITION',details:{ id,currentStatus:current.status,nextStatus } }
    );
    const timestamp=now();
    db.prepare(`UPDATE review_queue SET status=?,
      capture_started_at=CASE WHEN ?='capturing' THEN COALESCE(capture_started_at,?) ELSE capture_started_at END,
      completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END,
      failed_at=CASE WHEN ?='failed' THEN ? ELSE NULL END,
      error_code=?,error_message=?,checkpoint_json=COALESCE(?,checkpoint_json),updated_at=? WHERE id=?`)
      .run(nextStatus,nextStatus,timestamp,nextStatus,timestamp,nextStatus,timestamp,errorCode,errorMessage,
        checkpoint === undefined ? null:JSON.stringify(checkpoint),timestamp,id);
    return get(id);
  }

  function transitionForGoods(jobId,goodsId,nextStatus,options={}) {
    const item=getForGoods(jobId,goodsId);
    if (!item) return null;
    if (item.status === nextStatus) return item;
    return transition(item.id,nextStatus,options);
  }

  function get(id) { return mapRow(db.prepare('SELECT * FROM review_queue WHERE id=?').get(id)); }
  function getForGoods(jobId,goodsId) { return mapRow(db.prepare('SELECT * FROM review_queue WHERE job_id=? AND goods_id=?').get(jobId,goodsId)); }
  function current() { return mapRow(db.prepare(`SELECT q.* FROM review_queue q
    JOIN crawl_jobs j ON j.id=q.job_id AND j.job_type='reviews'
    WHERE q.status IN ('opening','waiting_operator','capturing')
      AND j.status IN ('pending','running','paused','paused_manual_recovery','interrupted')
    ORDER BY q.updated_at DESC,q.created_at DESC,q.id DESC LIMIT 1`).get()); }
  function list(jobId) { return db.prepare('SELECT * FROM review_queue WHERE job_id=? ORDER BY created_at,id').all(jobId).map(mapRow); }
  function counts(jobId) { return db.prepare('SELECT status,COUNT(*) AS count FROM review_queue WHERE job_id=? GROUP BY status').all(jobId).reduce((result,row) => ({ ...result,[row.status]:Number(row.count) }),{}); }

  return { enqueue,claimNext,transition,transitionForGoods,get,getForGoods,current,list,counts };
}

export function isReviewQueueStatus(value) { return Object.hasOwn(TRANSITIONS,String(value)); }

function mapRow(row) {
  if (!row) return null;
  return {
    id:row.id,jobId:row.job_id,productId:Number(row.product_id),goodsId:row.goods_id,sourceUrl:row.source_url,
    status:row.status,attemptCount:Number(row.attempt_count),openedAt:row.opened_at,captureStartedAt:row.capture_started_at,
    completedAt:row.completed_at,failedAt:row.failed_at,errorCode:row.error_code,errorMessage:row.error_message,
    checkpoint:parseJson(row.checkpoint_json),createdAt:row.created_at,updatedAt:row.updated_at
  };
}
function parseJson(value) { try { return value ? JSON.parse(value):{}; } catch { return {}; } }
