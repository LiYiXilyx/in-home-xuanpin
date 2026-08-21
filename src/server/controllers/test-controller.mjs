import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { transaction } from '../../db/client.mjs';
import { AppError } from '../../shared/errors.mjs';

const RESET_PHRASE='RESET_TEST_DATA';
const ACTIVE_JOB_STATUSES=new Set(['pending','running','paused','interrupted']);
const DATA_TABLES=[
  'product_classifications','data_quality_checks','scrape_errors','product_images','product_snapshots',
  'catalog_memberships','crawl_job_items','crawl_events','crawl_jobs','products'
];

export function createTestController({ config,db,service,exportController }) {
  const safety=validateTestPaths(config);
  if (safety.testMode) {
    fs.mkdirSync(safety.imageCacheDir,{ recursive:true });
    fs.mkdirSync(safety.backupDir,{ recursive:true });
  }
  return {
    isTestMode:safety.testMode,
    async reset({ confirmed=false,phrase='' }={}) {
      if (!safety.testMode) throw new AppError('正式模式禁止重置数据库。',{ code:'TEST_MODE_REQUIRED' });
      if (confirmed !== true || phrase !== RESET_PHRASE) {
        throw new AppError('重置测试数据需要二次确认。',{ code:'TEST_RESET_CONFIRMATION_REQUIRED' });
      }
      const active=service.list({ limit:100 }).find(job => job.jobType === 'catalog' && ACTIVE_JOB_STATUSES.has(job.status));
      if (active) throw new AppError('测试采集任务仍在运行，请先安全暂停或取消后再重置。',{ code:'TEST_RESET_JOB_ACTIVE' });

      await fsp.mkdir(safety.backupDir,{ recursive:true });
      const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','-').replace('Z','').replace('.','-');
      const databaseBackup=path.join(safety.backupDir,`test-db-before-reset-${stamp}.db`);
      db.exec('PRAGMA wal_checkpoint(FULL)');
      db.exec(`VACUUM INTO '${databaseBackup.replaceAll("'","''")}'`);

      let outputBackup=null;
      if (fs.existsSync(safety.outputDir)) {
        outputBackup=path.join(safety.backupDir,`test-output-before-reset-${stamp}`);
        await fsp.rename(safety.outputDir,outputBackup);
      }

      transaction(db,() => {
        const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
        for (const table of DATA_TABLES) if (existing.has(table)) db.exec(`DELETE FROM ${table}`);
        if (existing.has('sqlite_sequence')) db.exec("DELETE FROM sqlite_sequence WHERE name <> 'schema_migrations'");
      });
      const empty=await exportController.clearExcel({ confirmed:true });
      await fsp.mkdir(safety.imageCacheDir,{ recursive:true });
      return {
        reset:true,activeProducts:0,jobs:0,emptyWorkbook:Boolean(empty.emptyWorkbook),
        databaseBackup:path.basename(databaseBackup),outputBackup:outputBackup ? path.basename(outputBackup):null,
        message:'测试数据已重置为 0；测试数据库和测试输出已备份，正式数据库未触碰。'
      };
    }
  };
}

function validateTestPaths(config) {
  const testMode=config.app.environment === 'test';
  if (!testMode) return { testMode:false,databasePath:null,outputDir:null,imageCacheDir:null,backupDir:null };
  const base=path.dirname(config.configPath);
  const expectedDataRoot=path.resolve(base,'data','test');
  const expectedOutputRoot=path.resolve(base,'outputs','test-run');
  const expectedBackupRoot=path.resolve(base,'backups','test');
  const databasePath=path.resolve(config.app.databasePath);
  const outputDir=path.resolve(config.export.outputDir);
  const imageCacheDir=path.resolve(config.export.imageCacheDir);
  const backupDir=path.resolve(config.app.backupDir);
  if (!inside(databasePath,expectedDataRoot) || outputDir !== expectedOutputRoot
    || !inside(imageCacheDir,expectedOutputRoot) || backupDir !== expectedBackupRoot) {
    throw new AppError('测试模式路径不安全，已拒绝启动。',{ code:'TEST_PATH_SAFETY_REJECTED' });
  }
  return { testMode,databasePath,outputDir,imageCacheDir,backupDir };
}

function inside(target,root) { return target === root || target.startsWith(`${root}${path.sep}`); }
