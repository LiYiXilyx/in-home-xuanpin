import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createConnectivityServer} from './connectivity-server.mjs';
const source=fs.readFileSync(new URL('./diagnostic-extension/page-probe.js',import.meta.url),'utf8');
function probe(texts,host='www.temu.com'){
 const body={};const links=texts.map((text,i)=>{const a={getAttribute:()=>'/goods.html?goods_id='+String(100000+i),getBoundingClientRect:()=>({width:100,height:100,bottom:100,right:100,top:0,left:0})};a.parentElement={innerText:text,parentElement:body,querySelectorAll:()=>[a],matches:()=>true};return a;});
 return vm.runInNewContext(source+';readThreeVisibleProducts()',{URL,location:{protocol:'https:',hostname:host,href:'https://'+host+'/'},document:{body,querySelectorAll:()=>links},innerHeight:800,innerWidth:1000,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})});
}
let checks=0;function check(fn){fn();checks++;}
check(()=>assert.equal(probe(['12,34 €']).items[0].price_amount,12.34));
check(()=>assert.equal(probe(['EUR 1.234,56']).items[0].price_amount,1234.56));
check(()=>assert.equal(probe(['9,99 € 19,99 €']).items[0].price_status,'AMBIGUOUS'));
check(()=>assert.equal(probe(['$12.34']).items[0].currency,null));
check(()=>assert.equal(probe(['Kein Preis']).items[0].price_status,'MISSING'));
check(()=>assert.equal(probe(['1 €','2 €','3 €','4 €']).items.length,3));
check(()=>assert.equal(probe(['1 €'],'example.com').ok,false));
const records=[];const server=createConnectivityServer({onProbe:r=>records.push(r)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const headers={'Content-Type':'application/json','X-Temu-Test':'three-products-v1',Origin:'chrome-extension://'+'a'.repeat(32)};
const send=(data,h=headers,route='/api/test/three-products')=>fetch(base+route,{method:'POST',headers:h,body:typeof data==='string'?data:JSON.stringify(data)});
try{
 const good=JSON.parse(JSON.stringify(probe(['12,34 €','9,99 € 19,99 €','无价格'])));
 check(()=>assert.equal(records.length,0));
 const r=await send(good);check(()=>assert.equal(r.status,200));check(()=>assert.equal((records[0].items).length,3));
 for(const bad of [{...good,html:'forbidden'},{...good,items:[...good.items,good.items[0]]},{...good,items:[]},{...good,items:[{...good.items[0],image_url:'forbidden'}]}]){const r=await send(bad);check(()=>assert.equal(r.status,400));}
 check(()=>assert.equal(records.length,1));
 const forbidden=await send(good,{...headers,Origin:'https://www.temu.com'});check(()=>assert.equal(forbidden.status,403));
 const noHeader=await send(good,{'Content-Type':'application/json'});check(()=>assert.equal(noHeader.status,403));
 const oversized=await send(' '.repeat(9000));check(()=>assert.equal(oversized.status,413));
 const business=await send(good,headers,'/api/catalog/campaigns');check(()=>assert.equal(business.status,405));
 const result={passed:true,checks,scope:'Synthetic DOM fixtures and ephemeral localhost service only; no real browser access, network images, or business database writes',checkedAt:new Date().toISOString()};fs.writeFileSync(new URL('./three-probe-self-test.json',import.meta.url),JSON.stringify(result,null,2));console.log(result);
}finally{await new Promise(r=>server.close(r));}
