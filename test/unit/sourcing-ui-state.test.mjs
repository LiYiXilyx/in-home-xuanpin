import assert from 'node:assert/strict';
import test from 'node:test';
import { sourcingControls } from '../../ui/sourcing-ui-state.js';

test('import is enabled only for SCAN_VALID and paths lock during work',()=>{
  assert.equal(sourcingControls({state:'SCAN_VALID'}).canImport,true);
  for(const state of ['UNCONFIGURED','READY_TO_SCAN','SCAN_STALE','SCAN_BLOCKED','FAILED','IMPORTING']) assert.equal(sourcingControls({state}).canImport,false);
  assert.equal(sourcingControls({state:'IMPORTING'}).pathsLocked,true);
  assert.equal(sourcingControls({state:'RETRYING_FAILED_IMAGES'}).pathsLocked,true);
});

test('retry is enabled only for warning state with failures',()=>{
  assert.equal(sourcingControls({state:'COMPLETED_WITH_WARNINGS',imageFailed:1}).canRetry,true);
  assert.equal(sourcingControls({state:'COMPLETED_WITH_WARNINGS',imageFailed:0}).canRetry,false);
  assert.equal(sourcingControls({state:'COMPLETED',imageFailed:1}).canRetry,false);
});
