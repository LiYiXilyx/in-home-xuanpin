import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createDeterministicZip,readStoredZip } from './deterministic-zip.mjs';
import { scanTextForSecrets } from './structured-log.mjs';

const ROOT_FILES=new Set(['run-summary.json','candidates.jsonl','runner.log']);
const SUBDIRS=new Set(['screenshots','pages','errors']);
const FORBIDDEN=/(\.db(?:-wal|-shm)?$|cookie|token|credential|browser[-_]?profile|chrome[-_]?profile)/i;

function walk(dir,relative=''){
  const rows=[];for(const item of fs.readdirSync(path.join(dir,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const rel=path.join(relative,item.name);if(item.isDirectory())rows.push(...walk(dir,rel));else if(item.isFile())rows.push(rel);}return rows;
}
function allowed(relative){const posix=relative.replaceAll('\\','/'),parts=posix.split('/');return (parts.length===1&&ROOT_FILES.has(parts[0]))||(parts.length>1&&SUBDIRS.has(parts[0]));}

export function packRunResult({runDir,outputPath}){
  if(!fs.existsSync(runDir))throw new Error(`结果目录不存在：${runDir}`);
  const files=walk(runDir);for(const file of files)if(!allowed(file)||FORBIDDEN.test(file))throw new Error(`结果包出现非白名单文件：${file}`);
  for(const required of ROOT_FILES)if(!files.some(x=>x.replaceAll('\\','/')===required))throw new Error(`结果目录缺少 ${required}`);
  return createDeterministicZip(outputPath,files.map(file=>({name:file.replaceAll('\\','/'),data:fs.readFileSync(path.join(runDir,file))})));
}

function parseJsonl(buffer,name){return buffer.toString('utf8').split(/\r?\n/).filter(Boolean).map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`${name} 第 ${index+1} 行 JSON 无效。`);}});}
export function auditResultPackage(zipPath){
  const entries=readStoredZip(zipPath),names=[...entries.keys()];
  for(const name of names)if(!allowed(name)||FORBIDDEN.test(name))throw new Error(`结果包出现非白名单文件：${name}`);
  for(const required of ROOT_FILES)if(!entries.has(required))throw new Error(`结果包缺少 ${required}`);
  for(const [name,data] of entries)if(/\.(json|jsonl|log|html|txt)$/i.test(name)&&scanTextForSecrets(data.toString('utf8')))throw new Error(`结果包疑似包含凭据：${name}`);
  const summary=JSON.parse(entries.get('run-summary.json').toString('utf8')),candidates=parseJsonl(entries.get('candidates.jsonl'),'candidates.jsonl');
  const keys=new Set();for(const row of candidates){const rank=Number(row.candidate_rank);if(!row.run_id||!row.temu_goods_id||!Number.isInteger(rank)||rank<1||rank>5)throw new Error('候选缺少身份字段或 rank 超出 1–5。');const key=`${row.run_id}\u001f${row.temu_goods_id}\u001f${rank}`;if(keys.has(key))throw new Error(`候选重复：${key}`);keys.add(key);}
  return {valid:true,zip_path:path.resolve(zipPath),sha256:crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex'),entry_count:names.length,run_id:summary.run_id,status:summary.status,candidate_count:candidates.length,entries:names.sort()};
}
