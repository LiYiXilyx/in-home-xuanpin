import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCategoryProfile } from './category-profile.mjs';
import { AppError } from '../../shared/errors.mjs';

export function createCategoryProfileRegistry({ directory,builtInDirectory,operatorDirectory }={}) {
  const builtInRoot=path.resolve(requiredDirectory(builtInDirectory??directory));
  const sources=[{root:builtInRoot,origin:'BUILT_IN',required:true}];
  if(operatorDirectory)sources.push({root:path.resolve(operatorDirectory),origin:'OPERATOR_MANAGED',required:false});

  async function scan() {
    const profiles=[];const invalid=[];const identities=new Map();
    for(const source of sources){
      const entries=await readEntries(source);
      const names=entries.filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>entry.name).sort();
      for (const name of names) {
      try {
        const loaded=await loadCategoryProfile(path.join(source.root,name));
        const profile=source.origin==='BUILT_IN'&&!loaded.profile_origin
          ?Object.freeze({...loaded,profile_schema_version:1,profile_origin:'BUILT_IN',profile_kind:'MOTORCYCLE_RULED'}):loaded;
        if(profile.profile_origin!==source.origin)throw new AppError('Category Profile 来源不匹配。',{code:'CATEGORY_PROFILE_ORIGIN_MISMATCH'});
        const identity=`${profile.category_key}\u001f${profile.category_profile_version}`;
        if (identities.has(identity)) throw new AppError('Category Profile 身份重复。',{
          code:'CATEGORY_PROFILE_DUPLICATE',details:{ categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version,sourceNames:[identities.get(identity),`${source.origin}:${name}`] }
        });
        identities.set(identity,`${source.origin}:${name}`);profiles.push(profile);
      } catch (error) {
        if (error?.code==='CATEGORY_PROFILE_DUPLICATE') throw error;
        invalid.push({ source_name:name,profile_origin:source.origin,error_code:error?.code??'CATEGORY_PROFILE_INVALID',message:error?.message??'Category Profile 无效。' });
      }
      }
    }
    profiles.sort((a,b)=>a.category_key.localeCompare(b.category_key)||a.category_profile_version.localeCompare(b.category_profile_version));
    return { profiles:Object.freeze(profiles),invalid:Object.freeze(invalid) };
  }

  async function resolve({ categoryKey,categoryProfileVersion }={}) {
    const key=String(categoryKey??'').trim();const version=String(categoryProfileVersion??'').trim();
    const { profiles }=await scan();
    const sameCategory=profiles.filter(profile=>profile.category_key===key);
    if (!sameCategory.length) throw new AppError('Category Profile 不存在。',{ code:'CATEGORY_PROFILE_NOT_FOUND',details:{ categoryKey:key,categoryProfileVersion:version } });
    const exact=sameCategory.find(profile=>profile.category_profile_version===version);
    if (!exact) throw new AppError('Category Profile 版本不匹配。',{ code:'CATEGORY_PROFILE_VERSION_MISMATCH',details:{ categoryKey:key,categoryProfileVersion:version,availableVersions:sameCategory.map(profile=>profile.category_profile_version) } });
    return exact;
  }

  return Object.freeze({ list:scan,resolve });
}

async function readEntries(source){try{return await fs.readdir(source.root,{withFileTypes:true});}
  catch(cause){if(!source.required&&cause?.code==='ENOENT')return[];throw new AppError('无法读取 Category Profile 目录。',{
    code:'CATEGORY_PROFILE_DIRECTORY_INVALID',details:{directory:source.root,profileOrigin:source.origin},cause});}}

function requiredDirectory(value) {
  const result=String(value??'').trim();
  if (!result) throw new AppError('缺少 Category Profile 目录。',{ code:'CATEGORY_PROFILE_DIRECTORY_INVALID' });
  return result;
}
