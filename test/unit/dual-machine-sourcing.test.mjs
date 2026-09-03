import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../../src/db/client.mjs';
import { MACHINE_ROLES,assertTemuMutationAllowed } from '../../src/modules/sourcing/machine-role.mjs';
import { createInputPackage,validateInputPackage } from '../../src/modules/sourcing/input-package.mjs';
import { acquireRunLock } from '../../src/modules/sourcing/run-lock.mjs';
import { migrateSourcingDatabase } from '../../src/modules/sourcing/sourcing-db.mjs';
import { packRunResult,auditResultPackage } from '../../src/modules/sourcing/result-package.mjs';
import { runnerPreflight } from '../../src/modules/sourcing/runner-service.mjs';

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'dual-1688-'));}
function withRole(role,fn){const before=process.env.MACHINE_ROLE;process.env.MACHINE_ROLE=role;return Promise.resolve().then(fn).finally(()=>{if(before===undefined)delete process.env.MACHINE_ROLE;else process.env.MACHINE_ROLE=before;});}

test('runner cannot mutate Temu and development cannot start formal sourcing',async()=>{
  await withRole(MACHINE_ROLES.RUNNER,()=>{assert.throws(()=>assertTemuMutationAllowed('test'),/禁止修改 Temu/);assert.throws(()=>openDatabase(path.join(temp(),'temu.db')),/禁止打开可写数据库/);});
  await withRole(MACHINE_ROLES.DEVELOPMENT,()=>assert.rejects(()=>runnerPreflight({runId:'test-run',target:1,temuDbPath:'missing.db',checkChrome:false}),/仅允许 1688_RUNNER/));
});

test('input package is self-contained, hashed and identity-unique',async()=>{
  const sharp=(await import('sharp')).default,root=temp(),image=path.join(root,'source.jpg');await sharp({create:{width:4,height:3,channels:3,background:'#336699'}}).jpeg().toFile(image);
  const inputDir=path.join(root,'input','run-001'),created=await createInputPackage({runId:'run-001',gitCommit:'abc123',inputDir,goods:[{temu_goods_id:'g1',temu_title:'车罩',temu_image_path:image,level1:'户外'}]});
  const checked=await validateInputPackage(inputDir,{expectedRunId:'run-001',expectedTarget:1});assert.equal(checked.goods[0].temu_image_sha256,created.goods[0].temu_image_sha256);assert.ok(fs.existsSync(path.join(inputDir,checked.goods[0].temu_image_path)));
  await assert.rejects(()=>createInputPackage({runId:'run-002',gitCommit:'abc',inputDir:path.join(root,'other'),goods:[{temu_goods_id:'x',temu_title:'a',temu_image_path:image},{temu_goods_id:'x',temu_title:'b',temu_image_path:image}]}),/重复/);
});

test('run lock and sourcing run are append-only by run id',()=>{
  const root=temp(),lock=path.join(root,'run.lock');acquireRunLock(lock,{runId:'run-001',gitCommit:'abc'});assert.throws(()=>acquireRunLock(lock,{runId:'run-001',gitCommit:'abc'}),/已存在/);
  const databasePath=path.join(root,'1688.db'),result=migrateSourcingDatabase({databasePath});assert.equal(result.integrity,'ok');const db=openDatabase(databasePath);try{const now=new Date().toISOString(),values=['run-001','abc','1688_RUNNER','runner',now,1,0,1,'hash',now,now];const insert=db.prepare(`INSERT INTO sourcing_runs(run_id,git_commit_sha,machine_role,machine_name,started_at,status,input_count,processed_count,target_count,input_manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,'RUNNING',?,?,?,?,?,?)`);insert.run(...values);assert.throws(()=>insert.run(...values),/UNIQUE/);assert.equal(db.prepare('PRAGMA user_version').get().user_version,5);assert.equal(db.prepare('SELECT method FROM sourcing_runs').get().method,'NATIVE_1688_IMAGE_SEARCH');}finally{db.close();}
});

test('result ZIP is deterministic, allowlisted and auditable',()=>{
  const root=temp(),runDir=path.join(root,'result');fs.mkdirSync(path.join(runDir,'screenshots'),{recursive:true});
  fs.writeFileSync(path.join(runDir,'run-summary.json'),JSON.stringify({run_id:'run-001',status:'PARTIAL'}));fs.writeFileSync(path.join(runDir,'candidates.jsonl'),`${JSON.stringify({run_id:'run-001',temu_goods_id:'g1',candidate_rank:1})}\n`);fs.writeFileSync(path.join(runDir,'runner.log'),`${JSON.stringify({timestamp:'2026-01-01T00:00:00Z',run_id:'run-001',goods_id:'g1',step:'SEARCH',status:'OK',error:null})}\n`);fs.writeFileSync(path.join(runDir,'screenshots','g1-result.png'),'png');
  const a=path.join(root,'a.zip'),b=path.join(root,'b.zip');packRunResult({runDir,outputPath:a});packRunResult({runDir,outputPath:b});const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.equal(digest(a),digest(b));const audit=auditResultPackage(a);assert.equal(audit.valid,true);assert.equal(audit.candidate_count,1);
  fs.writeFileSync(path.join(runDir,'secrets.db'),'x');assert.throws(()=>packRunResult({runDir,outputPath:path.join(root,'bad.zip')}),/非白名单/);
});
