import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';

function rows(db){return db.prepare('SELECT * FROM catalog_campaigns ORDER BY id').all();}
function allRows(db){return ['catalog_campaigns','catalog_sources','catalog_rpa_queue','catalog_source_runs'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());}
test('completed Initial without pool cannot bypass entry through create endpoint',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'old',requestId:'old'});
 f.db.prepare("UPDATE catalog_campaigns SET status='completed' WHERE id=?").run(c.campaignId);
 f.db.exec("UPDATE catalog_rpa_queue SET status='completed',claim_token=NULL; UPDATE catalog_sources SET status='completed'");
 const before=allRows(f.db);assert.throws(()=>f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'new',requestId:'new'}));assert.deepEqual(allRows(f.db),before);
});
test('running Initial with no claim is blocked in read-only entry',async t=>{
 const f=await createInitialPoolFixture(t);f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'no-claim',requestId:'no-claim'});
 f.db.exec('UPDATE catalog_rpa_queue SET claim_token=NULL');assert.equal(f.service.resolveOperatorEntry(f.profile).action,'BLOCKED');
});
test('manual_required without claim or unfinished run creates one run and clears binding',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'manual',requestId:'manual'});
 f.db.exec("UPDATE catalog_campaigns SET status='manual_required'; UPDATE catalog_sources SET status='manual_required'; UPDATE catalog_source_runs SET finished_at='2026-09-01T00:00:00Z'; UPDATE catalog_rpa_queue SET status='manual_required',claim_token=NULL,checkpoint_json='{\"binding_generation\":2,\"context_fingerprint\":\"old\",\"automatic_scroll\":true}'");
 f.service.continueOperatorInitial({profile:f.profile,campaignId:c.campaignId,requestId:'continue'});
 const runs=f.db.prepare('SELECT run_number,finished_at FROM catalog_source_runs ORDER BY run_number').all();assert.equal(runs.length,2);assert.equal(runs[1].run_number,2);assert.equal(runs[1].finished_at,null);
 const checkpoint=f.service.currentOperatorManualContext().queue.checkpoint;assert.equal(checkpoint.binding_generation,undefined);assert.equal(checkpoint.context_fingerprint,undefined);assert.equal(checkpoint.automatic_scroll,false);assert.equal(checkpoint.capture_paused,true);
});
test('entry blocks corrupted source category before offering continuation without writes',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'scope',requestId:'scope'});
 f.db.prepare("UPDATE catalog_sources SET category_key='foreign' WHERE campaign_id=?").run(c.campaignId);
 const before=allRows(f.db),changes=f.db.prepare('SELECT total_changes() n').get().n;
 assert.equal(f.service.resolveOperatorEntry(f.profile).action,'BLOCKED');
 assert.throws(()=>f.service.continueOperatorInitial({profile:f.profile,campaignId:c.campaignId,requestId:'continue'}));
 assert.deepEqual(allRows(f.db),before);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
});
test('entry rejects frozen profile scope drift even with the same version',async t=>{
 const f=await createInitialPoolFixture(t);f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'scope',requestId:'scope'});
 const profile={...f.profile,membership_scope:{...f.profile.membership_scope,subcategory:'Foreign'}};
 assert.equal(f.service.resolveOperatorEntry(profile).action,'BLOCKED');
});
test('continuation replay refuses noncapturing children instead of replaying stale success',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'scope',requestId:'scope'});
 const input={profile:f.profile,campaignId:c.campaignId,requestId:'continue'};f.service.continueOperatorInitial(input);
 f.db.prepare("UPDATE catalog_sources SET status='manual_required' WHERE campaign_id=?").run(c.campaignId);
 const before=allRows(f.db);assert.throws(()=>f.service.continueOperatorInitial(input));assert.deepEqual(allRows(f.db),before);
});
test('continuation rollback and terminal replay never leave partial changes',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'entry',requestId:'entry'});
 f.db.prepare("UPDATE catalog_campaigns SET status='paused' WHERE id=?").run(c.campaignId);
 f.db.prepare('UPDATE catalog_rpa_queue SET claim_token=NULL WHERE campaign_id=?').run(c.campaignId);
 f.db.exec("CREATE TRIGGER block_continue BEFORE UPDATE ON catalog_sources BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
 const before=allRows(f.db),input={profile:f.profile,campaignId:c.campaignId,requestId:'c'};
 assert.throws(()=>f.service.continueOperatorInitial(input),/fixture rollback/);assert.deepEqual(allRows(f.db),before);
 f.db.exec('DROP TRIGGER block_continue');f.service.continueOperatorInitial(input);
 f.db.prepare("UPDATE catalog_campaigns SET status='cancelled' WHERE id=?").run(c.campaignId);
 const terminal=allRows(f.db);assert.throws(()=>f.service.continueOperatorInitial(input));assert.deepEqual(allRows(f.db),terminal);
});
test('paused exact Initial without claim continues atomically and request replay writes nothing',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'entry',requestId:'entry'});
 f.db.prepare("UPDATE catalog_campaigns SET status='paused' WHERE id=?").run(c.campaignId);
 f.db.prepare("UPDATE catalog_rpa_queue SET claim_token=NULL WHERE campaign_id=?").run(c.campaignId);
 const originalRun=f.db.prepare('SELECT id FROM catalog_source_runs').get().id;
 const input={profile:f.profile,campaignId:c.campaignId,requestId:'continue'};
 const result=f.service.continueOperatorInitial(input);
 assert.equal(result.campaignId,c.campaignId);
 const context=f.service.currentOperatorManualContext();
 assert.equal(context.campaign.status,'running');assert.equal(context.queue.status,'capturing');assert.equal(context.source.status,'capturing');
 assert.equal(context.queue.checkpoint.runner_state,'UNBOUND');assert.equal(context.queue.checkpoint.capture_paused,true);
 assert.equal(f.db.prepare('SELECT id FROM catalog_source_runs WHERE finished_at IS NULL').get().id,originalRun);
 const before=allRows(f.db);f.service.continueOperatorInitial(input);assert.deepEqual(allRows(f.db),before);
});
test('running same claim continuation creates no new run and foreign claim blocks with zero writes',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'entry',requestId:'entry'});
 const q=f.db.prepare('SELECT claim_token,claim_generation FROM catalog_rpa_queue').get(),run=f.db.prepare('SELECT * FROM catalog_source_runs').all();
 f.service.continueOperatorInitial({profile:f.profile,campaignId:c.campaignId,requestId:'continue'});
 assert.deepEqual(f.db.prepare('SELECT claim_token,claim_generation FROM catalog_rpa_queue').get(),q);assert.deepEqual(f.db.prepare('SELECT * FROM catalog_source_runs').all(),run);
 const other=f.service.createCampaign({profile:{...f.profile,category_key:'other'},name:'foreign',campaignType:'test',targetCount:1});
 f.service.createSource(other.id,{sourceKey:'foreign',sourceType:'category',sortOrder:'Top Sales'});
 f.db.prepare("UPDATE catalog_rpa_queue SET status='capturing',claim_token='foreign' WHERE campaign_id=?").run(other.id);
 f.db.prepare("UPDATE catalog_campaigns SET status='paused' WHERE id=?").run(c.campaignId);
 const before=allRows(f.db);
 assert.throws(()=>f.service.continueOperatorInitial({profile:f.profile,campaignId:c.campaignId,requestId:'conflict'}),e=>e.code==='CATALOG_RPA_CLAIM_CONFLICT'&&Boolean(e.details?.all_blockers?.length||e.details?.allBlockers?.length));
 assert.deepEqual(allRows(f.db),before);
});
test('entry reads never create or resume an Initial',async t=>{
 const f=await createInitialPoolFixture(t),before=rows(f.db);
 assert.equal(f.service.resolveOperatorEntry(f.profile).action,'START_INITIAL');
 assert.deepEqual(rows(f.db),before);
 const c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'entry',requestId:'entry'});
 const after=rows(f.db),entry=f.service.resolveOperatorEntry(f.profile);
 assert.equal(entry.action,'CONTINUE_INITIAL');assert.equal(entry.campaign_id,c.campaignId);assert.deepEqual(rows(f.db),after);
});
test('Active Pool never hides an unfinished Initial',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'entry',requestId:'entry'});
 f.db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,status,product_count,non_electronic_unique_count,created_at,updated_at) VALUES('p',?,?,?,'active',0,0,?,?)`).run(c.campaignId,f.profile.category_key,f.profile.category_profile_version,f.now(),f.now());
 assert.equal(f.service.resolveOperatorEntry(f.profile).action,'BLOCKED');
});
test('scope mismatch and pool history fail closed',async t=>{
 const f=await createInitialPoolFixture(t),c=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'entry',requestId:'entry'});
 assert.equal(f.service.resolveOperatorEntry({...f.profile,category_profile_version:'other'}).action,'BLOCKED');
 f.db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,status,product_count,non_electronic_unique_count,created_at,updated_at) VALUES('p',?,?,?,'superseded',0,0,?,?)`).run(c.campaignId,f.profile.category_key,f.profile.category_profile_version,f.now(),f.now());
 assert.equal(f.service.resolveOperatorEntry(f.profile).action,'BLOCKED');
});
