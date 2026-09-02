import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';
import {createCatalogClaimRecoveryRepository} from '../../src/db/repositories/catalog-claim-recovery-repository.mjs';
import {createCatalogClaimInspectionService} from '../../src/modules/catalog-scale/catalog-claim-inspection.mjs';
import {createCatalogClaimRecoveryService} from '../../src/modules/catalog-scale/catalog-claim-recovery-service.mjs';
import {createCatalogActivityRegistry} from '../../src/modules/catalog-scale/catalog-activity-registry.mjs';
import {resolveClaimRecoveryThresholds} from '../../src/modules/catalog-scale/catalog-claim-stale-policy.mjs';

test('confirmed stale claim ends atomically, audits once, and request replay is idempotent',async t=>{
  const f=await fixture(t),before=protectedFingerprint(f.db),input=terminationInput(f);
  const ended=f.recovery.endStaleClaim(input);
  assert.equal(ended.idempotentReplay,false);assert.deepEqual(statuses(f.db,f),{campaign:'cancelled',queue:'cancelled',source:'cancelled',runFinished:true});
  assert.equal(f.db.prepare('SELECT termination_reason FROM catalog_rpa_claim_termination_audits').get().termination_reason,'STALE_CLAIM_ENDED_BY_OPERATOR');
  assert.equal(f.db.prepare('SELECT stop_reason FROM catalog_source_runs WHERE source_id=?').get(f.source.id).stop_reason,'STALE_CLAIM_ENDED_BY_OPERATOR');
  assert.deepEqual(protectedFingerprint(f.db),before);
  const replay=f.recovery.endStaleClaim(input);assert.equal(replay.idempotentReplay,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) count FROM catalog_rpa_claim_termination_audits').get().count,1);
});

test('changed claim or fault injection performs zero partial terminalization',async t=>{
  const changed=await fixture(t);changed.db.prepare('UPDATE catalog_rpa_queue SET claim_generation=claim_generation+1 WHERE id=?').run(changed.queue.id);
  const beforeChanged=statuses(changed.db,changed);assert.throws(()=>changed.recovery.endStaleClaim(terminationInput(changed)),error=>error.code==='STALE_CLAIM_NOT_CONFIRMED');assert.deepEqual(statuses(changed.db,changed),beforeChanged);
  const fault=await fixture(t,{afterQueue:()=>{throw new Error('fixture fault');}}),before=statuses(fault.db,fault);
  assert.throws(()=>fault.recovery.endStaleClaim(terminationInput(fault)),/fixture fault/);assert.deepEqual(statuses(fault.db,fault),before);
  assert.equal(fault.db.prepare('SELECT COUNT(*) count FROM catalog_rpa_claim_termination_audits').get().count,0);
});

async function fixture(t,hooks={}){const f=await createInitialPoolFixture(t),campaign=f.service.createCampaign({name:`termination-${Math.random()}`,campaignType:'test',profile:f.profile,targetCount:10}),source=f.service.createSource(campaign.id,{sourceKey:'top',sourceType:'category',sortOrder:'Top Sales',targetQuota:10});f.service.transitionCampaign(campaign.id,'running');const claimed=f.service.claimNextSource(campaign.id);f.service.transitionCampaign(campaign.id,'paused');const queue=claimed.queue;f.db.prepare("UPDATE catalog_rpa_queue SET heartbeat_at='2026-08-30T00:00:00.000Z',updated_at='2026-08-30T00:00:00.000Z',checkpoint_json=? WHERE id=?").run(JSON.stringify({runner_state:'PAUSED',capture_paused:true,accepted_unique:10}),queue.id);let clock=Date.parse('2026-09-02T00:00:00.000Z');const now=()=>new Date(clock).toISOString(),repository=createCatalogClaimRecoveryRepository(f.db,{now}),activity=createCatalogActivityRegistry(),thresholds=resolveClaimRecoveryThresholds({}),inspection=createCatalogClaimInspectionService({repository,activityRegistry:activity,thresholds,now});const first=inspection.inspect({campaignId:campaign.id});clock+=10000;const second=inspection.inspect({campaignId:campaign.id,previousInspectionId:first.id});assert.equal(second.determination,'STALE_CONFIRMED');const recovery=createCatalogClaimRecoveryService({repository,inspectionService:inspection,activityRegistry:activity,now,hooks});return{...f,campaign,source,queue,first,second,recovery};}
function terminationInput(f){return{campaignId:f.campaign.id,queueId:f.queue.id,sourceId:f.source.id,firstInspectionId:f.first.id,secondInspectionId:f.second.id,expectedClaimToken:f.queue.claimToken,expectedClaimGeneration:f.second.claimGeneration,requestId:`end-${f.campaign.id}`,operatorConfirmation:'END_STALE_CLAIM'};}
function statuses(db,f){return{campaign:db.prepare('SELECT status FROM catalog_campaigns WHERE id=?').get(f.campaign.id).status,queue:db.prepare('SELECT status FROM catalog_rpa_queue WHERE id=?').get(f.queue.id).status,source:db.prepare('SELECT status FROM catalog_sources WHERE id=?').get(f.source.id).status,runFinished:Boolean(db.prepare('SELECT finished_at FROM catalog_source_runs WHERE source_id=?').get(f.source.id).finished_at)};}
function protectedFingerprint(db){return Object.fromEntries(['products','catalog_memberships','catalog_pool_versions','catalog_pool_version_items','product_snapshots','catalog_staging_products','catalog_capture_batches'].map(table=>[table,db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count]));}
