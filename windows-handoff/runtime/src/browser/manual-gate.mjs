import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config/load.mjs';
import { openDatabase } from '../db/client.mjs';
import { createJobRepository } from '../db/repositories/job-repository.mjs';
import { createJobService } from '../jobs/job-service.mjs';
import { AppError } from '../shared/errors.mjs';

export async function waitForOperatorConfirmation({ config, label = '人工关卡', reason = 'operator_confirmation', message }) {
  const jobId = process.env.TEMU_JOB_ID;
  if (!jobId) return promptEnter(`${message}\n完成后按 Enter 继续：`);
  const runtimeConfig = config?.app ? config : await loadConfig(process.env.TEMU_CONFIG_PATH || 'config.json');
  const db = openDatabase(runtimeConfig.app.databasePath);
  const repository = createJobRepository(db);
  const service = createJobService(repository);
  try {
    service.openManualGate(jobId, { reason, message });
    const timeoutMs = Number(runtimeConfig.browser.manualGateTimeoutMs ?? 1_800_000);
    const pollMs = Math.max(100, Number(runtimeConfig.browser.manualGatePollMs ?? 500));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = service.get(jobId);
      if (job?.status === 'running') return true;
      if (job?.status === 'cancelled') throw new AppError('人工关卡等待期间任务被取消。', { code: 'JOB_CANCELLED' });
      if (!job || job.status !== 'paused') throw new AppError(`人工关卡状态异常：${job?.status ?? 'missing'}`, { code: 'MANUAL_GATE_STATE_INVALID' });
      await delay(pollMs);
    }
    throw new AppError(`${label}等待运营确认超时。`, { code: 'MANUAL_GATE_TIMEOUT', retriable: true });
  } finally {
    db.close();
  }
}

async function promptEnter(message) {
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  try { await prompt.question(message); } finally { prompt.close(); }
  return true;
}

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
