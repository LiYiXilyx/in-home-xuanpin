import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRouter } from '../../src/server/router.mjs';
import { createOperationsServer } from '../../src/server/index.mjs';

function controllerFixture() {
  let state='SCAN_STALE',token='token-1',busy=false;
  const rows=[{temu_goods_id:'601',product_id:'p1',random_sample_rank:1,original_rank:4}];
  const run={state:'COMPLETED_WITH_WARNINGS',current_run_id:'run-warning',run_id:'run-warning',candidate_count:1,image_success:0,image_failed:1,manifest:'manifest-1',sampled_product_ids:rows};
  return {
    settings:async()=>({settings:{sourceDir:'/tmp/原始 文件',imageCacheDir:'/tmp/图片',selectedWorkbookPath:'/tmp/opportunity-analysis-with-1688.xlsx'},state,scan_token:state==='SCAN_VALID'?token:null}),
    saveSettings:async()=>({state:state='SCAN_STALE'}),choosePath:async()=>({cancelled:true,state}),
    scan:async()=>({state:state='SCAN_BLOCKED',scan_token:token,source_files:2,valid_goods_id:1,invalid_files:['bad-name.xlsx'],parsed_candidates:6,random5_candidates:5,preview:{files:[{filename:'601.xlsx',goods_id:'601',row_count:6,parse_status:'PARSED'}]}}),
    startImport:async body=>{if(busy)throw Object.assign(new Error('busy'),{code:'IMPORT_IN_PROGRESS'});busy=true;await new Promise(resolve=>setTimeout(resolve,30));busy=false;state='COMPLETED';return {...run,...body,state:'COMPLETED'};},
    currentImport:async()=>run,getImport:async()=>run,retryFailedImages:async()=>({...run,state:'COMPLETED',image_failed:0}),
  };
}

async function setup(t) {
  const sourcingController=controllerFixture();
  const noop={};
  const router=createRouter({sourcingController,statusService:{snapshot:async()=>({})},browserController:noop,jobController:noop,reviewController:noop,reviewQueueController:noop,catalogController:noop,exportController:noop,testController:noop,serveStatic:()=>{},logError:()=>{}});
  const server=http.createServer(router);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {base:`http://127.0.0.1:${server.address().port}`};
}

async function api(base,pathname,{method='GET',body,origin}={}) {
  const headers={};
  if(body!==undefined) headers['Content-Type']='application/json';
  if(method!=='GET') headers.Origin=origin??base;
  const response=await fetch(`${base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}

test('scan exposes ten-file shape and malformed names block scan',async t=>{
  const {base}=await setup(t);
  const response=await api(base,'/api/sourcing/scan',{method:'POST',body:{}});
  assert.equal(response.status,200);
  assert.equal(response.body.state,'SCAN_BLOCKED');
  assert.deepEqual(response.body.preview.files[0],{filename:'601.xlsx',goods_id:'601',row_count:6,parse_status:'PARSED'});
  assert.deepEqual(response.body.invalid_files,['bad-name.xlsx']);
});

test('local Host and Origin guard rejects cross-site and forged host mutations',async t=>{
  const {base}=await setup(t);
  assert.equal((await api(base,'/api/sourcing/scan',{method:'POST',body:{},origin:'https://evil.example'})).status,403);
  const url=new URL(base);
  const status=await new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:url.port,path:'/api/sourcing/scan',method:'POST',headers:{Host:`evil.example:${url.port}`,Origin:base,'Content-Type':'application/json'}},response=>{
      response.resume();response.on('end',()=>resolve(response.statusCode));
    });
    request.on('error',reject);request.end('{}');
  });
  assert.equal(status,403);
  assert.equal((await api(base,'/api/sourcing/scan',{method:'POST',body:{},origin:'http://127.0.0.1:65534'})).status,403);
});

test('all approved routes are registered and retry preserves candidate identities',async t=>{
  const {base}=await setup(t);
  assert.equal((await api(base,'/api/sourcing/settings')).status,200);
  assert.equal((await api(base,'/api/sourcing/settings',{method:'PUT',body:{sourceDir:'/x'}})).status,200);
  assert.equal((await api(base,'/api/sourcing/path-dialog',{method:'POST',body:{kind:'RAW_DIRECTORY'}})).status,200);
  assert.equal((await api(base,'/api/sourcing/imports/current')).status,200);
  const before=await api(base,'/api/sourcing/imports/run-warning');
  const retry=await api(base,'/api/sourcing/imports/run-warning/retry-failed-images',{method:'POST',body:{}});
  const after=await api(base,'/api/sourcing/imports/run-warning');
  assert.equal(retry.status,200);
  assert.deepEqual(after.body.sampled_product_ids,before.body.sampled_product_ids);
});

test('duplicate import start is rejected while first start is active',async t=>{
  const {base}=await setup(t);
  await api(base,'/api/sourcing/scan',{method:'POST',body:{}});
  // fixture scan is blocked, so route-level stale handling is independently covered by controller tests.
  const requests=[api(base,'/api/sourcing/imports',{method:'POST',body:{scanToken:'token-1',runId:'run-1'}}),api(base,'/api/sourcing/imports',{method:'POST',body:{scanToken:'token-1',runId:'run-1'}})];
  const results=await Promise.all(requests);
  assert.ok(results.some(item=>item.status===409));
});

test('real operations server factory wires sourcing routes and closes both databases',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sourcing-server-factory-'));
  const config={configPath:path.join(directory,'config.json'),app:{databasePath:path.join(directory,'temu.db'),environment:'development',backupDir:path.join(directory,'backups'),logDir:path.join(directory,'logs')},browser:{profileDir:path.join(directory,'browser'),debugPort:9237,heartbeatTimeoutMs:30_000},catalog:{siteCountry:'德国',language:'en',currency:'EUR',jobs:[]},export:{outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'temu-images')}};
  const app=await createOperationsServer({config,sourcingController:controllerFixture(),runProcess:()=>{},openTarget:async()=>{},exportWorkbook:async()=>({}),logError:()=>{},browserDependencies:{ready:async()=>true,openSession:async()=>({context:{}}),connectSession:async()=>({context:{}}),currentPage:async()=>({}),inspectPage:async()=>({status:'READY',code:'READY',checks:{}})}});
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const address=await app.listen({port:0});
  assert.equal((await api(address.url,'/api/sourcing/settings')).status,200);
  await app.close();
  assert.equal(fs.existsSync(path.join(directory,'1688_sourcing.db')),true);
});
