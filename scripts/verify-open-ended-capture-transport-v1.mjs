import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {migrateDatabase} from '../src/db/migrate.mjs';
import {openDatabase} from '../src/db/client.mjs';
import {normalizeOperatorCategoryProfile} from '../src/modules/catalog-scale/operator-category-profile.mjs';
import {createCatalogCampaignService} from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import {resolveCaptureTransportPolicy} from '../src/modules/catalog-scale/capture-transport-policy.mjs';

export async function runOpenEndedCaptureTransportVerification(options={}){
  const supplied=options.root?path.resolve(options.root):null,tmp=path.resolve(os.tmpdir());
  if(supplied&&(!inside(tmp,supplied)||!path.basename(supplied).startsWith('temu-open-ended-transport-')))throw coded('VERIFIER_TEMP_ROOT_REQUIRED','Verifier 只接受自己命名的临时根。');
  const root=supplied??fs.mkdtempSync(path.join(tmp,'temu-open-ended-transport-')),created=!supplied,databasePath=path.join(root,'fixture.db');
  migrateDatabase({databasePath});const db=openDatabase(databasePath);
  try{
    const profile=normalizeOperatorCategoryProfile({display_name:'Girls Sets',page_category_name:"Girls' Sets",category_aliases:["Girls' Sets"],parent_category:"Kids' Fashion",breadcrumbs:["Kids' Fashion","Girls' Sets"],listing_url:'https://www.temu.com/de-en/girls-sets-o3-1088.html'}),service=createCatalogCampaignService(db),createdCampaign=service.createOperatorInitialCampaign({profile,campaignName:'Verifier Girls Initial',requestId:'verify-girls-initial'}),source=service.currentOperatorManualContext().source;
    const first=service.captureExtensionBatch(payload(profile,createdCampaign.campaignId,source.id,'batch-existing',[card('1',1,'DOM')]));
    const visible40=Array.from({length:40},(_,index)=>card(String(index+1),index+1,index===0?'NETWORK_ENRICHED':'DOM'));
    const second=service.captureExtensionBatch(payload(profile,createdCampaign.campaignId,source.id,'batch-visible-40',visible40)),batchesBeforeReplay=tableCount(db,'catalog_capture_batches');
    const replay=service.captureExtensionBatch(payload(profile,createdCampaign.campaignId,source.id,'batch-visible-40',visible40)),batchesAfterReplay=tableCount(db,'catalog_capture_batches');
    const more=Array.from({length:10},(_,index)=>card(String(index+41),index+41,'DOM'));
    const third=service.captureExtensionBatch(payload(profile,createdCampaign.campaignId,source.id,'batch-see-more',more));
    const status=service.getInitialOperatorStatus(createdCampaign.campaignId),stored=JSON.parse(db.prepare('SELECT config_json FROM catalog_campaigns WHERE id=?').get(createdCampaign.campaignId).config_json),girlsCampaigns=Number(db.prepare('SELECT COUNT(*) count FROM catalog_campaigns WHERE category_key=?').get(profile.category_key).count),crossCategory=Number(db.prepare('SELECT COUNT(*) count FROM catalog_initial_pool_candidate_items WHERE campaign_id<>?').get(createdCampaign.campaignId).count),strict=resolveCaptureTransportPolicy({campaign:{campaignType:'refresh',browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE'},profile});
    return{gates:{INITIAL_OPEN_ENDED:createdCampaign.targetCount===null&&createdCampaign.remaining===null?'PASS':'FAIL',FROZEN_DOM_OPTIONAL:stored.captureTransportPolicy==='DOM_REQUIRED_NETWORK_OPTIONAL'?'PASS':'FAIL',EXISTING_ONE:first.audit.acceptedGoods===1?'PASS':'FAIL',VISIBLE_40_DELTA:second.audit.acceptedGoods===39&&status.liveUniqueCount===50?'PASS':'FAIL',IDEMPOTENT_REPLAY:replay.idempotentReplay===true&&batchesAfterReplay===batchesBeforeReplay?'PASS':'FAIL',SEE_MORE_INCREMENT:third.audit.acceptedGoods===10?'PASS':'FAIL',ACTUAL_TRANSPORT_AUDIT:second.audit.networkEnrichedSaved===1&&second.audit.domOnlySaved===39?'PASS':'FAIL',GIRLS_PROFILE_CAMPAIGN_ONE:girlsCampaigns===1?'PASS':'FAIL',CROSS_CATEGORY_ZERO:crossCategory===0?'PASS':'FAIL',STRICT_DEFAULT_PRESERVED:strict.policy==='NETWORK_ENRICHED_REQUIRED'?'PASS':'FAIL'},production_database_writes:0,real_temu_capture_started:false};
  }finally{db.close();if(created)await fsp.rm(root,{recursive:true,force:true});}
}

function payload(profile,campaignId,sourceId,batchId,cards){const pageUrl=profile.listing_url,boundAt='2026-09-03T00:00:00.000Z',binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,source_id:sourceId,category_key:profile.category_key,category_profile_version:profile.category_profile_version,site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',bound_url:pageUrl,bound_at:boundAt,bound_category:"Girls' Sets",bound_breadcrumbs:[...profile.breadcrumbs],bound_sort:'Top Sales',bound_goods_count:cards.length};binding.context_fingerprint=fnv([binding.bound_url,binding.site_country,binding.language,binding.currency,binding.category_key,binding.bound_category,binding.bound_sort,binding.bound_breadcrumbs]);return{campaign_id:campaignId,source_id:sourceId,batch_id:batchId,category_key:profile.category_key,category_profile_version:profile.category_profile_version,page_url:pageUrl,page_title:"Girls' Sets",captured_at:'2026-09-03T00:01:00.000Z',page_context:{site_country:'DE',language:'en',currency:'EUR',category_key:profile.category_key,category_profile_version:profile.category_profile_version,sort_order:'Top Sales'},capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards:cards.map(value=>({...value,network_observed:value.capture_transport==='NETWORK_ENRICHED',network_endpoint:value.capture_transport==='NETWORK_ENRICHED'?'/api/poppy/v1/opt':null,network_observed_at:value.capture_transport==='NETWORK_ENRICHED'?'2026-09-03T00:00:30.000Z':null,bound_url:binding.bound_url,bound_at:binding.bound_at,bound_category:binding.bound_category,bound_sort:binding.bound_sort}))};}
function card(goodsId,rank,transport){return{goods_id:goodsId,title:`Girls Set ${goodsId}`,href:`https://www.temu.com/de-en/girls-set-g-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,listing_rank:rank,business_eligible:true,reviewable:true,capture_transport:transport};}
function fnv(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function inside(root,target){const relative=path.relative(root,target);return relative&&!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative);}
function tableCount(db,table){return Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);}
function coded(code,message){const error=new Error(message);error.code=code;return error;}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)runOpenEndedCaptureTransportVerification().then(result=>{console.log(JSON.stringify(result,null,2));if(Object.values(result.gates).some(value=>value!=='PASS'))process.exitCode=1;}).catch(error=>{console.error(error?.stack??error);process.exitCode=1;});
