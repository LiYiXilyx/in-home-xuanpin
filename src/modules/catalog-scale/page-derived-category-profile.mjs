import crypto from 'node:crypto';
import '../../../browser-extension/category-page-descriptor.js';
import {normalizeOperatorCategoryProfile} from './operator-category-profile.mjs';
import {validateCategoryProfile} from './category-profile.mjs';

export const descriptorContract=globalThis.TemuCategoryPageDescriptor;
const normalized=value=>String(value??'').normalize('NFKC').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim().toLowerCase();
const crumbs=value=>JSON.stringify((value??[]).filter(x=>normalized(x)!=='home').map(normalized));
const canonical=url=>{try{return descriptorContract.canonicalizeTemuCategoryListingUrl(url);}catch{return null;}};
const blocked=code=>({resolution:'BLOCKED',code});
export function resolvePageDerivedCategory(input,profiles){
 const d=descriptorContract.validateDescriptor(input);
 const candidates=profiles.map(profile=>({profile,url:canonical(profile.listing_url)}));
 const tiers=[
  row=>row.url===d.canonical_listing_url,
  row=>row.url&&row.url.match(/-o\d+-(\d+)\.html$/)?.[1]===d.category_numeric_id,
  row=>!row.url&&crumbs(row.profile.breadcrumbs)===crumbs(d.breadcrumbs),
  row=>!row.url&&normalized(row.profile.parent_category)===normalized(d.breadcrumb_parent)&&normalized(row.profile.page_category_name)===normalized(d.breadcrumb_terminal)
 ];
 for(const match of tiers){
  const matches=candidates.filter(match);
  if(matches.length>1)return blocked('CATEGORY_PROFILE_AMBIGUOUS');
  if(matches.length===1){const p=matches[0].profile;
   if(p.site_country!=='DE'||p.language!=='en'||p.currency!=='EUR'||p.sort_order!=='Top Sales'||normalized(p.membership_scope?.subcategory)!==normalized(d.breadcrumb_terminal)||normalized(p.membership_scope?.primary_category)!==normalized(d.breadcrumb_parent))return blocked('CATEGORY_PROFILE_CONFLICT');
   return {resolution:'EXISTING',profile:p,profile_reused:true};
  }
 }
 const draft={display_name:d.page_category_name,page_category_name:d.page_category_name,category_aliases:[d.page_category_name,d.category_url_slug.replaceAll('-',' ')],parent_category:d.breadcrumb_parent,breadcrumbs:[...d.breadcrumbs],listing_url:d.canonical_listing_url};
 let profile=normalizeOperatorCategoryProfile(draft);
 if(profiles.some(p=>p.category_key===profile.category_key)){
  const suffix=d.category_numeric_id??crypto.createHash('sha256').update(d.pathname+crumbs(d.breadcrumbs)).digest('hex').slice(0,10);
  const key=`${profile.category_key}-${suffix}`;
  if(profiles.some(p=>p.category_key===key))return blocked('CATEGORY_PROFILE_CONFLICT');
  profile=validateCategoryProfile({...profile,category_key:key,category_profile_version:profile.category_profile_version.replace(`operator-${profile.category_key}-`,`operator-${key}-`)});
 }
 return {resolution:'NEW',profile,draft,profile_reused:false};
}
