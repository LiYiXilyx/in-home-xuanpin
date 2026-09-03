import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateSourcingDatabase} from '../../src/modules/sourcing/sourcing-db.mjs';
import {openDatabase} from '../../src/db/client.mjs';

test('market evidence migration is additive and enforces ownership/lifecycle constraints',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'market-evidence-migration-')),databasePath=path.join(dir,'sourcing.db');
  try {
    const result=migrateSourcingDatabase({databasePath});
    assert.ok(result.applied.includes('005_temu_market_evidence_mvp_v1.sql'));
    const db=openDatabase(databasePath,{allowRunnerWrite:true});
    try {
      const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'temu_market_evidence%' OR name='temu_manual_price_assessments' ORDER BY name").all().map(x=>x.name);
      assert.deepEqual(tables,['temu_manual_price_assessments','temu_market_evidence_phases','temu_market_evidence_requests','temu_market_evidence_sessions']);
      assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='temu_market_evidence_sessions'").get().sql,/BEFORE_CAPTURED/);
      assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='temu_market_evidence_phases'").get().sql,/CREATING/);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    } finally { db.close(); }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
