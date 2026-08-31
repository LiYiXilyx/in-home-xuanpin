import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSourcingSettings } from '../../src/modules/sourcing/sourcing-settings.mjs';
import { validateConfiguredPaths,validateExistingWorkbook } from '../../src/server/controllers/sourcing-controller.mjs';

test('settings are UX defaults saved atomically without hardcoded platform paths',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sourcing-settings-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=createSourcingSettings({settingsPath:path.join(directory,'settings.json')});
  assert.deepEqual(await store.load(),{sourceDir:null,imageCacheDir:null,selectedWorkbookPath:null});
  const value=await store.save({sourceDir:path.join(directory,'原始 文件'),imageCacheDir:path.join(directory,'图片 缓存'),selectedWorkbookPath:path.join(directory,'分析.xlsx')});
  assert.deepEqual(await store.load(),value);
  assert.deepEqual((await fs.readdir(directory)).sort(),['settings.json']);
});

test('raw evidence, cache and workbook paths must not overlap',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sourcing-path-safety-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const raw=path.join(directory,'raw'),cache=path.join(directory,'cache');await fs.mkdir(raw);await fs.mkdir(cache);
  const workbook=path.join(directory,'analysis.xlsx');await fs.writeFile(workbook,'x');
  assert.deepEqual(await validateConfiguredPaths({sourceDir:raw,imageCacheDir:cache,selectedWorkbookPath:workbook}),{sourceDir:await fs.realpath(raw),imageCacheDir:await fs.realpath(cache),selectedWorkbookPath:await fs.realpath(workbook)});
  await assert.rejects(()=>validateConfiguredPaths({sourceDir:raw,imageCacheDir:raw,selectedWorkbookPath:workbook}),error=>error.code==='SOURCE_CACHE_OVERLAP');
  const rawWorkbook=path.join(raw,'601.xlsx');await fs.writeFile(rawWorkbook,'x');
  await assert.rejects(()=>validateConfiguredPaths({sourceDir:raw,imageCacheDir:cache,selectedWorkbookPath:rawWorkbook}),error=>error.code==='WORKBOOK_RAW_OVERLAP');
  const newCache=path.join(directory,'new-cache');
  const created=await validateConfiguredPaths({sourceDir:raw,imageCacheDir:newCache,selectedWorkbookPath:workbook});
  assert.equal(created.imageCacheDir,await fs.realpath(newCache));
});

test('existing workbook validation requires Sheet05',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sourcing-workbook-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const workbookPath=path.join(directory,'分析 工作簿.xlsx');await fs.writeFile(workbookPath,'fixture');
  const artifact=names=>({FileBlob:{load:async()=>Buffer.from('x')},SpreadsheetFile:{importXlsx:async()=>({worksheets:{items:names.map(name=>({name}))}})}});
  assert.deepEqual(await validateExistingWorkbook(workbookPath,{artifact:artifact(['05_细分商品明细'])}),{valid:true});
  await assert.rejects(()=>validateExistingWorkbook(workbookPath,{artifact:artifact(['其它Sheet'])}),error=>error.code==='WORKBOOK_SHEET05_REQUIRED');
});
