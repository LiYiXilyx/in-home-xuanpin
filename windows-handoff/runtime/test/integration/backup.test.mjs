import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupLocalData } from '../../scripts/backup-local-data.mjs';

test('backup copies config and legacy DB without ever copying the browser profile', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-backup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  const legacyDatabasePath = path.join(directory, 'data', 'temu_week1.db');
  const profileDir = path.join(directory, 'browser-profile');
  fs.mkdirSync(path.dirname(legacyDatabasePath), { recursive: true });
  fs.mkdirSync(profileDir);
  fs.writeFileSync(legacyDatabasePath, 'legacy-db-bytes');
  fs.writeFileSync(path.join(profileDir, 'Cookies'), 'must-not-be-copied');
  const config = JSON.parse(fs.readFileSync(new URL('../../config.example.json', import.meta.url), 'utf8'));
  config.app.legacyDatabasePath = './data/temu_week1.db';
  config.app.backupDir = './backups';
  config.browser.profileDir = './browser-profile';
  config.catalog.jobs[0].url = 'https://www.temu.com/category';
  fs.writeFileSync(configPath, JSON.stringify(config));
  const now = () => new Date('2026-08-20T12:00:00.000Z');

  const first = await backupLocalData({ configPath, now });
  const second = await backupLocalData({ configPath, now });
  assert.equal(first.copied.length, 2);
  assert.equal(first.browserProfileIncluded, false);
  assert.equal(second.copied.length, 2);
  assert.ok(second.copied.every(item => /-1\.(json|db)$/.test(item.target)));
  assert.equal(fs.existsSync(path.join(first.destination, 'Cookies')), false);
  assert.equal(fs.readFileSync(first.copied.find(item => item.source === legacyDatabasePath).target, 'utf8'), 'legacy-db-bytes');
});
