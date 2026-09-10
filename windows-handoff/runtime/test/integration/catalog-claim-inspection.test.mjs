import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPoolFixture } from '../fixtures/initial-category-pool-fixture.mjs';
import { createCatalogClaimRecoveryRepository } from '../../src/db/repositories/catalog-claim-recovery-repository.mjs';
import { createCatalogClaimInspectionService } from '../../src/modules/catalog-scale/catalog-claim-inspection.mjs';

test('lists every active Catalog claim deterministically and persists immutable inspection evidence',async t => {
  const fixture=await createInitialPoolFixture(t);
  const first=seedClaim(fixture,'first','2026-08-30T00:00:00.000Z');
  const second=seedClaim(fixture,'second','2026-08-31T00:00:00.000Z');
  const repository=createCatalogClaimRecoveryRepository(fixture.db,{now:()=> '2026-09-02T00:00:00.000Z'});
  const service=createCatalogClaimInspectionService({repository,activityRegistry:{snapshot:()=>({})},
    thresholds:{heartbeatTimeoutMs:1800000,doubleInspectionIntervalMs:10000,bindingLeaseMs:30000,legacyNoHeartbeatMs:86400000},
    now:()=> '2026-09-02T00:00:00.000Z'});

  const blockers=service.listBlockers();
  assert.equal(blockers.primaryBlocker.campaignId,second.campaign.id);
  assert.deepEqual(blockers.allBlockers.map(row=>row.campaignId),[second.campaign.id,first.campaign.id]);
  assert.deepEqual(Object.keys(blockers.allBlockers[0]).filter(key=>['campaignId','categoryKey','categoryProfileVersion','campaignType','campaignStatus','queueId','queueStatus','sourceId','sourceStatus','claimToken','claimGeneration'].includes(key)).sort(),
    ['campaignId','campaignStatus','campaignType','categoryKey','categoryProfileVersion','claimGeneration','claimToken','queueId','queueStatus','sourceId','sourceStatus'].sort());

  const inspection=service.inspect({campaignId:second.campaign.id});
  assert.equal(repository.getInspection(inspection.inspectionId).campaignId,second.campaign.id);
  assert.throws(()=>fixture.db.prepare('UPDATE catalog_rpa_claim_inspections SET determination=? WHERE id=?')
    .run('ACTIVE',inspection.inspectionId),/immutable/i);
  assert.throws(()=>fixture.db.prepare('DELETE FROM catalog_rpa_claim_inspections WHERE id=?')
    .run(inspection.inspectionId),/immutable/i);
});

function seedClaim(fixture,label,claimedAt) {
  const campaign=fixture.service.createCampaign({name:`claim-${label}`,campaignType:'test',profile:fixture.profile,targetCount:10});
  const source=fixture.service.createSource(campaign.id,{sourceKey:`source-${label}`,sourceType:'category',sortOrder:'Top Sales',targetQuota:10});
  const queue=fixture.db.prepare('SELECT id FROM catalog_rpa_queue WHERE source_id=?').get(source.id);
  fixture.service.transitionCampaign(campaign.id,'running');
  fixture.service.claimNextSource(campaign.id);
  fixture.db.prepare('UPDATE catalog_rpa_queue SET claimed_at=?,heartbeat_at=?,updated_at=? WHERE id=?')
    .run(claimedAt,claimedAt,claimedAt,queue.id);
  return {campaign,source,queue};
}
