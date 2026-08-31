import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateDatabase } from '../src/db/migrate.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createCatalogCampaignService } from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { REQUIRED_ELECTRONIC_EXCLUSION_CODES,validateCategoryProfile } from '../src/modules/catalog-scale/category-profile.mjs';

export async function runInitialPoolSafetyVerification() {
  if(process.env.TEMU_CONFIG_PATH||process.argv.includes('--config'))throw new Error('Initial safety verifier禁止读取正式配置。');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-initial-safety-')),databasePath=path.join(directory,'fixture.db');
  let db;
  try {
    migrateDatabase({databasePath});db=openDatabase(databasePath);const now=clock(),service=createCatalogCampaignService(db,{now});
    const profile=fixtureProfile();
    const protectedCampaign=service.createCampaign({name:'Protected Motorcycle',campaignType:'test',profile:{...profile,
      category_key:'motorcycle-accessories',category_profile_version:'motorcycle-accessories-v1',display_name:'Motorcycle Accessories',
      taxonomy:'motorcycle-accessories',membership_scope:{...profile.membership_scope,primary_category:'Automotive',subcategory:'Motorcycle Accessories'},
      page_health:{category_names:['Motorcycle Accessories']},taxonomy_bindings:{classify:{taxonomy_name:'week1-motorcycle-accessories',taxonomy_version:null,rule_version:'week1-rule-v1'},
        fine_classify:{taxonomy_name:'week2-motorcycle-fine-v1',taxonomy_version:null,rule_version:'week2-fine-rule-v1'},
        opportunity:{taxonomy_name:'motorcycle-opportunity',taxonomy_version:'motorcycle-opportunity-v2',rule_version:'active-pool-rule-v2'}}},targetCount:1});
    db.prepare(`INSERT INTO catalog_pool_versions(id,campaign_id,category_key,category_profile_version,product_count,
      non_electronic_unique_count,status,activated_at,created_at,updated_at) VALUES('protected-motorcycle-pool',?,?,?,0,0,'active',?,?,?)`)
      .run(protectedCampaign.id,'motorcycle-accessories','motorcycle-accessories-v1',now(),now(),now());
    const protectedBefore=protectedFingerprint(db);
    const targeted=service.createCampaign({name:'Targeted Control',campaignType:'refresh',profile,targetCount:5});
    const targetedBefore=service.getCampaign(targeted.id);
    const created=service.createOperatorInitialCampaign({profile,campaignName:'Verifier Initial',requestId:'verifier-create'});
    const context=service.currentOperatorManualContext();service.captureExtensionBatch(capturePayload(profile,created.campaignId,context.source.id));
    const afterCapture=service.getInitialOperatorStatus(created.campaignId);
    const qa=service.runInitialPoolQa({campaignId:created.campaignId,categoryKey:profile.category_key,
      categoryProfileVersion:profile.category_profile_version,requestId:'verifier-qa'});
    const activated=service.activateInitialPool({campaignId:created.campaignId,categoryKey:profile.category_key,
      categoryProfileVersion:profile.category_profile_version,requestId:'verifier-activate'});
    const protectedAfter=protectedFingerprint(db),targetedAfter=service.getCampaign(targeted.id);
    const gates={
      INITIAL_SENTINEL_STORAGE_ONLY:db.prepare('SELECT target_count FROM catalog_campaigns WHERE id=?').get(created.campaignId).target_count===2147483647&&created.targetCount===null?'YES':'NO',
      INITIAL_SENTINEL_EXPOSED_TO_UI:JSON.stringify(created).includes('2147483647')?'YES':'NO',
      INITIAL_AUTO_STOP_BY_SENTINEL:afterCapture.status==='running'&&afterCapture.liveUniqueCount===10?'NO':'YES',
      INITIAL_QA_DEPENDS_ON_TARGET:qa.status==='PASSED_CURRENT'?'NO':'YES',
      EXISTING_TARGET_CAMPAIGNS_UNCHANGED:targetedBefore.targetCount===5&&targetedAfter.targetCount===5&&targetedAfter.status===targetedBefore.status?'YES':'NO',
      INITIAL_OPEN_ENDED_CAPTURE:afterCapture.quantityMode==='OPEN_ENDED'&&afterCapture.targetCount===null?'YES':'NO',
      ACTIVATION_REQUIRES_EXPLICIT_OPERATOR_ACTION:activated.productCount===10?'YES':'NO',
      ACTIVATION_CATEGORY_SCOPED:activated.categoryKey===profile.category_key?'YES':'NO',
      ACTIVATION_IDEMPOTENT:service.activateInitialPool({campaignId:created.campaignId,categoryKey:profile.category_key,
        categoryProfileVersion:profile.category_profile_version,requestId:'verifier-activate'}).poolVersionId===activated.poolVersionId?'YES':'NO',
      MOTORCYCLE_POOL_UNCHANGED:JSON.stringify(protectedBefore)===JSON.stringify(protectedAfter)?'YES':'NO',
      SAFE_FOR_NEW_CATEGORY_INITIAL_10_ROW_DRY_RUN:'YES'
    };
    if(Object.values(gates).some(value=>!['YES','NO'].includes(value)))throw new Error('Verifier Gate输出无效。');
    if(Object.entries(gates).some(([name,value])=>name!=='INITIAL_SENTINEL_EXPOSED_TO_UI'&&name!=='INITIAL_AUTO_STOP_BY_SENTINEL'&&name!=='INITIAL_QA_DEPENDS_ON_TARGET'&&value!=='YES'))
      throw new Error(`Initial safety verifier失败：${JSON.stringify(gates)}`);
    if(gates.INITIAL_SENTINEL_EXPOSED_TO_UI!=='NO'||gates.INITIAL_AUTO_STOP_BY_SENTINEL!=='NO'||gates.INITIAL_QA_DEPENDS_ON_TARGET!=='NO')
      throw new Error(`Initial negative Gate失败：${JSON.stringify(gates)}`);
    return {temporaryDatabase:true,productionDatabaseWrites:0,realTemuCaptureStarted:false,campaignAutoCreated:false,
      evidence:{captured:afterCapture.liveUniqueCount,qaCandidateCount:qa.qaCandidateCount,activated:activated.productCount},gates};
  } finally {db?.close();fs.rmSync(directory,{recursive:true,force:true});}
}

function fixtureProfile(){return validateCategoryProfile({category_key:'fixture-category-b',category_profile_version:'fixture-category-b-v1',
  display_name:'Fixture Category B',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',target_count:2000,
  exclude_electronics:true,exclude_usb:true,exclude_battery:true,price_min_eur:5,taxonomy:'fixture-category-b',
  membership_scope:{site_country:'DE',language:'en',currency:'EUR',primary_category:'Fixture',subcategory:'Category B',sort_order:'Top Sales'},
  page_health:{category_names:['Fixture Category B']},taxonomy_bindings:{classify:{taxonomy_name:'fixture-classify',taxonomy_version:null,rule_version:'v1'},
    fine_classify:{taxonomy_name:'fixture-fine',taxonomy_version:'v1',rule_version:'v1'},opportunity:{taxonomy_name:'fixture-opportunity',taxonomy_version:'v1',rule_version:'v1'}},
  legacy_membership_scopes:[],navigation:{entry_method:'site_menu',breadcrumbs:['Fixture','Category B'],category_confirmation_gate:true},
  business_rules:{default_gate:'non_electronic_unique_count',manual_review_on_low_confidence:true,count_manual_review_as_non_electronic:false,
    hard_exclusion_codes:[...REQUIRED_ELECTRONIC_EXCLUSION_CODES]}});}
function capturePayload(profile,campaignId,sourceId){const pageUrl='https://www.temu.com/de-en/fixture-category-b.html',boundAt='2026-08-31T18:00:00.000Z',
  binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,source_id:sourceId,
    category_key:profile.category_key,category_profile_version:profile.category_profile_version,site_country:'DE',language:'en',currency:'EUR',
    sort_order:'Top Sales',bound_url:pageUrl,bound_at:boundAt,bound_category:'Fixture Category B',bound_sort:'Top Sales',bound_goods_count:10};
  binding.context_fingerprint=fingerprint([binding.bound_url,binding.site_country,binding.language,binding.currency,binding.category_key,binding.bound_category,binding.bound_sort]);
  const cards=Array.from({length:10},(_,index)=>{const goodsId=String(index+1);return{goods_id:goodsId,title:`Fixture Item ${goodsId}`,
    href:`https://www.temu.com/de-en/item-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',
    sales_count:100,rating:4.8,review_count:20,listing_rank:index+1,business_eligible:true,reviewable:true,capture_transport:'NETWORK_ENRICHED',
    network_observed:true,network_endpoint:'/api/poppy/v1/opt',network_observed_at:boundAt,bound_url:pageUrl,bound_at:boundAt,
    bound_category:'Fixture Category B',bound_sort:'Top Sales'};});
  return{campaign_id:campaignId,source_id:sourceId,batch_id:'verifier-batch',category_key:profile.category_key,
    category_profile_version:profile.category_profile_version,page_url:pageUrl,page_title:'Fixture Category B',captured_at:boundAt,
    page_context:{site_country:'DE',language:'en',currency:'EUR',category_key:profile.category_key,
      category_profile_version:profile.category_profile_version,sort_order:'Top Sales'},capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards};}
function protectedFingerprint(db){return{pools:db.prepare(`SELECT id,status,product_count FROM catalog_pool_versions WHERE category_key='motorcycle-accessories' ORDER BY id`).all(),
  memberships:db.prepare(`SELECT id,active FROM catalog_memberships WHERE category_key='motorcycle-accessories' ORDER BY id`).all()};}
function fingerprint(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function clock(){let tick=0;return()=>new Date(Date.UTC(2026,7,31,18,0,tick++)).toISOString();}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(isMain)console.log(JSON.stringify(await runInitialPoolSafetyVerification(),null,2));
