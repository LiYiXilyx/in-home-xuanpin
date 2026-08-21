import { AppError } from '../shared/errors.mjs';

export function createJobControl(repository) {
  return {
    heartbeat(jobId, checkpoint) {
      return repository.heartbeat(jobId, checkpoint);
    },
    checkpointBoundary(jobId, checkpoint) {
      const control = repository.getControlState(jobId);
      if (control.cancelRequested) {
        repository.appendEvent(jobId, 'checkpoint_saved', 'info', '取消前的安全检查点已保存。', checkpointSummary(checkpoint));
        repository.transitionJob(jobId, 'cancelled', { checkpoint, eventType: 'cancelled', message: '任务已在安全边界取消。' });
        throw new AppError('任务已取消。', { code: 'JOB_CANCELLED' });
      }
      if (control.pauseRequested) {
        repository.appendEvent(jobId, 'checkpoint_saved', 'info', '暂停前的安全检查点已保存。', checkpointSummary(checkpoint));
        repository.transitionJob(jobId, 'paused', { checkpoint, eventType: 'paused', message: '任务已在安全边界暂停。' });
        throw new AppError('任务已暂停。', { code: 'JOB_PAUSED', retriable: true });
      }
      return repository.heartbeat(jobId, checkpoint);
    }
  };
}

function checkpointSummary(checkpoint = {}) {
  return {
    phase: checkpoint.phase ?? null,
    round: checkpoint.scrollRound ?? checkpoint.round ?? null,
    currentCount: checkpoint.currentCount ?? checkpoint.discovered ?? null,
    lastEvent: checkpoint.lastEvent ?? null
  };
}
