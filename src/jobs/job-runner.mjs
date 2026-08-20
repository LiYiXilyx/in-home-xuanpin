export function createJobRunner({ service, control, heartbeatIntervalMs = 5_000 }) {
  return {
    async run(jobId, operation, { resume = false, retry = false } = {}) {
      if (retry) service.retry(jobId);
      else if (resume) service.resume(jobId);
      else service.start(jobId);
      const timer = setInterval(() => {
        try { control.heartbeat(jobId); } catch {}
      }, heartbeatIntervalMs);
      timer.unref?.();
      try {
        const result = await operation({
          jobId,
          checkpoint: checkpoint => control.checkpointBoundary(jobId, checkpoint),
          heartbeat: checkpoint => control.heartbeat(jobId, checkpoint)
        });
        service.complete(jobId, result?.counts);
        return result;
      } catch (error) {
        if (!['JOB_PAUSED', 'JOB_CANCELLED'].includes(error?.code)) service.fail(jobId, error);
        throw error;
      } finally {
        clearInterval(timer);
      }
    }
  };
}
