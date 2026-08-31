import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { chooseNativePath } from '../../src/modules/sourcing/native-path-dialog.mjs';

test('macOS folder picker uses arguments without a shell and preserves Unicode spaces',async()=>{
  const calls=[];
  const result=await chooseNativePath({platform:'darwin',kind:'RAW_DIRECTORY',currentPath:'/tmp/旧 目录',runProcess:async call=>{
    calls.push(call);return {code:0,stdout:'/tmp/原始 文件\n',stderr:''};
  }});
  assert.equal(result.path,'/tmp/原始 文件');
  assert.equal(calls[0].command,'osascript');
  assert.equal(calls[0].shell,false);
  assert.ok(calls[0].args.every(value=>typeof value==='string'));
});

test('all three macOS picker kinds use fixed native dialog contracts',async()=>{
  const calls=[];
  for(const kind of ['RAW_DIRECTORY','IMAGE_CACHE_DIRECTORY','ANALYSIS_WORKBOOK']) {
    await chooseNativePath({platform:'darwin',kind,runProcess:async call=>{calls.push(call);return {code:0,stdout:'/tmp/x.xlsx\n',stderr:''};}});
  }
  assert.match(calls[0].args.join(' '),/choose folder/);
  assert.match(calls[1].args.join(' '),/choose folder/);
  assert.match(calls[2].args.join(' '),/choose file/);
  assert.doesNotMatch(calls[2].args.join(' '),/choose file name/);
});

test('Windows workbook picker uses checked-in STA OpenFileDialog script',async()=>{
  const calls=[];
  const result=await chooseNativePath({platform:'win32',kind:'ANALYSIS_WORKBOOK',currentPath:'C:\\数据 目录\\a.xlsx',runProcess:async call=>{
    calls.push(call);return {code:0,stdout:'C:\\数据 目录\\opportunity-analysis-with-1688.xlsx\r\n',stderr:''};
  }});
  assert.equal(result.path,'C:\\数据 目录\\opportunity-analysis-with-1688.xlsx');
  assert.deepEqual(calls[0].args.slice(0,4),['-NoProfile','-NonInteractive','-Sta','-File']);
  assert.ok(calls[0].args.includes('ANALYSIS_WORKBOOK'));
  assert.equal(calls[0].shell,false);
});

test('cancel returns cancelled and preserves caller value',async()=>{
  const result=await chooseNativePath({platform:'darwin',kind:'RAW_DIRECTORY',currentPath:'/keep/me',runProcess:async()=>({code:2,stdout:'',stderr:''})});
  assert.deepEqual(result,{cancelled:true,path:'/keep/me'});
});

test('localized macOS -128 cancellation preserves caller value',async()=>{
  const result=await chooseNativePath({platform:'darwin',kind:'RAW_DIRECTORY',currentPath:'/keep/me',runProcess:async()=>({code:1,stdout:'',stderr:'execution error: 用户已取消。 (-128)'})});
  assert.deepEqual(result,{cancelled:true,path:'/keep/me'});
});

test('unsupported kind is rejected before process launch',async()=>{
  let launched=false;
  await assert.rejects(()=>chooseNativePath({platform:'darwin',kind:'SAVE_WORKBOOK',runProcess:async()=>{launched=true;}}),/PATH_DIALOG_KIND/);
  assert.equal(launched,false);
});

test('Windows script emits UTF-8 and never uses SaveFileDialog',()=>{
  const source=fs.readFileSync(new URL('../../scripts/native/select-sourcing-path.ps1',import.meta.url),'utf8');
  assert.match(source,/Console\]::OutputEncoding=\$utf8/);
  assert.match(source,/OpenFileDialog/);assert.match(source,/FolderBrowserDialog/);assert.doesNotMatch(source,/SaveFileDialog/);
});
