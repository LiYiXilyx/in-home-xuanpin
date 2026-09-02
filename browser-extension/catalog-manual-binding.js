'use strict';

(() => {
  const READY='READY';

  function detectCurrentPage({profile,domEvidence={},networkEvidence={}}) {
    if(!profile?.category_key||!profile?.category_profile_version)throw coded('CATEGORY_PROFILE_REQUIRED','页面检测缺少 Category Profile。');
    const observed={
      url:normalizeUrl(domEvidence.url),siteCountry:String(domEvidence.siteCountry??''),language:String(domEvidence.language??''),
      currency:String(domEvidence.currency??''),category:String(domEvidence.category??''),categoryKey:String(domEvidence.categoryKey??''),
      categoryCandidates:Array.isArray(domEvidence.categoryCandidates)?domEvidence.categoryCandidates.map(row=>({value:String(row?.value??''),source:String(row?.source??'UNKNOWN')})).filter(row=>row.value):[],categorySource:String(domEvidence.categorySource??''),
      breadcrumbs:Array.isArray(domEvidence.breadcrumbs)?domEvidence.breadcrumbs.map(value=>String(value).trim()).filter(Boolean):[],
      sortOrder:String(domEvidence.sortOrder??domEvidence.sort??''),cardCount:Number(domEvidence.cardCount??0),
      searchNoResults:Boolean(domEvidence.searchNoResults??domEvidence.unhealthy),captchaBlocking:Boolean(domEvidence.captchaBlocking??domEvidence.verification),
      domReady:Boolean(domEvidence.ready??domEvidence.domReady??domEvidence.cardCount>0),networkReady:Boolean(networkEvidence.ready)
    };
    const expectedCategories=unique([...(profile.page_health?.category_names??[]),...(profile.category_aliases??[]),profile.page_category_name,profile.navigation?.breadcrumbs?.at?.(-1),profile.breadcrumbs?.at?.(-1),profile.display_name]);
    const captureOnly=profile.profile_kind==='CAPTURE_ONLY',expectedBreadcrumbs=profile.breadcrumbs??profile.navigation?.breadcrumbs??[];
    const breadcrumbApi=globalThis.TemuCatalogBreadcrumbs,terminal=observed.breadcrumbs.at(-1)??'',h1=observed.categoryCandidates.find(row=>row.source==='H1')?.value??(observed.categoryCandidates.length?'':observed.category),breadcrumbSuffix=!captureOnly||Boolean(breadcrumbApi?.matchesBreadcrumbSuffix(observed.breadcrumbs,expectedBreadcrumbs));
    const terminalExpected=expectedBreadcrumbs.at(-1)??'',terminalMatches=Boolean(terminalExpected)&&sameText(terminal,terminalExpected),h1Matches=includesText(expectedCategories,h1),signalsConflict=Boolean(h1&&terminal&&!sameText(h1,terminal)&&!(h1Matches&&terminalMatches));
    const listingMatches=!captureOnly||sameListingPath(observed.url,profile.listing_url),categoryMatches=!captureOnly?Boolean(observed.categoryKey?observed.categoryKey===profile.category_key:includesText(expectedCategories,observed.category)):(signalsConflict?false:h1Matches||(terminalMatches&&breadcrumbSuffix));
    if(!observed.category&&terminal)observed.category=terminal;if(!observed.categorySource)observed.categorySource=h1?'H1':terminal?'BREADCRUMB_TERMINAL':'NONE';
    const checks={
      country:observed.siteCountry===profile.site_country,language:observed.language===profile.language,currency:observed.currency===profile.currency,
      category:categoryMatches,breadcrumbs:breadcrumbSuffix,
      listingPath:listingMatches,
      sort:observed.sortOrder.toLowerCase()===String(profile.sort_order).toLowerCase(),products:observed.cardCount>0,
      notSearchNoResults:!observed.searchNoResults,notCaptchaBlocking:!observed.captchaBlocking,
      evidenceReady:observed.domReady||observed.networkReady
    };
    const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name),warnings=[];
    if(captureOnly&&listingMatches&&breadcrumbSuffix&&terminalMatches&&!includesText(profile.page_health?.category_names??[],terminal))warnings.push('PROFILE_CATEGORY_ALIAS_WEAK');
    const code=signalsConflict?'CATEGORY_SIGNALS_CONFLICT':!listingMatches?'LISTING_PATH_MISMATCH':captureOnly&&(!breadcrumbSuffix||!terminalMatches)?'PROFILE_CORRECTION_REQUIRED':failed[0]??READY;
    const health={status:failed.length? 'BLOCKED':READY,code,checks,failed,warnings};
    const fingerprintParts=[observed.url,observed.siteCountry,observed.language,observed.currency,profile.category_key,observed.category,observed.sortOrder];
    if(captureOnly)fingerprintParts.push(observed.breadcrumbs);
    return {profileKey:profile.category_key,profileVersion:profile.category_profile_version,observed,health,
      contextFingerprint:fingerprint(fingerprintParts)};
  }

  function bindDetectedPage({detection,campaign,profile,sourceId,now=()=>new Date().toISOString(),generation=1}) {
    if(detection?.health?.status!==READY)throw coded('PAGE_HEALTH_BLOCKED','当前页面未通过 Page Health Gate。');
    assertCampaign(campaign,profile);
    if(!sourceId)throw coded('PAGE_BINDING_REQUIRED','绑定缺少 sourceId。');
    return Object.freeze({status:'BOUND',binding_version:'manual-bind-v1',binding_generation:Number(generation),campaign_id:campaign.id,
      source_id:sourceId,category_key:profile.category_key,category_profile_version:profile.category_profile_version,
      site_country:profile.site_country,language:profile.language,currency:profile.currency,sort_order:profile.sort_order,
      bound_url:detection.observed.url,bound_category:detection.observed.category,bound_sort:detection.observed.sortOrder,
      bound_breadcrumbs:Object.freeze([...(detection.observed.breadcrumbs??[])]),
      bound_goods_count:detection.observed.cardCount,bound_at:typeof now==='function'?now():String(now),context_fingerprint:detection.contextFingerprint});
  }

  function validateBindingForCapture({binding,detection,campaign,profile,sourceId}) {
    if(!binding)throw coded('PAGE_BINDING_REQUIRED','必须先检测并绑定当前页面。');
    assertCampaign(campaign,profile);
    if(detection?.health?.status!==READY||binding.status!=='BOUND'||binding.campaign_id!==campaign.id||binding.source_id!==sourceId
      ||binding.category_key!==profile.category_key||binding.category_profile_version!==profile.category_profile_version
      ||binding.context_fingerprint!==detection.contextFingerprint)throw coded('PAGE_CONTEXT_LOST','页面上下文变化，绑定已失效。');
    return binding;
  }

  function manualBatchId({campaignId,sourceId,bindingGeneration,contextFingerprint,contentFingerprint}) {
    return `manual-${fnv1a([campaignId,sourceId,bindingGeneration,contextFingerprint,contentFingerprint].join('\u001f'))}`;
  }
  function contentFingerprint(goodsIds){return fingerprint([...new Set((goodsIds??[]).map(String))].sort());}
  function fingerprint(value){return fnv1a(JSON.stringify(value));}
  function fnv1a(value){let hash=2166136261;for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');}
  function normalizeUrl(value){try{const url=new URL(String(value));url.hash='';return url.href;}catch{return String(value??'');}}
  function includesText(values,value){const expected=String(value??'').trim().toLocaleLowerCase();return values.some(row=>String(row).trim().toLocaleLowerCase()===expected);}
  function sameText(left,right){const normalize=globalThis.TemuCatalogBreadcrumbs?.comparable??(value=>String(value??'').trim().toLocaleLowerCase());return normalize(left)===normalize(right);}
  function unique(values){return[...new Set(values.map(value=>String(value??'').trim()).filter(Boolean))];}
  function sameListingPath(left,right){try{const a=new URL(left),b=new URL(right);return a.hostname.toLowerCase()===b.hostname.toLowerCase()&&normalizedPath(a.pathname)===normalizedPath(b.pathname);}catch{return false;}}
  function normalizedPath(value){const result=String(value).replace(/\/+$/,'');return result||'/';}
  function assertCampaign(campaign,profile){if(!campaign?.id||campaign.categoryKey!==profile.category_key||campaign.categoryProfileVersion!==profile.category_profile_version)
    throw coded('CAMPAIGN_PROFILE_MISMATCH','Campaign 与 Category Profile 不匹配。');}
  function coded(code,message){const error=new Error(message);error.code=code;return error;}

  globalThis.TemuCatalogManualBinding=Object.freeze({detectCurrentPage,bindDetectedPage,validateBindingForCapture,manualBatchId,contentFingerprint});
})();
