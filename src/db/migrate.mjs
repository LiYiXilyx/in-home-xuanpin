import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../config/load.mjs';
import { MigrationError } from '../shared/errors.mjs';
import { openDatabase, transaction } from './client.mjs';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export function migrateDatabase({ databasePath, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
  const db = openDatabase(databasePath);
  try {
    bootstrapMigrationTable(db);
    const files = fs.readdirSync(migrationsDir).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
    const applied = [];
    const skipped = [];
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existing = db.prepare('SELECT checksum FROM schema_migrations WHERE filename = ?').get(filename);
      if (existing) {
        if (existing.checksum !== checksum) {
          throw new MigrationError(`已执行迁移 ${filename} 的校验和发生变化，已停止。`, {
            code: 'MIGRATION_CHECKSUM_MISMATCH', details: { filename, expected: existing.checksum, actual: checksum }
          });
        }
        skipped.push(filename);
        continue;
      }
      const startedAt = Date.now();
      const foreignKeysOff = /^--\s*migrate:\s*foreign_keys=off\s*$/im.test(sql);
      try {
        if (foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
        transaction(db, () => {
          db.exec(sql);
          if (foreignKeysOff) {
            const violation = db.prepare('PRAGMA foreign_key_check').get();
            if (violation) throw new Error(`外键完整性检查失败：${JSON.stringify(violation)}`);
          }
          db.prepare('INSERT INTO schema_migrations(filename, checksum, applied_at, execution_ms) VALUES(?,?,?,?)')
            .run(filename, checksum, new Date().toISOString(), Date.now() - startedAt);
        });
      } catch (error) {
        throw new MigrationError(`迁移 ${filename} 执行失败。`, { details: { filename }, cause: error });
      } finally {
        if (foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
      }
      applied.push(filename);
    }
    return { databasePath: path.resolve(databasePath), total: files.length, applied, skipped };
  } finally {
    db.close();
  }
}

export function getMigrationStatus({ databasePath, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
  const known = fs.readdirSync(migrationsDir).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
  if (!fs.existsSync(databasePath)) return { databasePath: path.resolve(databasePath), exists: false, known, applied: [], pending: known };
  const db = openDatabase(databasePath, { readOnly: true });
  try {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const applied = table ? db.prepare('SELECT filename, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY filename').all() : [];
    const appliedNames = new Set(applied.map(item => item.filename));
    return { databasePath: path.resolve(databasePath), exists: true, known, applied, pending: known.filter(file => !appliedNames.has(file)) };
  } finally {
    db.close();
  }
}

function bootstrapMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    execution_ms INTEGER NOT NULL CHECK(execution_ms >= 0)
  ) STRICT`);
}

function parseArgs(argv) {
  const result = { config: 'config.json', status: false };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--config') result.config = argv[++index];
    else if (argv[index] === '--status') result.status = true;
    else throw new Error(`未知参数：${argv[index]}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadConfig(args.config);
  const result = args.status
    ? getMigrationStatus({ databasePath: config.app.databasePath })
    : migrateDatabase({ databasePath: config.app.databasePath });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`${error.code ?? 'MIGRATION_ERROR'}: ${error.message}`);
    process.exitCode = 1;
  });
}
