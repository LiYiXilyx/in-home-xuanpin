import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir=path.resolve(import.meta.dirname,'../../../state/logs');
const file=path.join(dir,'operator-system.jsonl');
let storageError=null;
export function record(entry){try{fs.mkdirSync(dir,{recursive:true});if(fs.existsSync(file)&&fs.statSync(file).size>5*1024*1024)fs.renameSync(file,file+'.previous');fs.appendFileSync(file,JSON.stringify({time:new Date().toISOString(),...entry})+'\n');storageError=null;}catch{storageError='日志文件写入失败，请检查磁盘空间和目录权限';}}
export function logs(){let rows=[];for(const f of [file+'.previous',file]){try{rows.push(...fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}}));}catch{}}return {rows:rows.slice(-2000).reverse(),storageError,retention:'最多两个 5 MB 文件，页面展示最近 2000 条；日志不包含请求正文或查询参数。'};}
export function instrument(req,res,url){if(!url.pathname.startsWith('/api/')||url.pathname==='/api/system-logs')return;const id=crypto.randomUUID(),start=Date.now();res.setHeader('X-Request-Id',id);res.on('finish',()=>{if(req.method==='GET'&&res.statusCode<400)return;record({id,level:res.statusCode>=500?'ERROR':res.statusCode>=400?'WARN':'INFO',module:url.pathname.split('/')[2]||'system',method:req.method,path:url.pathname,status:res.statusCode,durationMs:Date.now()-start,code:res.operatorErrorCode??'',message:res.statusCode>=400?'操作失败，请将排查编号和日志提供给维护人员':'操作完成'});});}
record({level:'INFO',module:'system',message:'运营台服务启动',id:crypto.randomUUID()});
