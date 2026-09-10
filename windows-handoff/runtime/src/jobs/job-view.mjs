export function toDashboardTask(service, job) {
  if (!job) return {
    id: null, kind: null, label: '当前没有运行任务', status: 'idle', step: '',
    waitingForInput: false, startedAt: null, finishedAt: null, exitCode: null, logs: []
  };
  const events = service.events(job.id, { limit: 200 });
  return {
    id: job.id,
    kind: job.config?.dashboardTaskKind ?? job.jobType,
    label: job.config?.label ?? jobLabel(job.jobType),
    status: job.status,
    step: events.at(-1)?.message ?? '',
    waitingForInput: job.status === 'paused' && Boolean(job.checkpoint?.manualGate),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: ['completed', 'completed_with_errors'].includes(job.status) ? 0 : job.status === 'failed' ? 1 : null,
    logs: events.map(event => ({ at: event.createdAt, source: event.level, text: event.message }))
  };
}

export function readLatestDashboardTask(service) {
  return toDashboardTask(service, service.list({ limit: 1 })[0] ?? null);
}

function jobLabel(jobType) {
  return ({ catalog: 'Temu 商品池采集', product_detail: 'Temu 商品详情', reviews: 'Temu 评论任务', export: 'Excel 导出' })[jobType] ?? jobType;
}
