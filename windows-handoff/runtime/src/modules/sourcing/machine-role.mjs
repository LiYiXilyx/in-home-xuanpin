import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MACHINE_ROLES=Object.freeze({DEVELOPMENT:'DEVELOPMENT',RUNNER:'1688_RUNNER'});
const ALLOWED_LOCAL_KEYS=new Set(['MACHINE_ROLE','SOURCING_DB_PATH','CHROME_CDP_ENDPOINT','CHROME_PROFILE_DIR','TEMU_DB_PATH']);

export function loadMachineEnvironment(envPath=path.resolve('.env')){
  if(!fs.existsSync(envPath))return;
  for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){
    const trimmed=line.trim();if(!trimmed||trimmed.startsWith('#'))continue;
    const index=trimmed.indexOf('=');if(index<1)continue;const key=trimmed.slice(0,index).trim();
    if(!ALLOWED_LOCAL_KEYS.has(key)||process.env[key]!==undefined)continue;
    process.env[key]=trimmed.slice(index+1).trim().replace(/^(['"])(.*)\1$/,'$2');
  }
}

export function getMachineRole({required=true,envPath}={}){
  loadMachineEnvironment(envPath);const role=String(process.env.MACHINE_ROLE??'').trim().toUpperCase();
  if(Object.values(MACHINE_ROLES).includes(role))return role;
  if(required)throw new Error('MACHINE_ROLE 必须明确设置为 DEVELOPMENT 或 1688_RUNNER。');
  return 'UNCONFIGURED';
}

export function assertMachineRole(expected,action){const actual=getMachineRole();if(actual!==expected)throw new Error(`${action} 仅允许 ${expected}；当前 MACHINE_ROLE=${actual}。`);return actual;}
export function assertTemuMutationAllowed(action){const role=getMachineRole({required:false});if(role===MACHINE_ROLES.RUNNER)throw new Error(`1688_RUNNER 禁止修改 Temu：${action}`);return role;}
export function machineName(){return String(process.env.COMPUTERNAME??process.env.HOSTNAME??os.hostname()??'UNKNOWN').trim()||'UNKNOWN';}
