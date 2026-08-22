import { AppError } from '../../shared/errors.mjs';
import { createId } from '../../shared/ids.mjs';
import { transaction } from '../client.mjs';

export const JOB_STATUSES = Object.freeze([
  'pending', 'running', 'paused', 'interrupted', 'completed', 'completed_with_errors', 'failed', 'cancelled'
]);

const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'cancelled']);
const RETRIABLE_ITEM_CODES = new Set([
  'NETWORK_ERROR', 'ECONNRESET', 'ETIMEDOUT', 'TIMEOUT', 'CDP_UNREACHABLE',
  'BROWSER_CLOSED', 'IMAGE_FETCH_FAILED', 'CAPTCHA_OR_LOGIN', 'ACCESS_RESTRICTED'
]);
const BROWSER_JOB_TYPES = new Set(['catalog', 'product_detail', 'reviews']);
const TRANSITIONS = new Map([
  ['pending', new Set(['running', 'cancelled'])],
  ['running', new Set(['paused', 'interrupted', 'completed', 'completed_with_errors', 'failed', 'cancelled'])],
  ['paused', new Set(['running', 'cancelled'])],
  ['interrupted', new Set(['running', 'failed', 'cancelled'])],
  ['failed', new Set(['running', 'cancelled'])],
  ['completed', new Set()],
  ['completed_with_errors', new Set(['running'])],
  ['cancelled', new Set()]
]);

export function createJobRepository(db, { now = () => new Date().toISOString() } = {}) {
  const getJob = id => mapJob(db.prepare('SELECT * FROM crawl_jobs WHERE id=?').get(id));

  function createJob(input) {
    const timestamp = now();
    const id = input.id ?? createId('job');
    db.prepare(`INSERT INTO crawl_jobs(
      id,job_type,mode,site_country,language,currency,primary_category,subcategory,source_url,sort_order,
      target_count,status,checkpoint_json,config_json,requested_at,updated_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.jobType, input.mode ?? 'operator_current_page', input.siteCountry ?? null,
      input.language ?? null, input.currency ?? null, input.primaryCategory ?? null,
      input.subcategory ?? null, input.sourceUrl ?? null, input.sortOrder ?? null,
      input.targetCount ?? null, 'pending', stringify(input.checkpoint), stringify(input.config ?? {}),
      timestamp, timestamp, timestamp
    );
    appendEvent(id, 'job_created', 'info', '任务已创建。', { jobType: input.jobType, mode: input.mode ?? 'operator_current_page' });
    return getJob(id);
  }

  function startJob(id, { eventType = 'job_started', message = '任务开始运行。', checkpoint } = {}) {
    return transaction(db, () => {
      const job = requireJob(id);
      assertTransition(job.status, 'running');
      if (BROWSER_JOB_TYPES.has(job.jobType)) {
        const active = db.prepare(`SELECT id FROM crawl_jobs
          WHERE status='running' AND job_type IN ('catalog','product_detail','reviews') AND id<>? LIMIT 1`).get(id);
        if (active) throw new AppError('已有浏览器采集任务正在运行。', {
          code: 'BROWSER_JOB_CONFLICT', retriable: true, details: { activeJobId: active.id }
        });
      }
      const timestamp = now();
      const incrementResume = ['paused', 'interrupted', 'failed', 'completed_with_errors'].includes(job.status) ? 1 : 0;
      db.prepare(`UPDATE crawl_jobs SET status='running',pause_requested=0,cancel_requested=0,
        started_at=COALESCE(started_at,?),heartbeat_at=?,updated_at=?,finished_at=NULL,
        checkpoint_json=COALESCE(?,checkpoint_json),
        resume_count=resume_count+?,last_error_code=NULL,last_error_message=NULL WHERE id=?`)
        .run(timestamp, timestamp, timestamp, checkpoint === undefined ? null : stringify(checkpoint), incrementResume, id);
      appendEvent(id, eventType, 'info', message, { previousStatus: job.status });
      return getJob(id);
    });
  }

  function transitionJob(id, nextStatus, options = {}) {
    return transaction(db, () => {
      const job = requireJob(id);
      assertTransition(job.status, nextStatus);
      const timestamp = now();
      const terminal = TERMINAL_STATUSES.has(nextStatus) || nextStatus === 'failed';
      db.prepare(`UPDATE crawl_jobs SET status=?,checkpoint_json=COALESCE(?,checkpoint_json),
        pause_requested=CASE WHEN ?='paused' THEN 0 ELSE pause_requested END,
        cancel_requested=CASE WHEN ?='cancelled' THEN 0 ELSE cancel_requested END,
        heartbeat_at=CASE WHEN ?='running' THEN ? ELSE heartbeat_at END,
        finished_at=CASE WHEN ? THEN ? ELSE NULL END,updated_at=?,
        last_error_code=?,last_error_message=? WHERE id=?`).run(
        nextStatus, options.checkpoint === undefined ? null : stringify(options.checkpoint),
        nextStatus, nextStatus, nextStatus, timestamp, terminal ? 1 : 0, timestamp, timestamp,
        options.errorCode ?? null, options.errorMessage ?? null, id
      );
      appendEvent(id, options.eventType ?? `job_${nextStatus}`, options.level ?? levelForStatus(nextStatus),
        options.message ?? statusMessage(nextStatus), { previousStatus: job.status, ...(options.payload ?? {}) });
      return getJob(id);
    });
  }

  function requestPause(id) {
    const job = requireJob(id);
    if (job.status !== 'running') throw invalidState(job.status, 'request_pause');
    const timestamp = now();
    db.prepare('UPDATE crawl_jobs SET pause_requested=1,updated_at=? WHERE id=?').run(timestamp, id);
    appendEvent(id, 'pause_requested', 'info', '已请求暂停，将在安全批次边界生效。');
    return getJob(id);
  }

  function requestCancel(id) {
    const job = requireJob(id);
    if (TERMINAL_STATUSES.has(job.status)) throw invalidState(job.status, 'request_cancel');
    const timestamp = now();
    if (job.status === 'pending' || job.status === 'paused' || job.status === 'interrupted' || job.status === 'failed') {
      return transitionJob(id, 'cancelled', { eventType: 'job_cancelled', message: '任务已取消。' });
    }
    db.prepare('UPDATE crawl_jobs SET cancel_requested=1,updated_at=? WHERE id=?').run(timestamp, id);
    appendEvent(id, 'cancel_requested', 'warn', '已请求取消，将在安全批次边界生效。');
    return getJob(id);
  }

  function heartbeat(id, checkpoint) {
    const job = requireJob(id);
    if (job.status !== 'running') throw invalidState(job.status, 'heartbeat');
    const timestamp = now();
    db.prepare('UPDATE crawl_jobs SET heartbeat_at=?,checkpoint_json=COALESCE(?,checkpoint_json),updated_at=? WHERE id=?')
      .run(timestamp, checkpoint === undefined ? null : stringify(checkpoint), timestamp, id);
    return getJob(id);
  }

  function updateCounts(id, counts = {}) {
    requireJob(id);
    const current = getJob(id);
    const values = {
      totalItems: counts.totalItems ?? current.totalItems,
      processedItems: counts.processedItems ?? current.processedItems,
      successItems: counts.successItems ?? current.successItems,
      failedItems: counts.failedItems ?? current.failedItems,
      discoveredCount: counts.discoveredCount ?? current.discoveredCount,
      storedCount: counts.storedCount ?? current.storedCount,
      errorCount: counts.errorCount ?? current.errorCount
    };
    for (const [field, value] of Object.entries(values)) {
      if (!Number.isInteger(Number(value)) || Number(value) < 0) {
        throw new AppError(`任务计数 ${field} 必须是非负整数。`, { code: 'JOB_COUNT_INVALID' });
      }
    }
    db.prepare(`UPDATE crawl_jobs SET total_items=?,processed_items=?,success_items=?,failed_items=?,
      discovered_count=?,stored_count=?,error_count=?,updated_at=? WHERE id=?`).run(
      values.totalItems, values.processedItems, values.successItems, values.failedItems,
      values.discoveredCount, values.storedCount, values.errorCount, now(), id
    );
    return getJob(id);
  }

  function updateSourceUrl(id, sourceUrl) {
    requireJob(id);
    db.prepare('UPDATE crawl_jobs SET source_url=?,updated_at=? WHERE id=?').run(sourceUrl ?? null, now(), id);
    return getJob(id);
  }

  function recoverInterruptedJobs(staleBefore) {
    const stale = db.prepare(`SELECT id FROM crawl_jobs
      WHERE status='running' AND (heartbeat_at IS NULL OR heartbeat_at < ?) ORDER BY requested_at`).all(staleBefore);
    return stale.map(row => transitionJob(row.id, 'interrupted', {
      eventType: 'job_interrupted', level: 'warn', message: '检测到进程异常退出，任务已转为可恢复状态。',
      errorCode: 'PROCESS_INTERRUPTED'
    }));
  }

  function appendEvent(jobId, eventType, level, message, payload) {
    db.prepare('INSERT INTO crawl_events(job_id,event_type,level,message,payload_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(jobId, eventType, level, message, payload === undefined ? null : stringify(payload), now());
  }

  function listEvents(jobId, { limit = 200 } = {}) {
    return db.prepare(`SELECT id,job_id AS jobId,event_type AS eventType,level,message,payload_json AS payloadJson,
      created_at AS createdAt FROM crawl_events WHERE job_id=? ORDER BY id DESC LIMIT ?`).all(jobId, limit)
      .reverse().map(row => ({ ...row, payload: parseJson(row.payloadJson), payloadJson: undefined }));
  }

  function upsertJobItem(jobId, item) {
    requireJob(jobId);
    db.prepare(`INSERT INTO crawl_job_items(job_id,sequence_no,item_key,product_id,product_url,status,checkpoint_json)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(job_id,item_key) DO UPDATE SET
      sequence_no=excluded.sequence_no,product_id=COALESCE(excluded.product_id,crawl_job_items.product_id),
      product_url=COALESCE(excluded.product_url,crawl_job_items.product_url),
      checkpoint_json=COALESCE(excluded.checkpoint_json,crawl_job_items.checkpoint_json)`)
      .run(jobId, item.sequenceNo, item.itemKey, item.productId ?? null,item.productUrl ?? null,
        item.status ?? 'pending', stringify(item.checkpoint));
    return mapItem(db.prepare('SELECT * FROM crawl_job_items WHERE job_id=? AND item_key=?').get(jobId, item.itemKey));
  }

  function listJobItems(jobId, { status } = {}) {
    const rows = status
      ? db.prepare('SELECT * FROM crawl_job_items WHERE job_id=? AND status=? ORDER BY sequence_no').all(jobId, status)
      : db.prepare('SELECT * FROM crawl_job_items WHERE job_id=? ORDER BY sequence_no').all(jobId);
    return rows.map(mapItem);
  }

  function listRetriableFailedJobItems(jobId) {
    return listJobItems(jobId, { status: 'failed' }).filter(item => isRetriableJobItem(item));
  }

  function transitionJobItem(jobId, itemKey, nextStatus, options = {}) {
    const item = mapItem(db.prepare('SELECT * FROM crawl_job_items WHERE job_id=? AND item_key=?').get(jobId, itemKey));
    if (!item) throw new AppError(`任务项不存在：${itemKey}`, { code: 'JOB_ITEM_NOT_FOUND' });
    const allowed = {
      pending: ['running', 'skipped'], running: ['completed', 'failed', 'skipped'],
      failed: ['running'], completed: [], skipped: []
    };
    if (!allowed[item.status]?.includes(nextStatus)) {
      throw new AppError(`任务项状态 ${item.status} 不允许转为 ${nextStatus}。`, {
        code: 'JOB_ITEM_INVALID_TRANSITION', details: { jobId, itemKey, currentStatus: item.status, nextStatus }
      });
    }
    const timestamp = now();
    db.prepare(`UPDATE crawl_job_items SET status=?,attempt_count=attempt_count+?,
      checkpoint_json=COALESCE(?,checkpoint_json),started_at=CASE WHEN ?='running' THEN ? ELSE started_at END,
      finished_at=CASE WHEN ? IN ('completed','failed','skipped') THEN ? ELSE NULL END,
      error_code=?,error_message=? WHERE job_id=? AND item_key=?`).run(
      nextStatus, nextStatus === 'running' ? 1 : 0, options.checkpoint === undefined ? null : stringify(options.checkpoint),
      nextStatus, timestamp, nextStatus, timestamp, options.errorCode ?? null, options.errorMessage ?? null, jobId, itemKey
    );
    return mapItem(db.prepare('SELECT * FROM crawl_job_items WHERE job_id=? AND item_key=?').get(jobId, itemKey));
  }

  function checkpointJobItem(jobId,itemKey,checkpoint) {
    const result=db.prepare(`UPDATE crawl_job_items SET checkpoint_json=? WHERE job_id=? AND item_key=? AND status='running'`)
      .run(stringify(checkpoint),jobId,itemKey);
    if (Number(result.changes) !== 1) throw new AppError(`运行中的任务项不存在：${itemKey}`,{ code:'JOB_ITEM_NOT_RUNNING' });
    return mapItem(db.prepare('SELECT * FROM crawl_job_items WHERE job_id=? AND item_key=?').get(jobId,itemKey));
  }

  function getControlState(id) {
    const row = db.prepare('SELECT status,pause_requested AS pauseRequested,cancel_requested AS cancelRequested,checkpoint_json AS checkpointJson FROM crawl_jobs WHERE id=?').get(id);
    if (!row) throw new AppError(`任务不存在：${id}`, { code: 'JOB_NOT_FOUND' });
    return { ...row, pauseRequested: Boolean(row.pauseRequested), cancelRequested: Boolean(row.cancelRequested), checkpoint: parseJson(row.checkpointJson) };
  }

  function listJobs({ limit = 50 } = {}) {
    return db.prepare('SELECT * FROM crawl_jobs ORDER BY requested_at DESC LIMIT ?').all(limit).map(mapJob);
  }

  function requireJob(id) {
    const job = getJob(id);
    if (!job) throw new AppError(`任务不存在：${id}`, { code: 'JOB_NOT_FOUND' });
    return job;
  }

  return {
    createJob, getJob, listJobs, startJob, transitionJob, requestPause, requestCancel, heartbeat,
    updateCounts, updateSourceUrl, recoverInterruptedJobs, appendEvent, listEvents, upsertJobItem, listJobItems,
    listRetriableFailedJobItems, transitionJobItem, checkpointJobItem, getControlState
  };
}

export function isRetriableJobItem(item) {
  if (!item || item.status !== 'failed') return false;
  if (item.checkpoint?.retriable === false || item.checkpoint?.permanent === true) return false;
  return item.checkpoint?.retriable === true || RETRIABLE_ITEM_CODES.has(String(item.errorCode ?? '').toUpperCase());
}

export function assertTransition(currentStatus, nextStatus) {
  if (!JOB_STATUSES.includes(nextStatus) || !TRANSITIONS.get(currentStatus)?.has(nextStatus)) {
    throw invalidState(currentStatus, nextStatus);
  }
}

function invalidState(currentStatus, action) {
  return new AppError(`任务状态 ${currentStatus} 不允许执行 ${action}。`, {
    code: 'JOB_INVALID_TRANSITION', details: { currentStatus, action }
  });
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id, jobType: row.job_type, mode: row.mode, siteCountry: row.site_country,
    language: row.language, currency: row.currency, primaryCategory: row.primary_category,
    subcategory: row.subcategory, sourceUrl: row.source_url, sortOrder: row.sort_order,
    targetCount: row.target_count, status: row.status, pauseRequested: Boolean(row.pause_requested),
    cancelRequested: Boolean(row.cancel_requested), checkpoint: parseJson(row.checkpoint_json),
    config: parseJson(row.config_json), totalItems: row.total_items, processedItems: row.processed_items,
    successItems: row.success_items, failedItems: row.failed_items, discoveredCount: row.discovered_count,
    storedCount: row.stored_count, errorCount: row.error_count, resumeCount: row.resume_count,
    requestedAt: row.requested_at, startedAt: row.started_at, heartbeatAt: row.heartbeat_at,
    updatedAt: row.updated_at, finishedAt: row.finished_at,
    lastErrorCode: row.last_error_code, lastErrorMessage: row.last_error_message
  };
}

function mapItem(row) {
  return row ? {
    id: row.id, jobId: row.job_id, sequenceNo: row.sequence_no, itemKey: row.item_key,
    productId: row.product_id, productUrl: row.product_url, status: row.status,
    attemptCount: row.attempt_count, checkpoint: parseJson(row.checkpoint_json),
    startedAt: row.started_at, finishedAt: row.finished_at,
    errorCode: row.error_code, errorMessage: row.error_message
  } : null;
}

function stringify(value) {
  return value === undefined ? null : JSON.stringify(value);
}
function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
function levelForStatus(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'interrupted' || status === 'cancelled') return 'warn';
  return 'info';
}
function statusMessage(status) {
  return ({
    paused: '任务已在安全边界暂停。', interrupted: '任务已中断，可从断点恢复。',
    completed: '任务已完成。', completed_with_errors: '任务完成，但存在失败项。',
    failed: '任务执行失败。', cancelled: '任务已取消。'
  })[status] ?? `任务状态已更新为 ${status}。`;
}
