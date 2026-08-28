import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(databasePath, { readOnly = false, allowRunnerWrite = false } = {}) {
  if (!readOnly && String(process.env.MACHINE_ROLE ?? '').trim().toUpperCase() === '1688_RUNNER' && !allowRunnerWrite) {
    throw new Error(`1688_RUNNER 禁止打开可写数据库：${path.resolve(databasePath)}`);
  }
  if (databasePath !== ':memory:' && !readOnly) fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath, { readOnly });
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (!readOnly && databasePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  return db;
}

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
