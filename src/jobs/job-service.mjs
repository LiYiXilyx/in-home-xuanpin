import { AppError } from '../shared/errors.mjs';

export function createJobService(repository, { now = () => new Date() } = {}) {
  return {
    create(input) { return repository.createJob(input); },
    get(id) { return repository.getJob(id); },
    list(options) { return repository.listJobs(options); },
    events(id, options) { return repository.listEvents(id, options); },
    start(id) { return repository.startJob(id); },
    pause(id) { return repository.requestPause(id); },
    resume(id) { return repository.startJob(id, { eventType: 'resumed', message: '任务已从断点恢复。' }); },
    retry(id) { return repository.startJob(id, { eventType: 'retry_started', message: '可重试的失败任务项已重新开始。' }); },
    cancel(id) { return repository.requestCancel(id); },
    heartbeat(id, checkpoint) { return repository.heartbeat(id, checkpoint); },
    updateCounts(id, counts) { return repository.updateCounts(id, counts); },
    complete(id, counts = {}) {
      const nextStatus = Number(counts.failedItems ?? 0) > 0 ? 'completed_with_errors' : 'completed';
      return repository.transitionJob(id, nextStatus, {
        eventType: nextStatus, payload: counts
      });
    },
    fail(id, error) {
      return repository.transitionJob(id, 'failed', {
        eventType: 'failed',
        errorCode: error?.code ?? 'JOB_EXECUTION_FAILED', errorMessage: error?.message ?? String(error),
        payload: { retriable: Boolean(error?.retriable) }
      });
    },
    interrupt(id, checkpoint) {
      return repository.transitionJob(id, 'interrupted', {
        checkpoint, eventType: 'job_interrupted', level: 'warn',
        message: '进程已停止，任务保留断点等待恢复。', errorCode: 'PROCESS_INTERRUPTED'
      });
    },
    openManualGate(id, details = {}) {
      const job = repository.getJob(id);
      if (!job) throw new AppError(`任务不存在：${id}`, { code: 'JOB_NOT_FOUND' });
      if (job.status !== 'running') throw new AppError('只有运行中的任务可以进入人工关卡。', { code: 'JOB_INVALID_TRANSITION' });
      repository.appendEvent(id, 'manual_gate_waiting', 'warn', details.message ?? '等待运营人员完成登录或安全验证。', {
        reason: details.reason ?? 'operator_confirmation'
      });
      return repository.transitionJob(id, 'paused', {
        checkpoint: { ...(job.checkpoint ?? {}), manualGate: { openedAt: now().toISOString(),
          reason: details.reason ?? 'operator_confirmation',message:details.message ?? null } },
        eventType: 'manual_gate_paused', level: 'warn', message: '任务已暂停，等待运营人员确认。'
      });
    },
    resolveManualGate(id) {
      const job = repository.getJob(id);
      if (job?.status !== 'paused' || !job.checkpoint?.manualGate) {
        throw new AppError('当前任务没有待解决的人工关卡。', { code: 'MANUAL_GATE_NOT_WAITING' });
      }
      const checkpoint = { ...(job.checkpoint ?? {}) };
      delete checkpoint.manualGate;
      return repository.startJob(id, {
        eventType: 'manual_gate_resolved', message: '运营人员已确认，任务继续运行。', checkpoint
      });
    },
    recoverInterrupted({ staleAfterMs = 30_000 } = {}) {
      return repository.recoverInterruptedJobs(new Date(now().getTime() - staleAfterMs).toISOString());
    }
  };
}
