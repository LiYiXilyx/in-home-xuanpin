import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { is1688PageUrl,run1688Probe,sanitizeHtmlFallback,sanitizeProbeUrl } from '../../src/modules/sourcing/probe-service.mjs';

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'1688-probe-'));}

test('probe sanitizers redact secrets and only accept 1688 hosts',()=>{
  assert.equal(is1688PageUrl('https://s.1688.com/selloffer/offer_search.htm'),true);
  assert.equal(is1688PageUrl('https://1688.com.example.test/'),false);
  assert.doesNotMatch(sanitizeProbeUrl('https://example.test/?token=secret#fragment'),/secret|fragment/);
  const html=sanitizeHtmlFallback('<script>token=secret</script><input value="password=secret" onclick="x()">');
  assert.doesNotMatch(html,/token=secret|password=secret|onclick/);
});

test('probe writes the six allowlisted artifacts without browser mutation',async()=>{
  const root=temp(),calls=[];
  const frame={name:()=>'',url:()=> 'https://s.1688.com/search',title:async()=> '1688 图片搜索',parentFrame:()=>null,childFrames:()=>[],locator:selector=>({selector}),evaluate:async fn=>String(fn).includes('document.documentElement')?'<html><body><input value="secret"></body></html>':{visible_elements:[{frame_index:0,tag:'button',type:'',text:'以图搜款',id:'image-search',class:'',name:'',['aria-label']:'',placeholder:'',role:'button',visible:true}],detections:{file_inputs:[],image_search_entries:[],upload_controls:[],search_boxes:[],result_product_containers:[]}}};
  const page={isClosed:()=>false,url:()=>frame.url(),title:frame.title,frames:()=>[frame],mainFrame:()=>frame,screenshot:async options=>{calls.push(options);fs.writeFileSync(options.path,'png');}};
  const browser={contexts:()=>[{pages:()=>[page]}]};
  let tick=0;const result=await run1688Probe({runId:'run-001',projectRoot:root,cdpEndpoint:'http://127.0.0.1:9222',connect:async()=>browser,machineRoleCheck:false,now:()=>`2026-08-29T00:00:0${tick++}Z`});
  assert.equal(result.status,'PASS');assert.equal(calls.length,1);assert.equal(calls[0].fullPage,true);
  const output=path.join(root,'outputs','1688-probe','run-001');
  for(const name of ['probe-summary.json','page.png','page.html','elements.json','frames.json','runner.log'])assert.equal(fs.existsSync(path.join(output,name)),true,name);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'probe-summary.json'))).cookies_read,false);
  assert.doesNotMatch(fs.readFileSync(path.join(output,'page.html'),'utf8'),/value="secret"/);
  const textArtifacts=['probe-summary.json','page.html','elements.json','frames.json','runner.log'].map(name=>fs.readFileSync(path.join(output,name),'utf8')).join('\n');
  assert.doesNotMatch(textArtifacts,/token=secret|password=secret|value="secret"/i);
});

test('probe refuses overwrite and does not fall back to non-1688 pages',async()=>{
  const root=temp(),page={isClosed:()=>false,url:()=> 'https://example.test/',title:async()=> 'other'};
  const connect=async()=>({contexts:()=>[{pages:()=>[page]}]});
  await assert.rejects(()=>run1688Probe({runId:'run-002',projectRoot:root,connect,machineRoleCheck:false}),/没有找到打开的 1688 页面/);
  await assert.rejects(()=>run1688Probe({runId:'run-002',projectRoot:root,connect,machineRoleCheck:false}),/输出目录已存在/);
});
