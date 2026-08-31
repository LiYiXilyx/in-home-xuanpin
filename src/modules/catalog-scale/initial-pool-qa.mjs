const QUALITY_FLOORS=Object.freeze({title:.95,price:.95,image:.95,sales:.90,rating:.90,review_count:.90});

export function evaluateInitialPoolQa(input) {
  const nowMs=input.nowMs ?? (()=>Date.now());const checks=[];
  const gate=(name,errorCode,operation)=>checks.push(timedGate(name,errorCode,operation,nowMs));
  const {campaign,profile,candidateItems,batchContexts,membershipEvidence}=input;
  gate('campaign_identity','INITIAL_CAMPAIGN_IDENTITY_INVALID',()=>campaign?.campaignType==='initial'
    && campaign.categoryKey===profile.category_key&&campaign.categoryProfileVersion===profile.category_profile_version);
  gate('candidate_nonempty','INITIAL_POOL_EMPTY',()=>candidateItems.length>0);
  gate('goods_id_uniqueness','INITIAL_GOODS_ID_DUPLICATE',()=>{
    const identities=new Set(candidateItems.map(row=>`${row.platform}\u001f${row.goodsId}`));
    const goods=new Set(candidateItems.map(row=>row.goodsId));return identities.size===candidateItems.length&&goods.size===candidateItems.length;});
  gate('category_scope','INITIAL_CROSS_CATEGORY_CONTAMINATION',()=>candidateItems.every(row=>
    row.categoryKey===campaign.categoryKey&&row.categoryProfileVersion===campaign.categoryProfileVersion));
  gate('market_context','INITIAL_MARKET_CONTEXT_INVALID',()=>batchContexts.length>0&&batchContexts.every(row=>
    row.siteCountry===profile.site_country&&row.language===profile.language&&row.currency===profile.currency));
  gate('source_context','INITIAL_SOURCE_CONTEXT_INVALID',()=>batchContexts.every(row=>
    row.sortOrder===profile.sort_order&&row.captureMode==='MANUAL_BIND_PASSIVE_CAPTURE')&&candidateItems.every(item=>
    batchContexts.some(context=>context.sourceId===item.sourceId&&context.batchId===item.firstBatchId)));
  gate('page_health','INITIAL_PAGE_HEALTH_INVALID',()=>batchContexts.every(row=>row.pageHealthStatus==='READY'
    &&!row.captchaBlocking&&!row.searchNoResults&&(row.domReady||row.networkReady)));
  gate('binding_evidence','INITIAL_BINDING_EVIDENCE_INVALID',()=>batchContexts.every(row=>Boolean(row.bindingFingerprint)));
  gate('required_product_fields','INITIAL_DATA_QUALITY_FAILED',()=>qualityPassed(candidateItems,
    profile.business_rules?.initial_pool_quality??QUALITY_FLOORS));
  gate('taxonomy_binding_structure','INITIAL_TAXONOMY_BINDING_INVALID',()=>
    ['classify','fine_classify','opportunity'].every(pipeline=>Boolean(profile.taxonomy_bindings?.[pipeline])));
  gate('membership_unambiguous','INITIAL_MEMBERSHIP_AMBIGUOUS',()=>!membershipEvidence.ambiguous);
  gate('membership_isolation','INITIAL_CROSS_CATEGORY_CONTAMINATION',()=>!membershipEvidence.crossCategoryContamination);
  gate('sqlite_integrity','SQLITE_INTEGRITY_FAILED',()=>input.integrityCheck()==='ok');
  gate('sqlite_foreign_keys','SQLITE_FOREIGN_KEY_FAILED',()=>input.foreignKeyCheck().length===0);
  const failureCodes=[...new Set(checks.filter(check=>!check.passed).map(check=>check.errorCode))];
  return {passed:failureCodes.length===0,checks,failureCodes,durationMs:checks.reduce((sum,check)=>sum+check.durationMs,0)};
}

function timedGate(name,errorCode,operation,nowMs) {
  const started=nowMs();let passed=false;let details={};
  try { const value=operation();passed=typeof value==='object'?Boolean(value.passed):Boolean(value);details=value?.details??{}; }
  catch (error) { details={message:error.message}; }
  return {name,passed,errorCode:passed?null:errorCode,durationMs:Math.max(0,nowMs()-started),details};
}
function qualityPassed(items,thresholds) {
  if(!items.length)return false;const fields={title:'title',price:'price_amount',image:'image_url',sales:'sales_count',rating:'rating',review_count:'review_count'};
  return Object.entries(fields).every(([key,field])=>items.filter(item=>present(item.activationPayload?.[field])).length/items.length
    >=Math.max(QUALITY_FLOORS[key],Number(thresholds[key]??QUALITY_FLOORS[key])));
}
function present(value){return value!==null&&value!==undefined&&value!=='';}
