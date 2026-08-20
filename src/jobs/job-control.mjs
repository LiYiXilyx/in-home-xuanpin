import { AppError } from '../shared/errors.mjs';

export function createJobControl(repository) {
  return {
    heartbeat(jobId, checkpoint) {
      return repository.heartbeat(jobId, checkpoint);
    },
    checkpointBoundary(jobId, checkpoint) {
      const control = repository.getControlState(jobId);
      if (control.cancelRequested) {
        repository.transitionJob(jobId, 'cancelled', { checkpoint, eventType: 'job_cancelled', message: '任务已在安全边界取消。' });
        throw new AppError('任务已取消。', { code: 'JOB_CANCELLED' });
      }
      if (control.pauseRequested) {
        repository.transitionJob(jobId, 'paused', { checkpoint, eventType: 'job_paused', message: '任务已在安全边界暂停。' });
        throw new AppError('任务已暂停。', { code: 'JOB_PAUSED', retriable: true });
      }
      return repository.heartbeat(jobId, checkpoint);
    }
  };
}
