import test from 'node:test';
import assert from 'node:assert/strict';
import {flashActionCheck} from '../../ui/action-button-feedback.js';

test('successful action shows only a checkmark and then restores the original label',()=>{
  const button={textContent:'复制当前搜索词',dataset:{}},scheduled=[];
  flashActionCheck(button,{schedule:fn=>scheduled.push(fn)});
  assert.equal(button.textContent,'✓');
  assert.equal(button.dataset.feedback,'success');
  scheduled[0]();
  assert.equal(button.textContent,'复制当前搜索词');
  assert.equal(button.dataset.feedback,undefined);
});

test('a second success supersedes the pending restore without losing the original label',()=>{
  const button={textContent:'复制绑定码',dataset:{}},scheduled=[];
  flashActionCheck(button,{schedule:fn=>scheduled.push(fn)});
  flashActionCheck(button,{schedule:fn=>scheduled.push(fn)});
  scheduled[0]();
  assert.equal(button.textContent,'✓');
  scheduled[1]();
  assert.equal(button.textContent,'复制绑定码');
});
