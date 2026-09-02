import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {AppError} from '../../shared/errors.mjs';

export function createOperatorCategoryProfileStore({root,builtInRegistry,validateInput}={}){
  const configuredRoot=path.resolve(required(root,'root'));
  if(typeof validateInput!=='function')throw unsafe('缺少 Operator Profile validator。');

  async function validate(input){return validateInput(input);}

  async function register({requestId,...input}={}){
    const id=required(requestId,'request_id');
    const profile=await validate(input);
    assertSafeIdentity(profile);
    const requestHash=hashCanonical(profile);
    const filename=`${profile.category_key}--${profile.category_profile_version}.json`;
    const profileBytes=`${JSON.stringify(profile,null,2)}\n`;
    await assertBuiltInIdentityAvailable(builtInRegistry,profile);
    const canonicalRoot=await ensureSafeRoot(configuredRoot);
    const paths=registrationPaths(canonicalRoot,id,filename);
    const release=await acquireLock(paths.lock);
    try{
      const receipt=await readJson(paths.receipt);
      if(receipt){
        if(receipt.request_id!==id||receipt.request_hash!==requestHash)throw conflict();
        const stored=await readJson(paths.final);
        if(!stored)throw unsafe('Operator Profile幂等记录对应文件不存在。');
        return{profile:stored,filename:receipt.filename,idempotentReplay:true};
      }
      if(await exists(paths.final))throw new AppError('Operator Category Profile 已存在。',{
        code:'CATEGORY_PROFILE_ALREADY_EXISTS',details:identity(profile)
      });
      await atomicWrite(paths.final,profileBytes);
      try{
        await atomicWrite(paths.receipt,`${JSON.stringify({request_id:id,request_hash:requestHash,filename},null,2)}\n`);
      }catch(error){
        await fs.rm(paths.final,{force:true});
        throw error;
      }
      return{profile,filename,idempotentReplay:false};
    }finally{await release();}
  }

  return Object.freeze({root:configuredRoot,validate,register});
}

async function ensureSafeRoot(root){
  const parent=path.dirname(root);
  const parentReal=await realDirectory(parent);
  if(await exists(root)){
    const stat=await fs.lstat(root);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw unsafe('Operator Profile目录不安全。');
  }else await fs.mkdir(root,{mode:0o700});
  const canonical=await fs.realpath(root);
  if(!contained(parentReal,canonical))throw unsafe('Operator Profile目录逃逸。');
  return canonical;
}

function registrationPaths(root,requestId,filename){
  const requestName=`${hashText(requestId)}.json`;
  const requests=path.join(root,'.requests'),locks=path.join(root,'.locks');
  return{
    final:safeJoin(root,filename),receipt:safeJoin(requests,requestName),
    lock:safeJoin(locks,`${hashText(filename)}.lock`),requests,locks
  };
}

async function acquireLock(lockPath){
  await fs.mkdir(path.dirname(lockPath),{recursive:true,mode:0o700});
  try{await fs.mkdir(lockPath,{mode:0o700});}
  catch(error){if(error?.code==='EEXIST')throw new AppError('Operator Profile 正在注册。',{code:'CATEGORY_PROFILE_REGISTRATION_IN_PROGRESS'});throw error;}
  return async()=>{await fs.rm(lockPath,{recursive:true,force:true});};
}

async function atomicWrite(target,bytes){
  await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
  const temporary=`${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let handle;
  try{
    handle=await fs.open(temporary,'wx',0o600);
    await handle.writeFile(bytes,'utf8');
    await handle.sync();
    await handle.close();handle=null;
    await fs.rename(temporary,target);
  }catch(error){
    await handle?.close().catch(()=>{});
    await fs.rm(temporary,{force:true});
    throw error;
  }
}

async function assertBuiltInIdentityAvailable(registry,profile){
  if(!registry?.list)return;
  const {profiles=[]}=await registry.list();
  if(profiles.some(row=>row.category_key===profile.category_key&&row.category_profile_version===profile.category_profile_version)){
    throw new AppError('Built-in Category Profile 不允许被覆盖。',{code:'CATEGORY_PROFILE_BUILT_IN_CONFLICT',details:identity(profile)});
  }
}

function assertSafeIdentity(profile){
  if(!profile||typeof profile!=='object')throw unsafe('Operator Profile validator返回无效结果。');
  for(const [field,value] of [['category_key',profile.category_key],['category_profile_version',profile.category_profile_version]]){
    if(!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(String(value??'')))throw unsafe(`Operator Profile ${field} 不安全。`);
  }
}

function safeJoin(root,name){const target=path.resolve(root,name);if(!contained(root,target))throw unsafe('Operator Profile路径逃逸。');return target;}
function contained(root,target){const relative=path.relative(root,target);return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative));}
async function realDirectory(value){try{const stat=await fs.lstat(value);if(stat.isSymbolicLink()||!stat.isDirectory())throw unsafe('Operator Profile父目录不安全。');return fs.realpath(value);}catch(error){if(error?.code==='CATEGORY_PROFILE_STORE_UNSAFE')throw error;throw unsafe('Operator Profile父目录不存在或不可读。');}}
async function readJson(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error?.code==='ENOENT')return null;throw unsafe('Operator Profile文件损坏。');}}
async function exists(file){try{await fs.lstat(file);return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}}
function hashCanonical(value){return hashText(JSON.stringify(sortValue(value)));}
function hashText(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function sortValue(value){if(Array.isArray(value))return value.map(sortValue);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));return value;}
function identity(profile){return{categoryKey:profile.category_key,categoryProfileVersion:profile.category_profile_version};}
function required(value,field){const result=String(value??'').trim();if(!result)throw new AppError(`缺少 ${field}。`,{code:'CATEGORY_PROFILE_INPUT_INVALID'});return result;}
function conflict(){return new AppError('同一 request_id 的 Profile 参数发生变化。',{code:'CATEGORY_PROFILE_IDEMPOTENCY_CONFLICT'});}
function unsafe(message){return new AppError(message,{code:'CATEGORY_PROFILE_STORE_UNSAFE'});}
