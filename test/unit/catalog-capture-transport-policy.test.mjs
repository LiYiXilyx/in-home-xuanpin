import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
function api(){const sandbox=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'browser-extension/catalog-capture-transport-policy.js'),'utf8'),sandbox);return sandbox.TemuCatalogCaptureTransportPolicy;}
const girls=()=>({campaign:{campaignType:'initial',browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE',config:{}},profile:{profile_kind:'CAPTURE_ONLY'}});

test('existing Capture-only Initial derives DOM optional policy from exact identity',()=>{assert.deepEqual({...api().resolveCaptureTransportPolicy(girls())},{policy:'DOM_REQUIRED_NETWORK_OPTIONAL',source:'DERIVED_CAPTURE_ONLY_INITIAL_V1'});});
test('frozen valid policy wins and malformed frozen policy hard fails',()=>{const value=girls();value.campaign.config.captureTransportPolicy='NETWORK_ENRICHED_REQUIRED';assert.deepEqual({...api().resolveCaptureTransportPolicy(value)},{policy:'NETWORK_ENRICHED_REQUIRED',source:'CAMPAIGN_CONFIG'});value.campaign.config.captureTransportPolicy='DOM_OR_ANY_NETWORK';assert.throws(()=>api().resolveCaptureTransportPolicy(value),error=>error.code==='CAPTURE_TRANSPORT_POLICY_INVALID');});
test('public capture context top-level frozen policy is authoritative',()=>{const value=girls();value.campaign.captureTransportPolicy='NETWORK_ENRICHED_REQUIRED';assert.equal(api().resolveCaptureTransportPolicy(value).policy,'NETWORK_ENRICHED_REQUIRED');});
test('OPEN_ENDED or sentinel alone never identifies DOM optional policy',()=>{for(const campaign of [{campaignType:'refresh',browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE',quantityMode:'OPEN_ENDED'},{campaignType:'expansion',browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE',targetCount:2147483647},{campaignType:'initial',browserControlMode:'FULL_REFRESH_EXTENSION_AUTO',quantityMode:'OPEN_ENDED'}])assert.equal(api().resolveCaptureTransportPolicy({campaign,profile:{profile_kind:'CAPTURE_ONLY'}}).policy,'NETWORK_ENRICHED_REQUIRED');});
