import { AppError } from '../../shared/errors.mjs';

export function validateResumeCampaign(service,{campaignId,profile,campaignType}) {
  if (!String(campaignId??'').trim()) throw coded('CAMPAIGN_RESUME_ID_REQUIRED','Resume 必须显式提供 campaign_id。');
  const campaign=service.getCampaign(String(campaignId));
  if (!campaign) throw coded('CAMPAIGN_NOT_FOUND',`未找到 Campaign：${campaignId}`);
  if (campaign.categoryKey!==profile.category_key) throw coded('CAMPAIGN_CATEGORY_MISMATCH','Campaign category 与请求不匹配。');
  if (campaign.categoryProfileVersion!==profile.category_profile_version) throw coded('CAMPAIGN_PROFILE_VERSION_MISMATCH','Campaign profile version 与请求不匹配。');
  if (campaign.campaignType!==campaignType) throw coded('CAMPAIGN_TYPE_MISMATCH','Campaign type 与请求不匹配。');
  const frozen=campaign.config?.categoryProfile;
  if (frozen && (frozen.category_key!==profile.category_key || frozen.category_profile_version!==profile.category_profile_version))
    throw coded('CAMPAIGN_PROFILE_VERSION_MISMATCH','Campaign 冻结 Profile 与请求不匹配。');
  return campaign;
}
function coded(code,message){return new AppError(message,{code});}
