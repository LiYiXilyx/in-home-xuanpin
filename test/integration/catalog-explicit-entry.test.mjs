import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';

function rows(db){return db.prepare('SELECT * FROM catalog_campaigns ORDER BY id').all();}
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
