import test from 'node:test';import assert from 'node:assert/strict';
import {runQueueItems,itemCaptureFailure,queueItemProgress} from './queue-failure-policy.mjs';
test('second item fails after saving partial results; third still runs',async()=>{
 const visited=[],report={results:[],summaries:[]};
 await runQueueItems(['first','second','third'],async anchor=>{visited.push(anchor);report.results.push({anchor,query:anchor,id:anchor,items:['1','2']});if(anchor==='second')throw itemCaptureFailure('图片加载超时');report.summaries.push({anchor,query:anchor,reason:'TARGET_REACHED'});},async(anchor,e)=>report.summaries.push({anchor,query:anchor,reason:'ITEM_FAILED',error:e.message}));
 assert.deepEqual(visited,['first','second','third']);assert.equal(report.results.length,3);
 const failed=queueItemProgress(report,{anchor:'second',query:'second'});assert.equal(failed.count,2);assert.equal(failed.error,'图片加载超时');assert.deepEqual(failed.ids,['second']);assert.match(failed.label,/跳过/);
 assert.equal(queueItemProgress(report,{anchor:'third',query:'third'}).label,'已完成');
});
for(const reason of ['页面验证或加载限制','Operator stopped trial','VMLogin connection failed','Unexpected end of JSON input'])test('queue stops on '+reason,async()=>{const visited=[];await assert.rejects(runQueueItems([1,2,3],async i=>{visited.push(i);if(i===2)throw Error(reason);},()=>assert.fail('fatal error cannot be skipped')),new RegExp(reason));assert.deepEqual(visited,[1,2]);});
test('failure recording failure stops the queue',async()=>{const visited=[];await assert.rejects(runQueueItems([1,2],async i=>{visited.push(i);throw itemCaptureFailure('timeout');},()=>{throw Error('storage unavailable');}),/storage unavailable/);assert.deepEqual(visited,[1]);});
test('unstarted item is distinct from an interrupted item',()=>{const report={status:'STOPPED',current:{anchor:'second'},error:'验证码',results:[{anchor:'second',query:'q',items:['1'],id:'s'}]};assert.equal(queueItemProgress(report,{anchor:'third',query:'q'}).label,'未开始（队列已停止）');assert.equal(queueItemProgress(report,{anchor:'second',query:'q'}).error,'验证码');assert.equal(queueItemProgress(report,{anchor:'third',query:'q'}).error,null);});
