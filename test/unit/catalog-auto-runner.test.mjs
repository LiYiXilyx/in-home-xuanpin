import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'browser-extension/catalog-auto-runner.js'),'utf8');
const sandbox=vm.createContext({ console,setTimeout,clearTimeout,Date });
vm.runInContext(source,sandbox);
const { CatalogAutoRunner,STATES,uiSummary }=sandbox.TemuCatalogAutoRunnerModule;

function signals(ids=['1'],extra={}) { return { goodsIds:new Set(ids),cardCount:ids.length,scrollHeight:1000,
  verification:false,unhealthy:false,tryAgain:false,contextHealthy:true,loading:false,...extra }; }
function fixture({ target=1,currentUnique=0,initial=signals(),submitCounts=[1],afterScroll=null,progress=[],queueStatus='capturing',label='See more',checkpoint={} }={}) {
  let current=initial;let submitIndex=0;let contextReads=0;const checkpoints=[];const manual=[];const resumes=[];let triggerCount=0;
  const context=() => ({ campaign:{ id:'campaign-1',status:contextReads++===0 ? (queueStatus==='manual_required'?'manual_required':'running'):'running',
    targetCount:target,nonElectronicUniqueCount:currentUnique },source:{ id:'source-1' },queue:{ id:'queue-1',status:contextReads===1 ? queueStatus:'opening',checkpoint } });
  const deps={ now:() => '2026-08-26T00:00:00.000Z',delay:async () => {},scan:() => current,getContext:async () => context(),
    submit:async () => { const count=submitCounts[Math.min(submitIndex++,submitCounts.length-1)];return { batch:{ batchId:`batch-${submitIndex}` },
      campaign:{ targetCount:target,nonElectronicUniqueCount:count,rawObservedCount:count,electronicExcludedCount:0 } }; },
    scroll:async () => { if (afterScroll) current=afterScroll; },findLoadControl:() => ({ label }),controlLabel:button => button.label,
    trigger:async () => { triggerCount+=1; },waitForProgress:async () => progress.shift() ?? current,
    checkpoint:async payload => { checkpoints.push(payload);return payload; },
    manualRequired:async payload => { manual.push(payload);return payload; },resume:async payload => { resumes.push(payload);return payload; } };
  return { deps,checkpoints,manual,resumes,get triggerCount() { return triggerCount; } };
}

test('initial scan submits a batch and stops at the configured smoke target',async () => {
  const value=fixture({ target:5,submitCounts:[3] });const runner=new CatalogAutoRunner(value.deps);
  const result=await runner.start({ smokeLimit:3 });
  assert.equal(result.state,STATES.COMPLETED);assert.equal(result.round,1);
  assert.equal(value.checkpoints.some(item => item.checkpoint.runner_state==='BATCH_SUBMITTING'),true);
  assert.equal(value.checkpoints.at(-1).checkpoint.stop_reason,'AB_TARGET_REACHED');
});

test('scroll progress with a new goods id submits the next batch',async () => {
  const value=fixture({ target:2,submitCounts:[1,2],afterScroll:signals(['1','2'],{ scrollHeight:1500 }) });
  const result=await new CatalogAutoRunner(value.deps).start();
  assert.equal(result.state,STATES.COMPLETED);assert.equal(result.round,2);
  assert.equal(value.checkpoints.some(item => item.checkpoint.last_action==='scroll_progress'),true);
});

test('See more DOM progress is accepted only when a new goods id appears',async () => {
  const value=fixture({ target:2,submitCounts:[1,2],progress:[signals(['1','2'],{ scrollHeight:1800,loadingObserved:true })],label:'See more' });
  const result=await new CatalogAutoRunner(value.deps).start();
  assert.equal(result.state,STATES.COMPLETED);assert.equal(value.triggerCount,1);
  const progress=value.checkpoints.find(item => item.checkpoint.last_action==='load_more_progress');
  assert.equal(progress.checkpoint.new_goods_count,1);assert.equal(progress.checkpoint.button_label,'See more');
});

test('Try again pauses immediately for manual recovery and is never clicked',async () => {
  const value=fixture({ target:3,initial:signals(['1'],{ tryAgain:true }),submitCounts:[1],label:'Try again' });
  const result=await new CatalogAutoRunner(value.deps).start();
  assert.equal(result.state,STATES.MANUAL_REQUIRED);assert.equal(value.triggerCount,0);assert.equal(value.manual.length,1);
  assert.equal(value.manual[0].error_code,'LISTING_CONTEXT_UNHEALTHY');
  assert.equal(JSON.stringify(value.manual[0]).includes('SOURCE_EXHAUSTED'),false);
});

test('wrong locale, category, currency, or sort pauses before submission',async () => {
  const value=fixture({ initial:signals(['1'],{ contextHealthy:false }) });const result=await new CatalogAutoRunner(value.deps).start();
  assert.equal(result.state,STATES.MANUAL_REQUIRED);assert.equal(value.manual[0].error_code,'LISTING_CONTEXT_UNHEALTHY');
  assert.equal(value.checkpoints.some(item=>item.checkpoint.last_action==='batch_submitted'),false);
});

test('CAPTCHA and unhealthy listing stop before batch submission',async () => {
  for (const [input,code] of [[signals(['1'],{ verification:true }),'CAPTCHA_OR_LOGIN'],[signals([],{ unhealthy:true }),'LISTING_CONTEXT_UNHEALTHY']]) {
    const value=fixture({ initial:input });const result=await new CatalogAutoRunner(value.deps).start();
    assert.equal(result.state,STATES.MANUAL_REQUIRED);assert.equal(value.manual[0].error_code,code);
    assert.equal(value.checkpoints.some(item => item.checkpoint.last_action==='batch_submitted'),false);
  }
});

test('resume uses the existing manual queue checkpoint and never extends its saved smoke target',async () => {
  const value=fixture({ queueStatus:'manual_required',target:1000,currentUnique:3,submitCounts:[5],
    checkpoint:{ runner_state:'MANUAL_REQUIRED',runner_mode:'smoke',session_target:5,round:4,ab_started_at:'2026-08-26T00:00:00.000Z' } });
  const runner=new CatalogAutoRunner(value.deps);
  const result=await runner.resume({ smokeLimit:1 });
  assert.equal(value.resumes.length,1);assert.equal(value.resumes[0].queue_id,'queue-1');assert.equal(result.state,STATES.COMPLETED);
  assert.equal(result.sessionTarget,5);assert.equal(result.round,5);
});

test('operator panel exposes a human-readable progress summary and Top Sales warning',() => {
  const value=uiSummary({ state:STATES.MANUAL_REQUIRED,round:20,sessionTarget:1000,lastAction:'manual_required',
    campaign:{ nonElectronicUniqueCount:737,rawObservedCount:16880,electronicExcludedCount:42 } },'Relevance');
  assert.equal(value.stateLabel,'需要人工处理');assert.equal(value.percent,74);assert.equal(value.sortHealthy,false);
  assert.equal(value.action,'等待人工处理');
});
