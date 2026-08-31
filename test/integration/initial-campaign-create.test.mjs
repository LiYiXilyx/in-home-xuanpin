import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPoolFixture, databaseFingerprint } from '../fixtures/initial-category-pool-fixture.mjs';
import { createJobRepository } from '../../src/db/repositories/job-repository.mjs';

const input = profile => ({ profile, campaignName: 'Fixture Initial', requestId: 'initial-create-1' });

test('eligible no-Pool Category creates one open-ended UNBOUND Initial Campaign atomically', async t => {
  const f = await createInitialPoolFixture(t);
  const result = f.service.createOperatorInitialCampaign(input(f.profile));
  assert.equal(result.campaignType, 'initial');
  assert.equal(result.baselineCount, 0);
  assert.equal(result.targetCount, null);
  assert.equal(result.remaining, null);
  assert.equal(result.quantityMode, 'OPEN_ENDED');
  assert.equal(result.bindingStatus, 'UNBOUND');
  const stored = f.db.prepare('SELECT target_count,config_json FROM catalog_campaigns WHERE id=?').get(result.campaignId);
  assert.equal(stored.target_count, 2147483647);
  assert.equal(JSON.parse(stored.config_json).quantityMode, 'OPEN_ENDED');
  assert.equal(f.db.prepare('SELECT target_quota FROM catalog_sources WHERE campaign_id=?').get(result.campaignId).target_quota, null);
  const context = f.service.currentOperatorManualContext();
  assert.equal(context.campaign.id, result.campaignId);
  assert.equal(context.queue.checkpoint.runner_state, 'UNBOUND');
  assert.equal(context.queue.checkpoint.session_target, undefined);
});

test('same Initial create request replays, changed request fields conflict', async t => {
  const f = await createInitialPoolFixture(t);
  const first = f.service.createOperatorInitialCampaign(input(f.profile));
  const replay = f.service.createOperatorInitialCampaign(input(f.profile));
  assert.equal(replay.campaignId, first.campaignId);
  assert.equal(replay.idempotentReplay, true);
  assert.throws(() => f.service.createOperatorInitialCampaign({ ...input(f.profile), campaignName: 'Changed' }),
    error => error.code === 'OPERATOR_CREATE_IDEMPOTENCY_CONFLICT');
});

test('Pool history, scoped memberships, duplicate name and active queue hard fail without partial writes', async t => {
  for (const setup of ['pool', 'membership', 'duplicate', 'queue']) {
    const f = await createInitialPoolFixture(t);
    if (setup === 'pool') {
      const campaign = f.service.createCampaign({ name: 'Historical Pool Campaign', campaignType: 'test', profile: f.profile, targetCount: 1 });
      f.db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,product_count,
        non_electronic_unique_count,status,created_at,updated_at) VALUES('historical-pool',?,?,?,0,0,'superseded',?,?)`)
        .run(campaign.id, f.profile.category_key, f.profile.category_profile_version, f.now(), f.now());
    } else if (setup === 'membership') {
      const job=createJobRepository(f.db,{ now:f.now }).createJob({ jobType:'catalog',siteCountry:'DE',language:'en',
        currency:'EUR',primaryCategory:'Fixture',subcategory:'Category B',sortOrder:'Top Sales',targetCount:1 });
      const product = f.db.prepare(`INSERT INTO products(platform,external_product_id,canonical_url,first_seen_at,last_seen_at)
        VALUES('temu','991','https://www.temu.com/goods.html?goods_id=991',?,?)`).run(f.now(), f.now());
      const scope = f.profile.membership_scope;
      f.db.prepare(`INSERT INTO catalog_memberships(product_id,site_country,language,currency,primary_category,subcategory,
        sort_order,active,first_seen_at,last_seen_at,category_key,category_profile_version,last_job_id)
        VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?)`).run(Number(product.lastInsertRowid), scope.site_country, scope.language,
        scope.currency, scope.primary_category, scope.subcategory, scope.sort_order, f.now(), f.now(),
        f.profile.category_key, f.profile.category_profile_version,job.id);
    } else if (setup === 'duplicate') {
      f.service.createCampaign({ name: 'Fixture Initial', campaignType: 'test', profile: f.profile, targetCount: 1 });
    } else {
      const campaign = f.service.createCampaign({ name: 'Active Other', campaignType: 'test', profile: f.profile, targetCount: 1 });
      const source = f.service.createSource(campaign.id, { sourceKey: 'active', sourceType: 'category', sortOrder: 'Top Sales' });
      f.service.transitionCampaign(campaign.id, 'running');
      f.service.claimNextSource(campaign.id);
      assert.ok(source.id);
    }
    const before = databaseFingerprint(f.db);
    const expected = { pool: 'INITIAL_POOL_HISTORY_EXISTS', membership: 'INITIAL_CATEGORY_STATE_INCONSISTENT',
      duplicate: 'CAMPAIGN_NAME_CONFLICT', queue: 'CATALOG_RPA_CLAIM_CONFLICT' }[setup];
    assert.throws(() => f.service.createOperatorInitialCampaign(input(f.profile)), error => error.code === expected);
    assert.deepEqual(databaseFingerprint(f.db), before);
  }
});

test('profile capabilities separate Initial availability from taxonomy implementation', async t => {
  const f = await createInitialPoolFixture(t);
  const description = f.service.describeOperatorProfile(f.profile);
  assert.equal(description.profile_valid, true);
  assert.equal(description.expansion_available, false);
  assert.equal(description.initial_pool_available, true);
  assert.equal(description.classification_available, false);
  assert.equal(description.opportunity_available, false);
});
