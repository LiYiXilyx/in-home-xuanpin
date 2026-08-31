import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCategoryProfile } from './category-profile.mjs';
import { AppError } from '../../shared/errors.mjs';

export function createCategoryProfileRegistry({ directory }={}) {
  const root=path.resolve(requiredDirectory(directory));

  async function scan() {
    let entries;
    try { entries=await fs.readdir(root,{ withFileTypes:true }); }
    catch (cause) { throw new AppError('无法读取 Category Profile 目录。',{ code:'CATEGORY_PROFILE_DIRECTORY_INVALID',details:{ directory:root },cause }); }
    const names=entries.filter(entry=>entry.isFile()&&entry.name.endsWith('.json')).map(entry=>entry.name).sort();
    const profiles=[];const invalid=[];const identities=new Map();
    for (const name of names) {
      try {
        const profile=await loadCategoryProfile(path.join(root,name));
        const identity=`${profile.category_key}\u001f${profile.category_profile_version}`;
        if (identities.has(identity)) throw new AppError('Category Profile 身份重复。',{
          code:'CATEGORY_PROFILE_DUPLICATE',details:{ categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version,sourceNames:[identities.get(identity),name] }
        });
        identities.set(identity,name);profiles.push(profile);
      } catch (error) {
        if (error?.code==='CATEGORY_PROFILE_DUPLICATE') throw error;
        invalid.push({ source_name:name,error_code:error?.code??'CATEGORY_PROFILE_INVALID',message:error?.message??'Category Profile 无效。' });
      }
    }
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

function requiredDirectory(value) {
  const result=String(value??'').trim();
  if (!result) throw new AppError('缺少 Category Profile 目录。',{ code:'CATEGORY_PROFILE_DIRECTORY_INVALID' });
  return result;
}
