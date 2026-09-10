import {createOperatorCategoryProfileStore} from '../../src/modules/catalog-scale/operator-category-profile-store.mjs';
import {createCategoryProfileRegistry} from '../../src/modules/catalog-scale/category-profile-registry.mjs';
import {normalizeOperatorCategoryProfile} from '../../src/modules/catalog-scale/operator-category-profile.mjs';
import {createCategoryProbeService} from '../../src/modules/catalog-scale/page-derived-category-probes.mjs';
if(process.send){
const [root,built,id]=process.argv.slice(2);
const registry=createCategoryProfileRegistry({builtInDirectory:built,operatorDirectory:root});
const store=createOperatorCategoryProfileStore({root,validateInput:normalizeOperatorCategoryProfile});
const service=createCategoryProbeService({registry,store});
const p=await service.create({descriptor_schema_version:1,page_url:'https://www.temu.com/de-en/pet-beds-o3-100.html',page_type:'CATEGORY_LISTING',site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',breadcrumbs:['Home','Pets','Pet Beds'],dom_goods_count:40,captcha_blocking:false,security_verification:false,search_no_results:false,detected_at:new Date().toISOString()});
process.send('ready');process.once('message',async()=>{try{process.send(await service.register({probe_id:p.probe_id,descriptor_fingerprint:p.descriptor_fingerprint,request_id:id}));}catch(e){process.send({code:e.code});}finally{process.disconnect();}});
}
