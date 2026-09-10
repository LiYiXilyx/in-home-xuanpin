import fs from 'node:fs';
import path from 'node:path';

const SECRET_KEYS=/cookie|token|authorization|password|passwd|secret|session/i;
const SECRET_TEXT=/(?:["']?(?:authorization|cookie|access_token|refresh_token|password|passwd|secret)["']?\s*[:=]|bearer\s+[a-z0-9._~-]+)/i;

export function sanitizeLogValue(value,key=''){
  if(SECRET_KEYS.test(key))return '[REDACTED]';
  if(typeof value==='string')return SECRET_TEXT.test(value)?'[REDACTED]':value;
  if(Array.isArray(value))return value.map(item=>sanitizeLogValue(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitizeLogValue(v,k)]));
  return value;
}

export function createStructuredLogger(filePath,{runId,clock=()=>new Date().toISOString()}={}){
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  return (entry={})=>{
    const row=sanitizeLogValue({timestamp:clock(),run_id:runId,goods_id:entry.goods_id??null,step:entry.step??'UNKNOWN',status:entry.status??'INFO',error:entry.error??null,...entry});
    fs.appendFileSync(filePath,`${JSON.stringify(row)}\n`,'utf8');return row;
  };
}

export function scanTextForSecrets(text){return SECRET_TEXT.test(String(text));}
