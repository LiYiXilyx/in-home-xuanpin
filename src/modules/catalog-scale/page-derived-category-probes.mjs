import crypto from 'node:crypto';
import {AppError} from '../../shared/errors.mjs';
import {descriptorContract,resolvePageDerivedCategory} from './page-derived-category-profile.mjs';

export function createCategoryProbeService({registry,store,clock=Date.now,ttlMs=300000,maxProbes=100}){
 const probes=new Map(),requests=new Map();let latest=null;
 const fail=code=>{throw new AppError(code,{code});};
 async function resolve(d){const result=await registry.list();if(result.invalid?.length)fail('CATEGORY_PROFILE_CONFLICT');return resolvePageDerivedCategory(d,result.profiles);}
 function exact(id){const p=probes.get(id);if(!p)fail('CATEGORY_PROBE_NOT_FOUND');if(clock()>=p.expires_at_ms)fail('CATEGORY_PROBE_EXPIRED');return p;}
 async function create(input){
  const descriptor=descriptorContract.validateDescriptor(input),result=await resolve(descriptor);
  for(const [id,p] of probes)if(clock()>=p.expires_at_ms){probes.delete(id);for(const [key,value] of requests)if(value.probe_id===id)requests.delete(key);}
  if(probes.size>=maxProbes)fail('CATEGORY_PROBE_CAPACITY_EXCEEDED');
  const p=Object.freeze({probe_id:crypto.randomUUID(),descriptor,descriptor_fingerprint:crypto.createHash('sha256').update(JSON.stringify(descriptor)).digest('hex'),resolution:result.resolution,profile:result.profile??null,code:result.code??null,created_at:new Date(clock()).toISOString(),expires_at:new Date(clock()+ttlMs).toISOString(),expires_at_ms:clock()+ttlMs});
  probes.set(p.probe_id,p);latest=p.probe_id;return p;
 }
 async function current(){const p=probes.get(latest);return p&&clock()<p.expires_at_ms?p:null;}
 async function register({probe_id,descriptor_fingerprint,request_id}={}){
  const p=exact(probe_id);if(p.descriptor_fingerprint!==descriptor_fingerprint)fail('CATEGORY_PROBE_CONTEXT_MISMATCH');
  if(typeof request_id!=='string'||!request_id.trim()||request_id.length>200)fail('CATEGORY_PROBE_CONTEXT_MISMATCH');
  const previous=requests.get(request_id);if(previous&&previous.fingerprint!==descriptor_fingerprint)fail('CATEGORY_PROBE_CONTEXT_MISMATCH');
  if(requests.size>=1000&&!previous)fail('CATEGORY_PROBE_CAPACITY_EXCEEDED');
  if(p.resolution==='BLOCKED')fail(p.code);
  return store.withRegistrationLock(async write=>{
   exact(probe_id);const result=await resolve(p.descriptor);if(result.resolution==='BLOCKED')fail(result.code);
   let response;
   if(result.resolution==='EXISTING')response={profile:result.profile,profile_reused:true};
   else {const saved=await write({requestId:request_id,...result.draft},result.profile);response={profile:saved.profile,profile_reused:false};}
   requests.set(request_id,{fingerprint:descriptor_fingerprint,probe_id});return response;
  });
 }
 return Object.freeze({create,current,register});
}
