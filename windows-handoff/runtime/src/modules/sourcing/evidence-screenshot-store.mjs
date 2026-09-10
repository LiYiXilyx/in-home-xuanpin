import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
export function createEvidenceScreenshotStore(root){const base=path.resolve(root);return{
  stage({runId,goodsId,sessionId,phase,bytes}){const relative=[runId,goodsId,sessionId,`${String(phase).toLowerCase()}.png`].map(safe).join(path.sep),finalPath=path.resolve(base,relative);if(!finalPath.startsWith(`${base}${path.sep}`))throw coded('EVIDENCE_SCREENSHOT_PATH_INVALID','截图路径越界');fs.mkdirSync(path.dirname(finalPath),{recursive:true});const tempPath=`${finalPath}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(tempPath,bytes,{flag:'wx'});return{relativePath:relative,tempPath,finalPath,commit(){fs.renameSync(tempPath,finalPath);},cleanup(){fs.rmSync(tempPath,{force:true});fs.rmSync(finalPath,{force:true});}};},
  read(relative){const resolved=path.resolve(base,String(relative));if(!resolved.startsWith(`${base}${path.sep}`))throw coded('EVIDENCE_SCREENSHOT_PATH_INVALID','截图路径越界');return fs.readFileSync(resolved);}
};}
function safe(value){const text=String(value);if(!/^[A-Za-z0-9._-]+$/.test(text))return crypto.createHash('sha256').update(text).digest('hex');return text;}
function coded(code,message){return Object.assign(new Error(message),{code});}
