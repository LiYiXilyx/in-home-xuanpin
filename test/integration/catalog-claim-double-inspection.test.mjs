import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialPoolFixture} from '../fixtures/initial-category-pool-fixture.mjs';
import {createCatalogClaimRecoveryRepository} from '../../src/db/repositories/catalog-claim-recovery-repository.mjs';
import {createCatalogClaimInspectionService} from '../../src/modules/catalog-scale/catalog-claim-inspection.mjs';
import {createCatalogActivityRegistry} from '../../src/modules/catalog-scale/catalog-activity-registry.mjs';
import {resolveClaimRecoveryThresholds} from '../../src/modules/catalog-scale/catalog-claim-stale-policy.mjs';

test('requires adjacent stable inspections and rejects progress or claim races',async t=>{
  const f=await createInitialPoolFixture(t),campaign=f.service.createCampaign({name:'double-inspection',campaignType:'test',profile:f.profile,targetCount:10});
  const source=f.service.createSource(campaign.id,{sourceKey:'top',sourceType:'category',sortOrder:'Top Sales',targetQuota:10});
  f.service.transitionCampaign(campaign.id,'running');f.service.claimNextSource(campaign.id);f.service.transitionCampaign(campaign.id,'paused');
  f.db.prepare("UPDATE catalog_rpa_queue SET heartbeat_at='2026-08-30T00:00:00.000Z',updated_at='2026-08-30T00:00:00.000Z',checkpoint_json=? WHERE campaign_id=?")
    .run(JSON.stringify({runner_state:'PAUSED',capture_paused:true,accepted_unique:10,binding_heartbeat_at:'2026-08-30T00:00:00.000Z',binding_generation:1,binding_fingerprint:'binding-a'}),campaign.id);
  let clock=Date.parse('2026-09-02T00:00:00.000Z');const now=()=>new Date(clock).toISOString();
  const repository=createCatalogClaimRecoveryRepository(f.db,{now}),service=createCatalogClaimInspectionService({repository,activityRegistry:createCatalogActivityRegistry(),thresholds:resolveClaimRecoveryThresholds({}),now});
  const first=service.inspect({campaignId:campaign.id});assert.equal(first.determination,'STALE_NOT_PROVEN');
  clock+=9000;assert.throws(()=>service.inspect({campaignId:campaign.id,previousInspectionId:first.id}),error=>error.code==='CATALOG_RPA_INSPECTION_TOO_SOON');
  clock+=1000;const confirmed=service.inspect({campaignId:campaign.id,previousInspectionId:first.id});assert.equal(confirmed.determination,'STALE_CONFIRMED');
  f.db.prepare("UPDATE catalog_rpa_queue SET checkpoint_json=json_set(checkpoint_json,'$.accepted_unique',11) WHERE campaign_id=?").run(campaign.id);
  clock+=10000;const changed=service.inspect({campaignId:campaign.id,previousInspectionId:confirmed.id});assert.equal(changed.determination,'STALE_NOT_PROVEN');
  f.db.prepare("UPDATE catalog_rpa_queue SET claim_generation=claim_generation+1 WHERE campaign_id=?").run(campaign.id);
  clock+=10000;assert.equal(service.inspect({campaignId:campaign.id,previousInspectionId:changed.id}).determination,'STALE_NOT_PROVEN');
  assert.equal(source.id,changed.sourceId);
});
