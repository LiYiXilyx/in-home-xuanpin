import crypto from 'node:crypto';

import {AppError,ConfigError} from '../../shared/errors.mjs';
import {validateCategoryProfile} from './category-profile.mjs';

const FORBIDDEN=new Set([
  'profile_schema_version','profile_origin','profile_kind','category_key','category_profile_version',
  'site_country','language','currency','sort_order','capture_mode','quantity_mode','taxonomy','capabilities',
  'membership_scope','legacy_membership_scopes','page_health','navigation','business_rules','taxonomy_bindings'
]);

export function validateOperatorCategoryDraft(input={}){
  object(input,'operator_category_profile');
  const override=Object.keys(input).find(key=>FORBIDDEN.has(key));
  if(override)throw new AppError(`字段 ${override} 由服务器生成，不允许覆盖。`,{
    code:'CATEGORY_PROFILE_GENERATED_FIELD_FORBIDDEN',details:{field:override}
  });
  const displayName=required(input.display_name,'display_name');
  const pageCategoryName=required(input.page_category_name??displayName,'page_category_name');
  const aliases=uniqueSorted([...(array(input.category_aliases,'category_aliases')),pageCategoryName]);
  const parentCategory=required(input.parent_category,'parent_category');
  const breadcrumbs=array(input.breadcrumbs,'breadcrumbs').map((value,index)=>required(value,`breadcrumbs[${index}]`));
  if(!breadcrumbs.length)fail('breadcrumbs','必须是非空数组');
  const listingUrl=temuUrl(input.listing_url);
  return Object.freeze({display_name:displayName,page_category_name:pageCategoryName,
    category_aliases:Object.freeze(aliases),parent_category:parentCategory,breadcrumbs:Object.freeze(breadcrumbs),listing_url:listingUrl});
}

export function normalizeOperatorCategoryProfile(input={}){
  const draft=validateOperatorCategoryDraft(input);
  const categoryKey=identitySlug([draft.page_category_name,draft.display_name,...draft.category_aliases]);
  const businessInput={...draft,category_aliases:[...draft.category_aliases],breadcrumbs:[...draft.breadcrumbs]};
  const version=`operator-${categoryKey}-v1-${hash(businessInput).slice(0,12)}`;
  return validateCategoryProfile({
    profile_schema_version:2,profile_origin:'OPERATOR_MANAGED',profile_kind:'CAPTURE_ONLY',
    category_key:categoryKey,category_profile_version:version,...businessInput,
    site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',
    capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',quantity_mode:'OPEN_ENDED',
    taxonomy:{status:'UNCONFIGURED'},capabilities:{raw_capture_available:true,initial_pool_available:true,
      classification_available:false,opportunity_available:false},
    membership_scope:{site_country:'DE',language:'en',currency:'EUR',primary_category:draft.parent_category,
      subcategory:draft.page_category_name,sort_order:'Top Sales'},legacy_membership_scopes:[],
    page_health:{category_names:uniqueSorted([draft.page_category_name,...draft.category_aliases])},
    navigation:{entry_method:'human_navigation_only',breadcrumbs:[...draft.breadcrumbs],category_confirmation_gate:true}
  });
}

function identitySlug(values){
  for(const value of values){
    const ascii=String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[A-Za-z0-9]+/g)?.join('-').toLowerCase();
    if(ascii)return ascii;
  }
  throw new AppError('Unicode 类目必须提供可用于 identity 的 Latin alias。',{code:'CATEGORY_PROFILE_LATIN_ALIAS_REQUIRED'});
}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex');}
function sortValue(value){if(Array.isArray(value))return value.map(sortValue);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));return value;}
function uniqueSorted(values){return [...new Set(values.map(value=>required(value,'category_aliases[]'))) ].sort((a,b)=>a.localeCompare(b,'en'));}
function array(value,path){if(!Array.isArray(value))fail(path,'必须是数组');return value;}
function object(value,path){if(!value||typeof value!=='object'||Array.isArray(value))fail(path,'必须是对象');}
function required(value,path){const result=String(value??'').trim();if(!result)fail(path,'不能为空');return result;}
function temuUrl(value){const raw=required(value,'listing_url');let parsed;try{parsed=new URL(raw);}catch{fail('listing_url','必须是有效 URL');}
  if(parsed.protocol!=='https:'||!/(^|\.)temu\.com$/i.test(parsed.hostname))fail('listing_url','必须是 HTTPS Temu URL');return parsed.toString();}
function fail(fieldPath,message){throw new ConfigError(`Operator Category Profile ${fieldPath} ${message}。`,{fieldPath:`operator_category_profile.${fieldPath}`});}
