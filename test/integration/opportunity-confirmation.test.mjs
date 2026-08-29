import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createOpportunityConfirmationRepository } from '../../src/db/repositories/opportunity-confirmation-repository.mjs';
import { createOpportunityConfirmationService } from '../../src/modules/opportunity/opportunity-confirmation-service.mjs';

test('confirmation gate is audited, idempotent and fail-closed for Track B and Track C',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-opportunity-confirmation-')),databasePath=path.join(directory,'v2.db');
  migrateDatabase({databasePath});const db=openDatabase(databasePath);t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});seed(db);
  let clock=0;const now=()=>`2026-08-29T0${clock++}:00:00.000Z`,service=createOpportunityConfirmationService(db,{now}),repository=createOpportunityConfirmationRepository(db,{now});
  const identity={snapshotId:'snapshot-1',candidateId:101,goodsId:'601099000000001',platform:'temu'};
  assert.deepEqual(service.listCandidates('snapshot-1').counts,{approved:0,rejected:0,needs_more_evidence:0,unconfirmed:3});
  assert.deepEqual(service.checkEligibility(identity),{approved:false,reason:'UNCONFIRMED',decision:null,confirmationId:null});
  assert.equal(service.isOpportunityApproved(identity),false);

  const approved=service.confirmCandidate({...identity,decision:'approved',reason:'人工确认低风险',reviewedBy:'operator'});
  assert.equal(approved.changed,true);assert.equal(service.isOpportunityApproved(identity),true);assert.equal(service.checkEligibility(identity).reason,'APPROVED');
  const repeated=service.confirmCandidate({...identity,decision:'approved',reason:'人工确认低风险',reviewedBy:'operator'});
  assert.equal(repeated.idempotent,true);assert.equal(repository.listEvents('snapshot-1',101).length,1);

  const rejected=service.confirmCandidate({...identity,decision:'rejected',reason:'人工复核后拒绝',reviewedBy:'operator'});
  assert.equal(rejected.previousDecision,'approved');assert.equal(service.isOpportunityApproved(identity),false);assert.equal(service.checkEligibility(identity).reason,'REJECTED');
  assert.deepEqual(repository.listEvents('snapshot-1',101).map(x=>[x.previousDecision,x.decision]),[[null,'approved'],['approved','rejected']]);

  const evidenceIdentity={snapshotId:'snapshot-1',candidateId:102,goodsId:'601099000000002',platform:'temu'};
  service.confirmCandidate({...evidenceIdentity,decision:'needs_more_evidence',reason:'需要更多适配证据',reviewedBy:'operator'});
  assert.equal(service.checkEligibility(evidenceIdentity).reason,'NEEDS_MORE_EVIDENCE');
  assert.equal(service.isOpportunityApproved({snapshotId:'snapshot-1',candidateId:103,goodsId:'601099000000003'}),false);
  assert.deepEqual(repository.counts('snapshot-1'),{approved:0,rejected:1,needs_more_evidence:1,unconfirmed:1});

  assert.throws(()=>service.confirmCandidate({...identity,decision:'maybe',reason:'x',reviewedBy:'operator'}),error=>error.code==='INVALID_DECISION');
  assert.throws(()=>service.confirmCandidate({...identity,goodsId:'601099000000009',decision:'approved',reason:'x',reviewedBy:'operator'}),error=>error.code==='GOODS_ID_MISMATCH');
  assert.throws(()=>service.confirmCandidate({...identity,snapshotId:'snapshot-2',decision:'approved',reason:'x',reviewedBy:'operator'}),error=>error.code==='SNAPSHOT_CANDIDATE_MISMATCH');
  assert.equal(service.checkEligibility({...identity,candidateId:999}).reason,'CANDIDATE_NOT_FOUND');
  assert.equal(service.checkEligibility({...identity,snapshotId:'missing'}).reason,'SNAPSHOT_NOT_FOUND');
  assert.equal(service.checkEligibility({...identity,goodsId:'bad'}).reason,'INVALID_IDENTITY');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM review_queue').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM sourcing_runs').get().n,0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

function seed(db){const at='2026-08-29T00:00:00.000Z';db.prepare(`INSERT INTO catalog_campaigns(id,name,campaign_type,category_key,category_profile_version,target_count,created_at,updated_at)
  VALUES('campaign-1','Confirmation fixture','test','motorcycle-accessories','v1',1,?,?)`).run(at,at);db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,product_count,non_electronic_unique_count,status,created_at,updated_at)
  VALUES('pool-1','campaign-1','motorcycle-accessories','v1',3,3,'active',?,?)`).run(at,at);for(const id of ['snapshot-1','snapshot-2'])db.prepare(`INSERT INTO opportunity_analysis_snapshots(id,source_pool_version_id,source_campaign_id,source_pool_count,category_key,site_country,language,currency,sort_context,status,generated_at)
  VALUES(?,'pool-1','campaign-1',3,'motorcycle-accessories','DE','en','EUR','Top Sales','awaiting_confirmation',?)`).run(id,at);const insert=db.prepare(`INSERT INTO opportunity_product_candidates(id,snapshot_id,platform,goods_id,product_type,tier,candidate_rank,product_score,estimated_gmv,next_validation_action,created_at)
  VALUES(?,'snapshot-1','temu',?,'test-product','CAUTION_WATCH',?,?,100,'人工确认',?)`);for(let i=1;i<=3;i++)insert.run(100+i,`60109900000000${i}`,i,80-i,at);}
