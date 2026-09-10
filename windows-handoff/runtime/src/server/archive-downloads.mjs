import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const inbox='C:/Users/Administrator/Desktop/1688';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export async function archiveDownloads(batch){
 if(!batch.batchDir||!batch.completedGoods?.length)return;
 const allowed=new Set(batch.completedGoods);const hashes=new Set();
 for(const id of allowed){if(!/^\d+$/.test(id))continue;try{hashes.add(sha(await fs.readFile(path.join(batch.batchDir,'results',id+'.xlsx'))));}catch{}}
 const entries=await fs.readdir(inbox,{withFileTypes:true}).catch(()=>[]);
 for(const entry of entries){
  if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.xlsx')||entry.name.startsWith('~$'))continue;
  const source=path.join(inbox,entry.name),bytes=await fs.readFile(source);if(!hashes.has(sha(bytes)))continue;
  const dir=path.join(batch.batchDir,'原始下载');await fs.mkdir(dir,{recursive:true});
  const destination=path.join(dir,entry.name);
  // Copy without overwrite and verify before removing the matching inbox copy.
  try{await fs.copyFile(source,destination,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
  if(sha(await fs.readFile(destination))!==sha(bytes))throw Error('归档校验不一致，保留原下载文件');
  if(sha(await fs.readFile(source))!==sha(bytes))throw Error('下载文件发生变化，保留原文件');
  await fs.unlink(source);
 }
}
