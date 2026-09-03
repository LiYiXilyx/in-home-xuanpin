import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
function modules(){const sandbox=vm.createContext({console});for(const file of ['catalog-operator-view-model.js','catalog-operator-overlay.js'])vm.runInContext(fs.readFileSync(path.join(root,'browser-extension',file),'utf8'),sandbox);return sandbox;}
function snapshot({health='NOT_DETECTED',bound=false}={}){return{state:bound?'PAGE_BOUND':health==='READY'?'PAGE_READY':'UNBOUND',context:{campaign:{id:'c1',campaignType:'initial',categoryKey:'girls-sets',categoryProfileVersion:'girls-v1',browserControlMode:'MANUAL_BIND_PASSIVE_CAPTURE',quantityMode:'OPEN_ENDED',targetCount:null,nonElectronicUniqueCount:0},profile:{category_key:'girls-sets',category_profile_version:'girls-v1',display_name:'小女孩童装',page_health:{category_names:["Girls' Sets"]},site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales'},queue:{checkpoint:{}}},detection:health==='NOT_DETECTED'?null:{health:{status:health,checks:{country:true,language:true,currency:true,category:true,products:true,sort:health==='READY'}},observed:{siteCountry:'DE',language:'en',currency:'EUR',category:"Girls' Sets",sortOrder:health==='READY'?'Top Sales':'Recommended',cardCount:40,domReady:true}},binding:bound?{status:'BOUND',context_fingerprint:'fp'}:null};}

test('expanded markup contains exactly one light primary panel and three gated steps',()=>{
  const api=modules(),model=api.TemuCatalogOperatorViewModel.build(snapshot()),html=api.TemuCatalogOperatorOverlay.renderMarkup(model,{collapsed:false});
  assert.equal((html.match(/data-role="primary-panel"/g)??[]).length,1);assert.equal((html.match(/temu-catalog-auto-runner/g)??[]).length,0);
  for(const label of ['检测当前页面','绑定当前页面','采集当前页面'])assert.match(html,new RegExp(label));
  assert.match(html,/background:#FFFFFF/i);assert.match(html,/color:#111827/i);assert.match(html,/font-size:14px/i);assert.match(html,/font-size:18px/i);assert.match(html,/line-height:1\.45/i);
  assert.match(html,/id="temu-catalog-bind"[^>]*disabled/);assert.match(html,/id="temu-catalog-capture"[^>]*disabled/);assert.match(html,/请先完成页面检测/);
  assert.match(html,/<details[^>]*id="temu-catalog-technical"(?![^>]*open)/);assert.doesNotMatch(html,/(?:目标|target)[^<]*(?:0\s*\/\s*0|null)/i);
});

test('READY enables bind, BOUND enables capture, and expected/actual health is readable',()=>{
  const api=modules(),ready=api.TemuCatalogOperatorOverlay.renderMarkup(api.TemuCatalogOperatorViewModel.build(snapshot({health:'READY'})),{collapsed:false}),bound=api.TemuCatalogOperatorOverlay.renderMarkup(api.TemuCatalogOperatorViewModel.build(snapshot({health:'READY',bound:true})),{collapsed:false});
  assert.doesNotMatch(button(ready,'temu-catalog-bind'),/disabled/);assert.match(button(ready,'temu-catalog-capture'),/disabled/);assert.doesNotMatch(button(bound,'temu-catalog-capture'),/disabled/);
  assert.match(ready,/预期 Girls&#39; Sets/);assert.match(ready,/实际 Girls&#39; Sets/);assert.match(ready,/预期 Top Sales/);assert.match(ready,/实际 Top Sales/);
});

test('explicit action adapter calls only the matching existing runner method',async()=>{
  const calls=[],runner={recoverCurrentTask:async()=>calls.push('recover'),detectCurrentPage:async()=>calls.push('detect'),bindCurrentPage:async()=>calls.push('bind'),captureCurrentPage:async()=>calls.push('capture')},actions=modules().TemuCatalogOperatorOverlay.createActions(runner);
  await actions.recover();await actions.detect();await actions.bind();await actions.capture();assert.deepEqual(calls,['recover','detect','bind','capture']);
});

test('recovery-required markup shows one recovery button and disables bind and capture',()=>{
  const api=modules(),value=snapshot();value.state='RECOVERY_REQUIRED';value.binding={status:'BOUND',context_fingerprint:'stale'};value.context.campaign.status='manual_required';value.context.queue.status='manual_required';const html=api.TemuCatalogOperatorOverlay.renderMarkup(api.TemuCatalogOperatorViewModel.build(value),{collapsed:false});
  assert.match(html,/任务需要恢复/);assert.match(html,/id="temu-catalog-recover"/);assert.match(html,/恢复当前任务/);assert.match(button(html,'temu-catalog-bind'),/disabled/);assert.match(button(html,'temu-catalog-capture'),/disabled/);assert.doesNotMatch(html,/页面已绑定，可人工采集/);
});

test('health markup shows listing path, breadcrumb source, DOM/network and every failed check',()=>{
  const api=modules(),value=snapshot({health:'READY'});value.context.profile={...value.context.profile,profile_kind:'CAPTURE_ONLY',listing_url:'https://www.temu.com/de-en/girls-sets-o3-1088.html',breadcrumbs:["Kids' Fashion","Girls' Sets"]};value.detection.observed={...value.detection.observed,url:'https://www.temu.com/de-en/girls-sets-o3-1088.html',breadcrumbs:['Home',"Kids' Fashion","Girls' Sets"],categorySource:'BREADCRUMB_TERMINAL',networkReady:false,captchaBlocking:false,searchNoResults:false};value.detection.health.checks={...value.detection.health.checks,listingPath:true,breadcrumbs:true,notCaptchaBlocking:true,notSearchNoResults:true,evidenceReady:true};value.detection.health.failed=[];
  const html=api.TemuCatalogOperatorOverlay.renderMarkup(api.TemuCatalogOperatorViewModel.build(value),{collapsed:false});for(const text of ['页面路径','面包屑','Breadcrumb','CAPTCHA','SEARCH_NO_RESULTS','DOM / Network'])assert.match(html,new RegExp(text));
});

test('operator markup exposes coverage and only reports actual server batch/audit counts',()=>{const api=modules(),value=snapshot({health:'READY',bound:true});value.networkDiagnostics={dom_unique_goods:40,network_unique_goods:42,network_enriched_goods:1,total_fetch_seen:7,total_xhr_seen:5};value.lastResult={batch:{receivedCount:40,duplicateCount:3,excludedCount:2},audit:{acceptedGoods:35,networkEnrichedSaved:1,domOnlySaved:39,networkOnlyRejected:4,failedGoods:0}};value.context.campaign.nonElectronicUniqueCount=101;const model=api.TemuCatalogOperatorViewModel.build(value),html=api.TemuCatalogOperatorOverlay.renderMarkup(model,{collapsed:false});assert.match(html,/DOM商品 40/);assert.match(html,/网络商品 42/);assert.match(html,/严格交集 1/);assert.match(html,/收到：40/);assert.match(html,/新增：35/);assert.match(html,/重复：3/);assert.match(html,/业务排除：2/);assert.match(html,/Network增强保存：1/);assert.match(html,/DOM保存：39/);assert.match(html,/Network-only拒绝：4/);assert.equal(api.TemuCatalogOperatorOverlay.captureSuccessMessage(value),'采集完成：收到40，新增35，重复3，业务排除2，失败0，Network增强保存1，DOM保存39，Network-only拒绝4，当前共101。');});

test('idempotent repeated capture can truthfully display new zero without inventing counts',()=>{const api=modules(),value=snapshot({health:'READY',bound:true});value.lastResult={batch:{receivedCount:40,duplicateCount:40,excludedCount:0},audit:{acceptedGoods:0,networkEnrichedSaved:1,domOnlySaved:39,networkOnlyRejected:0}};value.context.campaign.nonElectronicUniqueCount=101;const model=api.TemuCatalogOperatorViewModel.build(value);assert.deepEqual({...model.counts},{received:40,added:0,duplicates:40,excluded:0,failed:0,current:101,networkEnrichedSaved:1,domOnlySaved:39,networkOnlyRejected:0});assert.match(api.TemuCatalogOperatorOverlay.captureSuccessMessage(value),/新增0/);});

function button(html,id){return html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0]??'';}
