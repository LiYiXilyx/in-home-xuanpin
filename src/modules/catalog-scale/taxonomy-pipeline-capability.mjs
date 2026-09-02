const IMPLEMENTED = Object.freeze({
  'motorcycle-accessories': Object.freeze({
    classify: Object.freeze({ taxonomy_name: 'week1-motorcycle-accessories', taxonomy_version: null, rule_version: 'week1-rule-v1' }),
    fine_classify: Object.freeze({ taxonomy_name: 'week2-motorcycle-fine-v1', taxonomy_version: null, rule_version: 'week2-fine-rule-v1' }),
    opportunity: Object.freeze({ taxonomy_name: 'motorcycle-opportunity', taxonomy_version: 'motorcycle-opportunity-v2', rule_version: 'active-pool-rule-v2' })
  })
});

export function hasTaxonomyPipelineImplementation(profile, pipeline) {
  const expected = IMPLEMENTED[profile?.category_key]?.[pipeline];
  const actual = profile?.taxonomy_bindings?.[pipeline];
  return Boolean(expected && actual
    && expected.taxonomy_name === actual.taxonomy_name
    && expected.taxonomy_version === actual.taxonomy_version
    && expected.rule_version === actual.rule_version);
}

export function assertTaxonomyPipelineAvailable(profile,pipeline){
  if(profile?.profile_kind==='CAPTURE_ONLY'||profile?.taxonomy?.status==='UNCONFIGURED'){
    const error=new Error(`Category taxonomy pipeline 未配置：${pipeline}`);
    error.code='CATEGORY_TAXONOMY_UNCONFIGURED';error.details={categoryKey:profile?.category_key,pipeline};throw error;
  }
  if(!hasTaxonomyPipelineImplementation(profile,pipeline)){
    const error=new Error(`Category taxonomy pipeline 不可用：${pipeline}`);
    error.code='CATEGORY_TAXONOMY_UNAVAILABLE';throw error;
  }
  return true;
}
