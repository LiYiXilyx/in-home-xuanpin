import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogActivityRegistry } from '../../src/modules/catalog-scale/catalog-activity-registry.mjs';
import { evaluateClaimStale,resolveClaimRecoveryThresholds } from '../../src/modules/catalog-scale/catalog-claim-stale-policy.mjs';

const now='2026-09-02T00:00:00.000Z';
const thresholds=resolveClaimRecoveryThresholds({});
const inactive=Object.freeze({liveWorker:false,liveBinding:false,inFlightCapture:false,inFlightQa:false,inFlightActivation:false,inFlightExcelExport:false,liveSourceRunner:false});

test('heartbeat boundary requires full 30 minutes and two stable observations',()=>{
  assert.equal(evaluateClaimStale({current:claim(29),previous:claim(60),activity:inactive,thresholds,now}).determination,'STALE_NOT_PROVEN');
  assert.equal(evaluateClaimStale({current:claim(30),previous:claim(60),activity:inactive,thresholds,now}).determination,'STALE_CONFIRMED');
});

test('legacy no-heartbeat boundary requires 24 hours',()=>{
  assert.equal(evaluateClaimStale({current:claim(null,23),previous:claim(null,25),activity:inactive,thresholds,now}).determination,'STALE_NOT_PROVEN');
  assert.equal(evaluateClaimStale({current:claim(null,24),previous:claim(null,25),activity:inactive,thresholds,now}).determination,'STALE_CONFIRMED');
});

test('only paused parent is eligible and unknown/live evidence fails closed',()=>{
  for(const campaignStatus of ['running','manual_required']) assert.equal(evaluateClaimStale({current:claim(60,60,campaignStatus),previous:claim(61,61,campaignStatus),activity:inactive,thresholds,now}).determination,'NOT_ELIGIBLE');
  for(const key of Object.keys(inactive)) assert.notEqual(evaluateClaimStale({current:claim(60),previous:claim(61),activity:{...inactive,[key]:true},thresholds,now}).determination,'STALE_CONFIRMED');
  assert.equal(evaluateClaimStale({current:claim(60),previous:claim(61),activity:{...inactive,liveWorker:null},thresholds,now}).determination,'STALE_NOT_PROVEN');
});

test('binding lease is live below 30 seconds and expired on boundary',()=>{
  assert.equal(evaluateClaimStale({current:{...claim(60),bindingHeartbeatAt:agoSeconds(29)},previous:claim(61),activity:inactive,thresholds,now}).determination,'STALE_NOT_PROVEN');
  assert.equal(evaluateClaimStale({current:{...claim(60),bindingHeartbeatAt:agoSeconds(30)},previous:claim(61),activity:inactive,thresholds,now}).determination,'STALE_CONFIRMED');
});

test('configured thresholds cannot weaken immutable floors',()=>{
  assert.throws(()=>resolveClaimRecoveryThresholds({heartbeatTimeoutMs:1}),/heartbeatTimeoutMs/);
  assert.equal(resolveClaimRecoveryThresholds({heartbeatTimeoutMs:3600000}).heartbeatTimeoutMs,3600000);
});

test('activity registry uses exact scope and try/finally cleanup',async()=>{
  const registry=createCatalogActivityRegistry(),scope={campaignId:'c1',queueId:'q1'};
  await registry.run(scope,'capture',async()=>assert.equal(registry.snapshot(scope).inFlightCapture,true));
  assert.equal(registry.snapshot(scope).inFlightCapture,false);
  assert.equal(registry.snapshot({campaignId:'c2',queueId:'q2'}).inFlightCapture,false);
});

function claim(heartbeatMinutes=60,activityHours=48,campaignStatus='paused'){
  return {campaignId:'c1',queueId:'q1',sourceId:'s1',campaignStatus,queueStatus:'capturing',claimToken:'token',claimGeneration:1,
    heartbeatAt:heartbeatMinutes===null?null:agoMinutes(heartbeatMinutes),latestActivityAt:agoHours(activityHours),progressFingerprint:'same',bindingFingerprint:'same'};
}
function agoSeconds(value){return new Date(Date.parse(now)-value*1000).toISOString();}
function agoMinutes(value){return agoSeconds(value*60);}
function agoHours(value){return agoMinutes(value*60);}
