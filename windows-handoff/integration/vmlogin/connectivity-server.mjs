import {validateThreeProbe} from './three-probe-schema.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function createConnectivityServer({onCheck=()=>{},testSummary=null,onProbe=null}={}) {
 return http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return send(403,{ok:false,error:'ORIGIN_NOT_ALLOWED'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,POST');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Temu-Test');res.writeHead(204);return res.end();}
  const probeRoute=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.method==='POST'&&probeRoute==='/api/test/three-products'&&onProbe){
   if(req.headers['x-temu-test']!=='three-products-v1')return send(403,{ok:false,error:'TEST_HEADER_REQUIRED'});
   try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)return send(413,{ok:false,error:'TEST_PAYLOAD_TOO_LARGE'});chunks.push(chunk);}
    const value=validateThreeProbe(JSON.parse(Buffer.concat(chunks).toString('utf8')));const record={...value,receivedAt:new Date().toISOString(),test_only:true,source:'manual extension click; browser profile identity not independently verified'};await onProbe(record);return send(200,{ok:true,test_only:true,received_count:record.items.length,needs_manual_price_check:record.items.filter(x=>x.price_status!=='READY').length});
   }catch{return send(400,{ok:false,error:'INVALID_THREE_PRODUCT_FIELDS'});}
  }
  if(req.method!=='GET')return send(405,{ok:false,error:'READ_ONLY_CONNECTIVITY_TEST'});
  const route=new URL(req.url,'http://127.0.0.1').pathname;
  if(route==='/api/test-summary' && testSummary){onCheck({checkedAt:new Date().toISOString(),fromExtension:Boolean(origin),route});return send(200,testSummary);}
  if(route!=='/api/health' && route!=='/')return send(404,{ok:false,error:'NO_BUSINESS_API'});
  const checkedAt=new Date().toISOString();
  onCheck({checkedAt,fromExtension:Boolean(origin),route});
  send(200,{ok:true,service:'temu-vmlogin-connectivity-test',test_only:true,database_access:false,browser_connection:false,checkedAt});
  function send(status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
 });
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const log=path.join(import.meta.dirname,'connectivity-checks.jsonl');
 const summary=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'test-summary.json'),'utf8'));
 const server=createConnectivityServer({testSummary:summary,onProbe:record=>{const root=path.resolve(import.meta.dirname,'../../local-test/field-checks');fs.mkdirSync(root,{recursive:true});const target=path.join(root,'three-products-latest.json');fs.writeFileSync(target+'.tmp',JSON.stringify(record,null,2));fs.renameSync(target+'.tmp',target);},onCheck:row=>fs.appendFileSync(log,JSON.stringify(row)+'\n')});
 server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'37821 已被占用；未停止任何已有服务。':error.message);process.exitCode=1;});
 server.listen(37821,'127.0.0.1',()=>console.log('只读联通测试：http://127.0.0.1:37821/api/health；不打开数据库，不连接浏览器。'));
 const stop=()=>server.close(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
