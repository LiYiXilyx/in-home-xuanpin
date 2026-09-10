import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createConnectivityServer} from './connectivity-server.mjs';
const checks=[];const server=createConnectivityServer({testSummary:{ok:true,test_only:true,source:'local-test temporary database copies',counts:{products:2372}},onCheck:r=>checks.push(r)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
try{
 const response=await fetch(base+'/api/health',{headers:{Origin:'chrome-extension://'+'a'.repeat(32)}});const body=await response.json();assert.equal(response.status,200);assert.equal(body.database_access,false);assert.equal(body.browser_connection,false);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'chrome-extension://'+'a'.repeat(32));
 assert.equal((await fetch(base+'/api/catalog/campaigns',{method:'POST',body:'{}'})).status,405);
 assert.equal((await fetch(base+'/api/sourcing/review/goods/1/evidence-sessions',{method:'POST',body:'{}'})).status,405);
 assert.equal((await fetch(base+'/api/catalog/operator/profiles')).status,404);
 assert.equal((await fetch(base+'/api/health',{headers:{Origin:'https://www.temu.com'}})).status,403);
 assert.equal(checks.length,1);const summary=await (await fetch(base+'/api/test-summary')).json();assert.equal(summary.test_only,true);assert.equal(summary.counts.products,2372);const result={passed:true,checks:7,scope:'local simulated extension-origin HTTP requests; no VMLogin browser attached'};fs.writeFileSync(path.join(import.meta.dirname,'local-self-test.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await new Promise(r=>server.close(r));}
