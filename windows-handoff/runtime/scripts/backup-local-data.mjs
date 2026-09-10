import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config/load.mjs';

export async function backupLocalData({ configPath = 'config.json', now = () => new Date() } = {}) {
  const absoluteConfigPath = path.resolve(configPath);
  const config = await loadConfig(absoluteConfigPath);
  const stamp = now().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const destination = path.join(config.app.backupDir, stamp);
  fs.mkdirSync(destination, { recursive: true });

  const report = { destination, copied: [], skipped: [], browserProfileIncluded: false };
  for (const source of [absoluteConfigPath, config.app.legacyDatabasePath]) {
    if (!fs.existsSync(source)) {
      report.skipped.push({ source, reason: 'not_found' });
      continue;
    }
    const target = uniqueTarget(destination, path.basename(source));
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    const sourceHash = sha256File(source);
    const targetHash = sha256File(target);
    if (sourceHash !== targetHash) throw new Error(`备份校验失败：${source}`);
    report.copied.push({ source, target, sha256: sourceHash, bytes: fs.statSync(source).size });
  }
  fs.writeFileSync(path.join(destination, 'backup-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function uniqueTarget(directory, basename) {
  const initial = path.join(directory, basename);
  if (!fs.existsSync(initial)) return initial;
  const extension = path.extname(basename);
  const stem = path.basename(basename, extension);
  let counter = 1;
  while (fs.existsSync(path.join(directory, `${stem}-${counter}${extension}`))) counter += 1;
  return path.join(directory, `${stem}-${counter}${extension}`);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseArgs(argv) {
  const result = { configPath: 'config.json' };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--config') result.configPath = argv[++index];
    else throw new Error(`未知参数：${argv[index]}`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  backupLocalData(parseArgs(process.argv)).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(`BACKUP_FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
