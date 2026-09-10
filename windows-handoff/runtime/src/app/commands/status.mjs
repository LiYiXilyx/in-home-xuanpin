import { openDatabase } from '../../db/client.mjs';
import { createJobRepository } from '../../db/repositories/job-repository.mjs';
import { createJobService } from '../../jobs/job-service.mjs';

export function getPersistentStatus(config, { limit = 20 } = {}) {
  const db = openDatabase(config.app.databasePath, { readOnly: true });
  try {
    const repository = createJobRepository(db);
    const service = createJobService(repository);
    const jobs = service.list({ limit });
    const latest = jobs[0] ?? null;
    return {
      databasePath: config.app.databasePath,
      counts: Object.fromEntries(db.prepare('SELECT status,COUNT(*) AS count FROM crawl_jobs GROUP BY status').all()
        .map(row => [row.status, Number(row.count)])),
      latestJob: latest,
      latestEvents: latest ? service.events(latest.id, { limit: 50 }) : []
    };
  } finally {
    db.close();
  }
}

export function runStatusCommand(config) {
  const status = getPersistentStatus(config);
  console.log(JSON.stringify(status, null, 2));
  return status;
}

export function runJobAction(config, action, jobId) {
  if (!jobId) throw new Error(`${action} 必须提供 --job <JOB_ID>。`);
  const db = openDatabase(config.app.databasePath);
  try {
    const service = createJobService(createJobRepository(db));
    const result = ({
      pause: () => service.pause(jobId), resume: () => service.resume(jobId),
      retry: () => service.retry(jobId), cancel: () => service.cancel(jobId)
    })[action]?.();
    if (!result) throw new Error(`未知任务操作：${action}`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    db.close();
  }
}
