import fs from 'node:fs/promises';
import { AppError,ConfigError } from '../../shared/errors.mjs';

export const REQUIRED_ELECTRONIC_EXCLUSION_CODES=Object.freeze([
  'ELECTRONIC_PRODUCT','USB_PRODUCT','BATTERY_PRODUCT','RECHARGEABLE_PRODUCT',
  'BLUETOOTH_PRODUCT','WIRELESS_COMMUNICATION','AUDIO_ELECTRONIC',
  'LIGHTING_ELECTRONIC','CERTIFICATION_RISK'
]);

const GATES=new Set(['non_electronic_unique_count','business_eligible_count','reviewable_unique_count']);
const PIPELINES=Object.freeze(['classify','fine_classify','opportunity']);
const LEGACY_MOTORCYCLE_BINDINGS=Object.freeze({
  classify:Object.freeze({taxonomy_name:'week1-motorcycle-accessories',taxonomy_version:null,rule_version:'week1-rule-v1'}),
  fine_classify:Object.freeze({taxonomy_name:'week2-motorcycle-fine-v1',taxonomy_version:null,rule_version:'week2-fine-rule-v1'}),
  opportunity:Object.freeze({taxonomy_name:'motorcycle-opportunity',taxonomy_version:'motorcycle-opportunity-v2',rule_version:'active-pool-rule-v2'})
});

export async function loadCategoryProfile(profilePath) {
  let raw;
  try { raw=JSON.parse(await fs.readFile(profilePath,'utf8')); }
  catch (error) {
    throw new ConfigError(`无法读取 Category Profile：${profilePath}`,{ fieldPath:'category_profile',cause:error });
  }
  return validateCategoryProfile(raw);
}

export function validateCategoryProfile(input) {
  object(input,'category_profile');
  if(input.profile_schema_version===2||input.profile_kind==='CAPTURE_ONLY')return validateCaptureOnlyProfile(input);
  const profile={
    category_key:slug(input.category_key,'category_key'),
    category_profile_version:required(input.category_profile_version,'category_profile_version'),
    display_name:required(input.display_name,'display_name'),
    site_country:required(input.site_country,'site_country'),
    language:required(input.language,'language'),
    currency:required(input.currency,'currency'),
    sort_order:required(input.sort_order,'sort_order'),
    target_count:positiveInteger(input.target_count,'target_count'),
    exclude_electronics:boolean(input.exclude_electronics,'exclude_electronics'),
    exclude_usb:boolean(input.exclude_usb,'exclude_usb'),
    exclude_battery:boolean(input.exclude_battery,'exclude_battery'),
    price_min_eur:nonNegativeNumber(input.price_min_eur,'price_min_eur'),
    taxonomy:required(input.taxonomy,'taxonomy'),
    taxonomy_bindings:validateTaxonomyBindings(input),
    membership_scope:validateMembershipScope(input.membership_scope ?? inferredMembershipScope(input),'membership_scope'),
    legacy_membership_scopes:validateLegacyMembershipScopes(input),
    page_health:validatePageHealth(input),
    navigation:validateNavigation(input.navigation),
    business_rules:validateBusinessRules(input.business_rules)
  };
  for (const field of ['exclude_electronics','exclude_usb','exclude_battery']) {
    if (!profile[field]) fail(field,'Catalog Scale V2 当前阶段必须为 true');
  }
  return Object.freeze(profile);
}

function validateCaptureOnlyProfile(input){
  if(input.profile_schema_version!==2||input.profile_origin!=='OPERATOR_MANAGED'||input.profile_kind!=='CAPTURE_ONLY')
    fail('profile_kind','capture-only metadata 不匹配');
  if(input.taxonomy?.status!=='UNCONFIGURED')fail('taxonomy.status','必须为 UNCONFIGURED');
  const capabilities=input.capabilities;
  object(capabilities,'capabilities');
  if(capabilities.raw_capture_available!==true||capabilities.initial_pool_available!==true
    ||capabilities.classification_available!==false||capabilities.opportunity_available!==false)
    fail('capabilities','capture-only capability contract 不匹配');
  if(input.site_country!=='DE'||input.language!=='en'||input.currency!=='EUR'||input.sort_order!=='Top Sales'
    ||input.capture_mode!=='MANUAL_BIND_PASSIVE_CAPTURE'||input.quantity_mode!=='OPEN_ENDED')
    fail('market','capture-only 固定契约不匹配');
  const aliases=stringArray(input.category_aliases,'category_aliases',true);
  const breadcrumbs=stringArray(input.breadcrumbs,'breadcrumbs',true);
  const result={
    profile_schema_version:2,profile_origin:'OPERATOR_MANAGED',profile_kind:'CAPTURE_ONLY',
    category_key:slug(input.category_key,'category_key'),category_profile_version:required(input.category_profile_version,'category_profile_version'),
    display_name:required(input.display_name,'display_name'),page_category_name:required(input.page_category_name,'page_category_name'),
    category_aliases:aliases,parent_category:required(input.parent_category,'parent_category'),breadcrumbs,
    listing_url:required(input.listing_url,'listing_url'),site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',
    capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',quantity_mode:'OPEN_ENDED',taxonomy:Object.freeze({status:'UNCONFIGURED'}),
    capabilities:Object.freeze({raw_capture_available:true,initial_pool_available:true,classification_available:false,opportunity_available:false}),
    membership_scope:validateMembershipScope(input.membership_scope??{
      site_country:'DE',language:'en',currency:'EUR',primary_category:input.parent_category,
      subcategory:input.page_category_name,sort_order:'Top Sales'
    },'membership_scope'),
    legacy_membership_scopes:validateLegacyMembershipScopes(input),page_health:validatePageHealth(input),
    navigation:validateNavigation(input.navigation??{
      entry_method:'human_navigation_only',breadcrumbs:input.breadcrumbs,category_confirmation_gate:true
    })
  };
  return Object.freeze(result);
}

export function resolveTaxonomyBinding(profile,pipeline) {
  if (!PIPELINES.includes(pipeline)) throw new AppError(`缺少 taxonomy binding：${pipeline}`,{ code:'CATEGORY_PROFILE_BINDING_REQUIRED',details:{ pipeline,categoryKey:profile?.category_key } });
  const binding=profile?.taxonomy_bindings?.[pipeline];
  if (!binding) throw new AppError(`缺少 taxonomy_bindings.${pipeline}`,{ code:'CATEGORY_PROFILE_BINDING_REQUIRED',details:{ pipeline,categoryKey:profile?.category_key } });
  return { taxonomyName:binding.taxonomy_name,taxonomyVersion:binding.taxonomy_version,ruleVersion:binding.rule_version,categoryScope:profile.category_key };
}

export function assertTaxonomyBinding({profile,pipeline,taxonomyName,taxonomyVersion=null,ruleVersion}) {
  const expected=resolveTaxonomyBinding(profile,pipeline);
  if (expected.categoryScope!==profile.category_key) throw new AppError('taxonomy category scope 不匹配。',{
    code:'TAXONOMY_CATEGORY_SCOPE_MISMATCH',details:{ pipeline,expected:expected.categoryScope,actual:profile.category_key }
  });
  if (expected.taxonomyName!==taxonomyName || expected.taxonomyVersion!==taxonomyVersion || expected.ruleVersion!==ruleVersion) {
    throw new AppError('taxonomy binding 不匹配。',{ code:'TAXONOMY_BINDING_MISMATCH',details:{ pipeline,expected,
      actual:{ taxonomyName,taxonomyVersion,ruleVersion,categoryScope:profile.category_key } } });
  }
  return expected;
}

function validateTaxonomyBindings(input) {
  const raw=input.taxonomy_bindings ?? legacyBindings(input);
  if (!raw) throw new AppError('新 Category Profile 必须显式配置 taxonomy_bindings。',{ code:'CATEGORY_PROFILE_BINDING_REQUIRED',details:{ categoryKey:input.category_key } });
  object(raw,'taxonomy_bindings');const result={};
  for (const pipeline of PIPELINES) {
    object(raw[pipeline],`taxonomy_bindings.${pipeline}`);
    const version=raw[pipeline].taxonomy_version;
    if (version!==null && (typeof version!=='string' || !version.trim())) fail(`taxonomy_bindings.${pipeline}.taxonomy_version`,'必须是非空字符串或 null');
    result[pipeline]=Object.freeze({ taxonomy_name:required(raw[pipeline].taxonomy_name,`taxonomy_bindings.${pipeline}.taxonomy_name`),
      taxonomy_version:version===null ? null:String(version).trim(),rule_version:required(raw[pipeline].rule_version,`taxonomy_bindings.${pipeline}.rule_version`) });
  }
  return Object.freeze(result);
}

function legacyBindings(input) {
  return input.category_key==='motorcycle-accessories' && input.category_profile_version==='motorcycle-accessories-v1' ? LEGACY_MOTORCYCLE_BINDINGS:null;
}

function inferredMembershipScope(input) {
  const breadcrumbs=input.navigation?.breadcrumbs ?? [];
  return { site_country:input.site_country,language:input.language,currency:input.currency,
    primary_category:breadcrumbs.at(-2),subcategory:breadcrumbs.at(-1),sort_order:input.sort_order };
}

function validateMembershipScope(value,path) {
  object(value,path);return Object.freeze({ site_country:required(value.site_country,`${path}.site_country`),language:required(value.language,`${path}.language`),
    currency:required(value.currency,`${path}.currency`),primary_category:required(value.primary_category,`${path}.primary_category`),
    subcategory:required(value.subcategory,`${path}.subcategory`),sort_order:required(value.sort_order,`${path}.sort_order`) });
}

function validateLegacyMembershipScopes(input) {
  const values=input.legacy_membership_scopes ?? [];
  if (!Array.isArray(values)) fail('legacy_membership_scopes','必须是数组');
  if (values.length && input.category_key!=='motorcycle-accessories') throw new AppError('新 Category 不允许使用 Motorcycle legacy membership fallback。',{ code:'CATEGORY_SCOPE_UNRESOLVED',details:{ categoryKey:input.category_key } });
  return Object.freeze(values.map((value,index)=>validateMembershipScope(value,`legacy_membership_scopes[${index}]`)));
}

function validatePageHealth(input) {
  const defaults=input.category_key==='motorcycle-accessories'
    ? [input.display_name,'Motorcycles & Powersports Accessories']:[input.display_name];
  const names=input.page_health?.category_names??defaults;
  if(!Array.isArray(names)||!names.length)fail('page_health.category_names','必须是非空数组');
  return Object.freeze({category_names:Object.freeze([...new Set(names.map((value,index)=>required(value,`page_health.category_names[${index}]`)))])});
}

function validateNavigation(value) {
  object(value,'navigation');
  if (!Array.isArray(value.breadcrumbs)) fail('navigation.breadcrumbs','必须是数组');
  return Object.freeze({
    entry_method:required(value.entry_method,'navigation.entry_method'),
    breadcrumbs:Object.freeze(value.breadcrumbs.map((item,index) => required(item,`navigation.breadcrumbs[${index}]`))),
    category_confirmation_gate:boolean(value.category_confirmation_gate,'navigation.category_confirmation_gate')
  });
}

function validateBusinessRules(value) {
  object(value,'business_rules');
  const gate=required(value.default_gate,'business_rules.default_gate');
  if (!GATES.has(gate)) fail('business_rules.default_gate','不是支持的Catalog Gate');
  if (!Array.isArray(value.hard_exclusion_codes)) fail('business_rules.hard_exclusion_codes','必须是数组');
  const codes=[...new Set(value.hard_exclusion_codes.map(String))];
  const missing=REQUIRED_ELECTRONIC_EXCLUSION_CODES.filter(code => !codes.includes(code));
  if (missing.length) fail('business_rules.hard_exclusion_codes',`缺少硬排除代码：${missing.join(', ')}`);
  const countManual=boolean(value.count_manual_review_as_non_electronic,'business_rules.count_manual_review_as_non_electronic');
  if (countManual) fail('business_rules.count_manual_review_as_non_electronic','必须为 false');
  return Object.freeze({
    default_gate:gate,
    manual_review_on_low_confidence:boolean(value.manual_review_on_low_confidence,'business_rules.manual_review_on_low_confidence'),
    count_manual_review_as_non_electronic:countManual,
    hard_exclusion_codes:Object.freeze(codes),initial_pool_quality:validateInitialPoolQuality(value.initial_pool_quality)
  });
}

function validateInitialPoolQuality(value) {
  const floors={title:.95,price:.95,image:.95,sales:.90,rating:.90,review_count:.90};
  if(value===undefined)return Object.freeze(floors);object(value,'business_rules.initial_pool_quality');const result={};
  for(const [field,floor] of Object.entries(floors)){const number=Number(value[field]??floor);
    if(!Number.isFinite(number)||number<floor||number>1)fail(`business_rules.initial_pool_quality.${field}`,`必须位于 ${floor} 到 1`);result[field]=number;}
  return Object.freeze(result);
}

function stringArray(value,path,nonempty=false){if(!Array.isArray(value)||nonempty&&!value.length)fail(path,'必须是非空数组');
  return Object.freeze(value.map((item,index)=>required(item,`${path}[${index}]`)));}

function object(value,path) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path,'必须是对象'); }
function required(value,path) { const result=String(value ?? '').trim();if (!result) fail(path,'不能为空');return result; }
function slug(value,path) { const result=required(value,path);if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) fail(path,'必须是小写 kebab-case');return result; }
function boolean(value,path) { if (typeof value !== 'boolean') fail(path,'必须是布尔值');return value; }
function positiveInteger(value,path) { if (!Number.isInteger(Number(value)) || Number(value)<1) fail(path,'必须是正整数');return Number(value); }
function nonNegativeNumber(value,path) { if (!Number.isFinite(Number(value)) || Number(value)<0) fail(path,'必须是非负数字');return Number(value); }
function fail(fieldPath,message) { throw new ConfigError(`Category Profile ${fieldPath} ${message}。`,{ fieldPath:`category_profile.${fieldPath}` }); }
