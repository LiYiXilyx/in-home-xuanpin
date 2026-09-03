import { AppError } from '../../shared/errors.mjs';

export const DOM_REQUIRED_NETWORK_OPTIONAL='DOM_REQUIRED_NETWORK_OPTIONAL';
export const NETWORK_ENRICHED_REQUIRED='NETWORK_ENRICHED_REQUIRED';
const ALLOWED=new Set([DOM_REQUIRED_NETWORK_OPTIONAL,NETWORK_ENRICHED_REQUIRED]);

export function resolveCaptureTransportPolicy({campaign={},profile={}}={}){
  const frozen=campaign.captureTransportPolicy??campaign.config?.captureTransportPolicy??campaign.config?.capture_transport_policy;
  if(frozen!==undefined&&frozen!==null){if(!ALLOWED.has(frozen))throw new AppError('Campaign capture transport policy无效。',{code:'CAPTURE_TRANSPORT_POLICY_INVALID'});return{policy:frozen,source:'CAMPAIGN_CONFIG'};}
  if(profile.profile_kind==='CAPTURE_ONLY'&&campaign.campaignType==='initial'&&campaign.browserControlMode==='MANUAL_BIND_PASSIVE_CAPTURE')return{policy:DOM_REQUIRED_NETWORK_OPTIONAL,source:'DERIVED_CAPTURE_ONLY_INITIAL_V1'};
  return{policy:NETWORK_ENRICHED_REQUIRED,source:'LEGACY_STRICT_DEFAULT_V1'};
}
