import fs from 'node:fs/promises';
import { ConfigError } from '../../shared/errors.mjs';

export const REQUIRED_ELECTRONIC_EXCLUSION_CODES=Object.freeze([
  'ELECTRONIC_PRODUCT','USB_PRODUCT','BATTERY_PRODUCT','RECHARGEABLE_PRODUCT',
  'BLUETOOTH_PRODUCT','WIRELESS_COMMUNICATION','AUDIO_ELECTRONIC',
  'LIGHTING_ELECTRONIC','CERTIFICATION_RISK'
]);

const GATES=new Set(['non_electronic_unique_count','business_eligible_count','reviewable_unique_count']);

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
    navigation:validateNavigation(input.navigation),
    business_rules:validateBusinessRules(input.business_rules)
  };
  for (const field of ['exclude_electronics','exclude_usb','exclude_battery']) {
    if (!profile[field]) fail(field,'Catalog Scale V2 当前阶段必须为 true');
  }
  return Object.freeze(profile);
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
    hard_exclusion_codes:Object.freeze(codes)
  });
}

function object(value,path) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path,'必须是对象'); }
function required(value,path) { const result=String(value ?? '').trim();if (!result) fail(path,'不能为空');return result; }
function slug(value,path) { const result=required(value,path);if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) fail(path,'必须是小写 kebab-case');return result; }
function boolean(value,path) { if (typeof value !== 'boolean') fail(path,'必须是布尔值');return value; }
function positiveInteger(value,path) { if (!Number.isInteger(Number(value)) || Number(value)<1) fail(path,'必须是正整数');return Number(value); }
function nonNegativeNumber(value,path) { if (!Number.isFinite(Number(value)) || Number(value)<0) fail(path,'必须是非负数字');return Number(value); }
function fail(fieldPath,message) { throw new ConfigError(`Category Profile ${fieldPath} ${message}。`,{ fieldPath:`category_profile.${fieldPath}` }); }
