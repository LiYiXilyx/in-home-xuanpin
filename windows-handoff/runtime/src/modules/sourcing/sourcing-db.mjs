import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase,transaction } from '../../db/client.mjs';

const DEFAULT_MIGRATIONS=path.resolve('db/sourcing-migrations');

export function resolveSourcingDbPath(projectRoot=process.cwd()){
  const configured=process.env.SOURCING_DB_PATH??'./data/1688_sourcing.db';return path.resolve(projectRoot,configured);
}

export function migrateSourcingDatabase({databasePath=resolveSourcingDbPath(),migrationsDir=DEFAULT_MIGRATIONS,through=null}={}){
  const db=openDatabase(databasePath,{allowRunnerWrite:true});try{db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(filename TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT`);
    const available=fs.readdirSync(migrationsDir).filter(x=>/^\d+_.+\.sql$/.test(x)).sort();
    if(through!==null&&!available.includes(through))throw new Error(`sourcing migration through target not found: ${through}`);
    const filenames=through===null?available:available.slice(0,available.indexOf(through)+1);
    const applied=[];for(const filename of filenames){
      const sql=fs.readFileSync(path.join(migrationsDir,filename),'utf8'),checksum=crypto.createHash('sha256').update(sql).digest('hex');
      const existing=db.prepare('SELECT checksum FROM schema_migrations WHERE filename=?').get(filename);if(existing){if(existing.checksum!==checksum)throw new Error(`sourcing migration checksum mismatch: ${filename}`);continue;}
      transaction(db,()=>{db.exec(sql);db.prepare('INSERT INTO schema_migrations(filename,checksum,applied_at) VALUES(?,?,?)').run(filename,checksum,new Date().toISOString());});applied.push(filename);
    }return {databasePath:path.resolve(databasePath),applied,integrity:db.prepare('PRAGMA integrity_check').get().integrity_check};
  }finally{db.close();}}

export function inspectSourcingDatabase(databasePath=resolveSourcingDbPath()){
  if(!fs.existsSync(databasePath))return {exists:false,databasePath:path.resolve(databasePath),integrity:null,schemaVersion:0,pendingRuns:0};
  const db=openDatabase(databasePath,{readOnly:true});try{const hasRuns=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sourcing_runs'").get();return {exists:true,databasePath:path.resolve(databasePath),integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,
    schemaVersion:Number(db.prepare('PRAGMA user_version').get().user_version),pendingRuns:hasRuns?Number(db.prepare("SELECT COUNT(*) n FROM sourcing_runs WHERE status IN ('PENDING','RUNNING','WAITING_FOR_HUMAN')").get().n):0,
    runCount:hasRuns?Number(db.prepare('SELECT COUNT(*) n FROM sourcing_runs').get().n):0};}finally{db.close();}}
