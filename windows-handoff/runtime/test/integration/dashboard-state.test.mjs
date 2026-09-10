import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createJobRepository } from '../../src/db/repositories/job-repository.mjs';
import { createJobService } from '../../src/jobs/job-service.mjs';
import { readLatestDashboardTask } from '../../src/jobs/job-view.mjs';

test('dashboard restart view reads paused task and events from v2 database', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-dashboard-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'v2.db');
  migrateDatabase({ databasePath });
  let db = openDatabase(databasePath);
  let service = createJobService(createJobRepository(db));
  const job = service.create({ jobType: 'catalog', config: { label: '持久化任务' } });
  service.start(job.id);
  service.openManualGate(job.id, { reason: 'CAPTCHA_OR_LOGIN' });
  db.close();

  db = openDatabase(databasePath);
  service = createJobService(createJobRepository(db));
  const firstStartup = readLatestDashboardTask(service);
  assert.equal(firstStartup.id, job.id);
  assert.equal(firstStartup.status, 'paused');
  assert.equal(firstStartup.waitingForInput, true);
  db.close();

  db = openDatabase(databasePath);
  service = createJobService(createJobRepository(db));
  const secondStartup = readLatestDashboardTask(service);
  assert.equal(secondStartup.id, job.id);
  assert.equal(secondStartup.status, 'paused');
  assert.ok(secondStartup.logs.some(log => /等待运营人员|人工/.test(log.text)));
  db.close();
});
