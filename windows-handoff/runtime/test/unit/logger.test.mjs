import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../../src/shared/logger.mjs';

test('logger writes JSONL and redacts nested credentials', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixed = new Date('2026-08-20T01:02:03.000Z');
  const logger = createLogger({ logDir: directory, consoleOutput: false, now: () => fixed });
  logger.info('测试日志', { cookie: 'secret-cookie', nested: { accessToken: 'secret-token', value: 1 } });
  const record = JSON.parse(fs.readFileSync(path.join(directory, '2026-08-20.jsonl'), 'utf8'));
  assert.equal(record.details.cookie, '[REDACTED]');
  assert.equal(record.details.nested.accessToken, '[REDACTED]');
  assert.equal(record.details.nested.value, 1);
});
