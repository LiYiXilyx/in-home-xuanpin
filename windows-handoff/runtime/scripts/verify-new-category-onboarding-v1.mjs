import crypto from 'node:crypto';import fs from 'node:fs';import fsp from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {migrateDatabase} from '../src/db/migrate.mjs';import {openDatabase} from '../src/db/client.mjs';
import {createCategoryProfileRegistry} from '../src/modules/catalog-scale/category-profile-registry.mjs';
import {createOperatorCategoryProfileStore} from '../src/modules/catalog-scale/operator-category-profile-store.mjs';
import {normalizeOperatorCategoryProfile} from '../src/modules/catalog-scale/operator-category-profile.mjs';
import {createCatalogCampaignService} from '../src/modules/catalog-scale/catalog-campaign-service.mjs';
import {createCatalogScopedExportRepository} from '../src/db/repositories/catalog-scoped-export-repository.mjs';
import {createCatalogScopedExportService} from '../src/modules/catalog-scale/catalog-scoped-export-service.mjs';

const projectRoot=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const yingdaoOwned=['ui/modules/yingdao','ui/sourcing-review.css','src/modules/sourcing','src/server/controllers/sourcing-controller.mjs'];

export async function runNewCategoryOnboardingVerification(options={}){
  const supplied=options.root?path.resolve(options.root):null;
  if(supplied&&(!inside(path.resolve(os.tmpdir()),supplied)||!path.basename(supplied).startsWith('temu-new-category-verifier-')))throw coded('VERIFIER_TEMP_ROOT_REQUIRED','Verifier 只接受自己命名的临时根。');
  const root=supplied??fs.mkdtempSync(path.join(os.tmpdir(),'temu-new-category-verifier-')),created=!supplied;
  const beforeYingdao=await treeHash(yingdaoOwned),builtIn=path.join(root,'built-in'),operator=path.join(root,'operator-profiles'),output=path.join(root,'exports'),databasePath=path.join(root,'fixture.db');
  fs.mkdirSync(builtIn,{recursive:true});migrateDatabase({databasePath});const db=openDatabase(databasePath);
  try{
    const registry=createCategoryProfileRegistry({builtInDirectory:builtIn,operatorDirectory:operator});
    const store=createOperatorCategoryProfileStore({root:operator,builtInRegistry:{async list(){return{profiles:[]};}},validateInput:normalizeOperatorCategoryProfile});
    const draft={display_name:'Pet Supplies',page_category_name:'Pet Supplies',category_aliases:['Pet Supplies','Pets'],parent_category:'Home & Pet',breadcrumbs:['Home & Pet','Pet Supplies'],listing_url:'https://www.temu.com/de-en/pet-supplies.html'};
    const validated=await store.validate(draft);if(fs.existsSync(operator))throw coded('VERIFIER_VALIDATE_WROTE','Validate 写入了文件。');
    const saved=await store.register({requestId:'verify-profile',...draft}),profile=await registry.resolve({categoryKey:saved.profile.category_key,categoryProfileVersion:saved.profile.category_profile_version});
    const service=createCatalogCampaignService(db),createdCampaign=service.createOperatorInitialCampaign({profile,campaignName:'Verifier Pet Initial',requestId:'verify-campaign'}),source=service.currentOperatorManualContext().source;
    service.captureExtensionBatch(capturePayload(profile,createdCampaign.campaignId,source.id));const status=service.getInitialOperatorStatus(createdCampaign.campaignId);
    const repository=createCatalogScopedExportRepository(db),exporter=createCatalogScopedExportService({repository,outputDir:output}),previewBefore=dbFingerprint(db);
    const preview=await exporter.exportPreview({campaignId:createdCampaign.campaignId,candidateRevision:status.candidateRevision,categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version});
    const previewZeroWrites=equal(previewBefore,dbFingerprint(db));
    const qa=service.runInitialPoolQa({campaignId:createdCampaign.campaignId,categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version,requestId:'verify-qa'});
    if(qa.status!=='PASSED_CURRENT')throw coded('VERIFIER_QA_FAILED','临时 Initial QA 未通过。');
    const activation=service.activateInitialPool({campaignId:createdCampaign.campaignId,categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version,requestId:'verify-activation'}),formalBefore=dbFingerprint(db);
    const formal=await exporter.exportFormalPool({poolVersionId:activation.poolVersionId,categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version});
    const formalZeroWrites=equal(formalBefore,dbFingerprint(db)),afterYingdao=await treeHash(yingdaoOwned);
    const gates={PROFILE_VALIDATE_ZERO_WRITES:validated.category_key===profile.category_key?'PASS':'FAIL',PROFILE_REGISTER_RELOAD:'PASS',
      INITIAL_OPEN_ENDED:createdCampaign.targetCount===null&&createdCampaign.remaining===null?'PASS':'FAIL',MANUAL_BIND_CAPTURE:status.liveUniqueCount===2?'PASS':'FAIL',
      PREVIEW_EXACT_SCOPE:preview.scope.candidate_revision===status.candidateRevision?'PASS':'FAIL',PREVIEW_EXPORT_DB_WRITES:previewZeroWrites?'PASS':'FAIL',
      INITIAL_QA:'PASS',POOL_ACTIVATION:activation.productCount===2?'PASS':'FAIL',FORMAL_EXACT_SCOPE:formal.scope.pool_version_id===activation.poolVersionId?'PASS':'FAIL',
      FORMAL_EXPORT_DB_WRITES:formalZeroWrites?'PASS':'FAIL',TAXONOMY_FALLBACK_BLOCKED:profile.taxonomy.status==='UNCONFIGURED'&&!profile.capabilities.classification_available?'PASS':'FAIL',
      CROSS_CATEGORY_EXPORT_ROWS:formal.product_count===2?'PASS':'FAIL',YINGDAO_FILES_UNCHANGED:beforeYingdao===afterYingdao?'PASS':'FAIL'};
    return{gates,profile:{category_key:profile.category_key,category_profile_version:profile.category_profile_version},preview,formal,
      production_database_writes:0,real_temu_capture_started:false};
  }finally{db.close();if(created)await fsp.rm(root,{recursive:true,force:true});}
}

function capturePayload(profile,campaignId,sourceId){const pageUrl=profile.listing_url,boundAt='2026-09-02T00:00:00.000Z',breadcrumbs=[...profile.breadcrumbs],binding={status:'BOUND',binding_version:'manual-bind-v1',binding_generation:1,campaign_id:campaignId,source_id:sourceId,category_key:profile.category_key,category_profile_version:profile.category_profile_version,site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',bound_url:pageUrl,bound_at:boundAt,bound_category:'Pets',bound_breadcrumbs:breadcrumbs,bound_sort:'Top Sales',bound_goods_count:2};binding.context_fingerprint=fnv([binding.bound_url,binding.site_country,binding.language,binding.currency,binding.category_key,binding.bound_category,binding.bound_sort,binding.bound_breadcrumbs]);const cards=['20','3'].map((goodsId,index)=>({goods_id:goodsId,title:`Pet Product ${goodsId}`,href:`https://www.temu.com/de-en/item-g-${goodsId}.html`,image_url:`https://img.test/${goodsId}.jpg`,price_amount:12,currency:'EUR',sales_count:100,rating:4.8,review_count:20,listing_rank:index+1,business_eligible:true,reviewable:true,capture_transport:'NETWORK_ENRICHED',network_observed:true,network_endpoint:'/api/poppy/v1/opt',network_observed_at:'2026-09-02T00:00:30.000Z',bound_url:pageUrl,bound_at:boundAt,bound_category:'Pets',bound_sort:'Top Sales'}));return{campaign_id:campaignId,source_id:sourceId,batch_id:'verify-batch',category_key:profile.category_key,category_profile_version:profile.category_profile_version,page_url:pageUrl,page_title:'Pets',captured_at:'2026-09-02T00:01:00.000Z',page_context:{site_country:'DE',language:'en',currency:'EUR',category_key:profile.category_key,category_profile_version:profile.category_profile_version,sort_order:'Top Sales'},capture_mode:'MANUAL_BIND_PASSIVE_CAPTURE',page_binding:binding,cards};}
function fnv(value){let hash=2166136261;for(const char of JSON.stringify(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function dbFingerprint(db){return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT COUNT(*) count FROM "${name}"`).get().count]));}
async function treeHash(paths){const hash=crypto.createHash('sha256');for(const relative of paths){const target=path.join(projectRoot,relative);for(const file of await files(target)){hash.update(path.relative(projectRoot,file));hash.update(await fsp.readFile(file));}}return hash.digest('hex');}
async function files(target){const stat=await fsp.stat(target).catch(()=>null);if(!stat)return[];if(stat.isFile())return[target];const result=[];for(const entry of (await fsp.readdir(target,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const child=path.join(target,entry.name);if(entry.isDirectory())result.push(...await files(child));else if(entry.isFile())result.push(child);}return result;}
function inside(root,target){const relative=path.relative(root,target);return relative&&!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative);}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function coded(code,message){const error=new Error(message);error.code=code;return error;}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){runNewCategoryOnboardingVerification().then(result=>{
  console.log(JSON.stringify(result,null,2));if(Object.values(result.gates).some(value=>value!=='PASS'))process.exitCode=1;
}).catch(error=>{console.error(error?.stack??error);process.exitCode=1;});}
