import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createJobRepository } from '../../src/db/repositories/job-repository.mjs';
import { createJobService } from '../../src/jobs/job-service.mjs';
import { createJobControl } from '../../src/jobs/job-control.mjs';
import { createJobRunner } from '../../src/jobs/job-runner.mjs';
import { getPersistentStatus } from '../../src/app/commands/status.mjs';

test('persistent job state supports pause, resume, interruption, retry and a single browser job', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-job-state-'));
  const databasePath = path.join(directory, 'v2.db');
  migrateDatabase({ databasePath });
  let clock = new Date('2026-08-20T00:00:00.000Z');
  let db = openDatabase(databasePath);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  let repository = createJobRepository(db, { now: () => clock.toISOString() });
  let service = createJobService(repository, { now: () => clock });
  const control = createJobControl(repository);

  const first = service.create({ jobType: 'catalog', targetCount: 100, config: { label: '100 smoke' } });
  service.start(first.id);
  const second = service.create({ jobType: 'catalog', targetCount: 100 });
  assert.throws(() => service.start(second.id), error => error.code === 'BROWSER_JOB_CONFLICT');
  assert.equal(service.get(second.id).status, 'pending');

  const exportJob = service.create({ jobType: 'export' });
  service.start(exportJob.id);
  assert.equal(service.get(exportJob.id).status, 'running');
  service.complete(exportJob.id);

  service.pause(first.id);
  assert.throws(() => control.checkpointBoundary(first.id, { round: 4 }), error => error.code === 'JOB_PAUSED');
  assert.equal(service.get(first.id).status, 'paused');
  assert.deepEqual(service.get(first.id).checkpoint, { round: 4 });
  service.resume(first.id);
  assert.equal(service.get(first.id).resumeCount, 1);

  service.openManualGate(first.id, { reason: 'CAPTCHA_OR_LOGIN' });
  assert.equal(service.get(first.id).status, 'paused');
  db.close();

  db = openDatabase(databasePath);
  repository = createJobRepository(db, { now: () => clock.toISOString() });
  service = createJobService(repository, { now: () => clock });
  assert.equal(service.get(first.id).status, 'paused');
  service.resolveManualGate(first.id);
  assert.equal(service.get(first.id).checkpoint.manualGate, undefined);
  clock = new Date('2026-08-20T00:01:00.000Z');
  const recovered = service.recoverInterrupted({ staleAfterMs: 30_000 });
  assert.equal(recovered.some(job => job.id === first.id), true);
  assert.equal(service.get(first.id).status, 'interrupted');
  service.resume(first.id);
  service.fail(first.id, Object.assign(new Error('browser closed'), { code: 'BROWSER_CLOSED', retriable: true }));
  assert.equal(service.get(first.id).status, 'failed');
  service.retry(first.id);
  service.complete(first.id);
  assert.equal(service.get(first.id).status, 'completed');
  assert.throws(() => service.resume(first.id), error => error.code === 'JOB_INVALID_TRANSITION');

  repository.upsertJobItem(first.id, { sequenceNo: 1, itemKey: 'goods-1', productUrl: 'https://www.temu.com/goods.html?goods_id=1' });
  repository.upsertJobItem(first.id, { sequenceNo: 1, itemKey: 'goods-1' });
  repository.transitionJobItem(first.id, 'goods-1', 'running');
  repository.transitionJobItem(first.id, 'goods-1', 'failed', { errorCode: 'NETWORK_ERROR' });
  repository.transitionJobItem(first.id, 'goods-1', 'running');
  repository.transitionJobItem(first.id, 'goods-1', 'completed');
  assert.equal(repository.listJobItems(first.id).length, 1);
  assert.equal(repository.listJobItems(first.id)[0].attemptCount, 2);
  assert.ok(repository.listEvents(first.id).some(event => event.eventType === 'job_interrupted'));
  db.close();

  const status = getPersistentStatus({ app: { databasePath } });
  assert.ok([first.id, second.id, exportJob.id].includes(status.latestJob.id));
  assert.ok(Object.values(status.counts).reduce((sum, count) => sum + count, 0) >= 3);
});

test('job runner only pauses at checkpoint boundaries and can resume cleanly', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-job-runner-'));
  const databasePath = path.join(directory, 'v2.db');
  migrateDatabase({ databasePath });
  const db = openDatabase(databasePath);
  t.after(() => db.close());
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const repository = createJobRepository(db);
  const service = createJobService(repository);
  const runner = createJobRunner({ service, control: createJobControl(repository), heartbeatIntervalMs: 10 });
  const job = service.create({ jobType: 'catalog' });

  await assert.rejects(runner.run(job.id, async ({ checkpoint }) => {
    service.pause(job.id);
    checkpoint({ batch: 1 });
  }), error => error.code === 'JOB_PAUSED');
  assert.equal(service.get(job.id).status, 'paused');

  const result = await runner.run(job.id, async ({ heartbeat }) => {
    heartbeat({ batch: 2 });
    return { counts: { failedItems: 0 }, value: 42 };
  }, { resume: true });
  assert.equal(result.value, 42);
  assert.equal(service.get(job.id).status, 'completed');

  const cancelJob = service.create({ jobType: 'catalog' });
  service.start(cancelJob.id);
  service.cancel(cancelJob.id);
  assert.throws(() => createJobControl(repository).checkpointBoundary(cancelJob.id, { batch: 1 }), error => error.code === 'JOB_CANCELLED');
  assert.equal(service.get(cancelJob.id).status, 'cancelled');
});
