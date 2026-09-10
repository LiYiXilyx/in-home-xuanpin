import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';
import {createCatalogCampaignService} from '../../src/modules/catalog-scale/catalog-campaign-service.mjs';
import {createCatalogActivityRegistry} from '../../src/modules/catalog-scale/catalog-activity-registry.mjs';
const rows=db=>['catalog_campaigns','catalog_sources','catalog_rpa_queue','catalog_source_runs'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
async function setup(t){const f=await createInitialPoolFixture(t),activity=createCatalogActivityRegistry();
 f.service=createCatalogCampaignService(f.db,{now:f.now,activityRegistry:activity});
 const c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'one',requestId:'one'}),q=f.db.prepare('SELECT * FROM catalog_rpa_queue WHERE campaign_id=?').get(c.campaignId);
 return {...f,activity,c,q,input:{profile:f.profile,campaignId:c.campaignId,queueId:q.id,expectedClaimGeneration:q.claim_generation,requestId:'pause-one'}};}
test('pause releases exact Initial, preserves run metrics and resumes the same task with one new run',async t=>{
 const f=await setup(t);f.db.exec('UPDATE catalog_source_runs SET raw_observation_count=41');
 const result=f.service.pauseOperatorInitial(f.input);assert.equal(result.status,'paused');
 const q=f.db.prepare('SELECT * FROM catalog_rpa_queue').get();assert.equal(q.status,'pending');assert.equal(q.claim_token,null);
 assert.equal(f.service.getSource(q.source_id).status,'pending');const run=f.db.prepare('SELECT * FROM catalog_source_runs').get();assert.ok(run.finished_at);assert.equal(run.raw_observation_count,41);
 assert.equal(JSON.parse(q.checkpoint_json).capture_paused,true);assert.equal(JSON.parse(q.checkpoint_json).runner_state,'UNBOUND');
 const before=rows(f.db),changes=f.db.prepare('SELECT total_changes() n').get().n;
 assert.equal(f.service.pauseOperatorInitial(f.input).idempotentReplay,true);assert.deepEqual(rows(f.db),before);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
 assert.throws(()=>f.service.captureExtensionBatch({campaign_id:f.c.campaignId,source_id:q.source_id}),e=>e.code==='CAMPAIGN_NOT_ACTIVE');
 assert.equal(f.service.resolveOperatorEntry(f.profile).action,'CONTINUE_INITIAL');
 f.service.continueOperatorInitial({profile:f.profile,campaignId:f.c.campaignId,requestId:'resume'});
 assert.throws(()=>f.service.captureExtensionBatch({campaign_id:f.c.campaignId,source_id:q.source_id,page_binding:{bound_at:'2020-01-01T00:00:00Z'}}),e=>e.code==='CATALOG_BINDING_INVALIDATED');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM catalog_campaigns').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM catalog_source_runs').get().n,2);
 assert.throws(()=>f.service.pauseOperatorInitial({...f.input,requestId:'old-generation'}));
});
test('busy and scope/generation mismatches reject without any writes',async t=>{
 const f=await setup(t);
 for(const kind of ['capture','qa','activation','excel_export','worker','source_runner']){
  const token=f.activity.enter({campaignId:f.c.campaignId,queueId:f.q.id},kind),before=rows(f.db);
  assert.throws(()=>f.service.pauseOperatorInitial(f.input),e=>e.code==='CATALOG_TASK_BUSY');assert.deepEqual(rows(f.db),before);f.activity.leave(token);
 }
 for(const patch of [{queueId:'wrong'},{expectedClaimGeneration:99},{profile:{...f.profile,category_key:'other'}},{requestId:''}]){
  const before=rows(f.db);assert.throws(()=>f.service.pauseOperatorInitial({...f.input,...patch}));assert.deepEqual(rows(f.db),before);
 }
});
test('pause failure rolls back all status and claim changes',async t=>{
 const f=await setup(t);f.db.exec("CREATE TRIGGER fail_pause BEFORE UPDATE ON catalog_source_runs BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 const before=rows(f.db);assert.throws(()=>f.service.pauseOperatorInitial(f.input),/fixture failure/);assert.deepEqual(rows(f.db),before);
});
test('A to B to A reuses A and never creates duplicate Campaigns',async t=>{
 const f=await setup(t);f.service.pauseOperatorInitial(f.input);
 const bProfile={...f.profile,category_key:'fixture-other',category_profile_version:'fixture-other-v1'};
 const b=f.service.createOperatorInitialCampaign({profile:bProfile,campaignName:'B',requestId:'start-b'});
 assert.throws(()=>f.service.continueOperatorInitial({profile:f.profile,campaignId:f.c.campaignId,requestId:'premature-return'}),e=>e.code==='CATALOG_RPA_CLAIM_CONFLICT');
 const q=f.db.prepare('SELECT * FROM catalog_rpa_queue WHERE campaign_id=?').get(b.campaignId);
 f.service.pauseOperatorInitial({profile:bProfile,campaignId:b.campaignId,queueId:q.id,expectedClaimGeneration:q.claim_generation,requestId:'pause-b'});
 f.service.continueOperatorInitial({profile:f.profile,campaignId:f.c.campaignId,requestId:'return-a'});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM catalog_campaigns').get().n,2);
 assert.equal(f.service.currentOperatorManualContext().campaign.id,f.c.campaignId);
 assert.equal(f.service.getCampaign(b.campaignId).status,'paused');
});
