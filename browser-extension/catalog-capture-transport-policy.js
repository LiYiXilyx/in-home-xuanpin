'use strict';

(() => {
  const DOM_OPTIONAL='DOM_REQUIRED_NETWORK_OPTIONAL',NETWORK_REQUIRED='NETWORK_ENRICHED_REQUIRED';
  const ALLOWED=new Set([DOM_OPTIONAL,NETWORK_REQUIRED]);
  function coded(code,message){const error=new Error(message);error.code=code;return error;}
  function resolveCaptureTransportPolicy({campaign={},profile={}}={}){
    const frozen=campaign.config?.captureTransportPolicy??campaign.config?.capture_transport_policy;
    if(frozen!==undefined&&frozen!==null){if(!ALLOWED.has(frozen))throw coded('CAPTURE_TRANSPORT_POLICY_INVALID','Campaign capture transport policy无效。');return Object.freeze({policy:frozen,source:'CAMPAIGN_CONFIG'});}
    if(profile.profile_kind==='CAPTURE_ONLY'&&campaign.campaignType==='initial'&&campaign.browserControlMode==='MANUAL_BIND_PASSIVE_CAPTURE')return Object.freeze({policy:DOM_OPTIONAL,source:'DERIVED_CAPTURE_ONLY_INITIAL_V1'});
    return Object.freeze({policy:NETWORK_REQUIRED,source:'LEGACY_STRICT_DEFAULT_V1'});
  }
  globalThis.TemuCatalogCaptureTransportPolicy=Object.freeze({resolveCaptureTransportPolicy,DOM_OPTIONAL,NETWORK_REQUIRED});
})();
