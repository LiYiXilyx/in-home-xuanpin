import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalManifest,
  classifySourceEntries,
  scanYingdaoDirectory,
} from '../../src/modules/sourcing/yingdao-directory-scanner.mjs';

test('manifest is path-independent and sorted by NFC-normalized filename UTF-8 bytes', () => {
  const files=[
    { filename:'/first/raw/20.xlsx',fileSha256:'bb' },
    { filename:'C:\\second\\raw\\100.xlsx',fileSha256:'aa' },
    { filename:'/first/raw/e\u0301.xlsx',fileSha256:'cc' },
  ];
  const result=canonicalManifest(files);
  const expectedText='100.xlsx\0aa\n20.xlsx\0bb\né.xlsx\0cc\n';
  assert.equal(result.canonicalText,expectedText);
  assert.equal(result.sourceManifestSha256,'84ea45ee28590a1f69049cd6c90821a968ef2edbb5b998f5c772d3a3f54c1e97');

  const moved=canonicalManifest([
    { filename:'D:\\moved\\20.xlsx',fileSha256:'bb' },
    { filename:'/moved/100.xlsx',fileSha256:'aa' },
    { filename:'D:\\moved\\e\u0301.xlsx',fileSha256:'cc' },
  ]);
  assert.deepEqual(moved,result);
});

test('classification reports duplicate goods IDs without reading nested directories', () => {
  const result=classifySourceEntries([
    { name:'601.xlsx',isFile:()=>true,isDirectory:()=>false },
    { name:'601.xlsx',isFile:()=>true,isDirectory:()=>false },
    { name:'nested',isFile:()=>false,isDirectory:()=>true },
  ]);
  assert.deepEqual(result.duplicateGoodsId,['601']);
});

test('classification previews direct numeric xlsx names and reports invalid xlsx names', () => {
  const result=classifySourceEntries([
    { name:'601.xlsx',isFile:()=>true,isDirectory:()=>false },
    { name:'bad-name.xlsx',isFile:()=>true,isDirectory:()=>false },
    { name:'notes.txt',isFile:()=>true,isDirectory:()=>false },
    { name:'nested',isFile:()=>false,isDirectory:()=>true },
  ],{ previewLimit:10 });
  assert.deepEqual(result.preview,[{ filename:'601.xlsx',temu_goods_id:'601' }]);
  assert.deepEqual(result.invalidFiles,['bad-name.xlsx']);
  assert.equal(result.excelFileCount,2);
});

test('directory scan is non-recursive and parses only direct recognized exports', async t => {
  const sourceDir=await fs.mkdtemp(path.join(os.tmpdir(),'yingdao-scan-'));
  t.after(()=>fs.rm(sourceDir,{ recursive:true,force:true }));
  await fs.mkdir(path.join(sourceDir,'nested'));
  await fs.writeFile(path.join(sourceDir,'601.xlsx'),'direct');
  await fs.writeFile(path.join(sourceDir,'nested','999.xlsx'),'nested');

  const loaded=[];
  const result=await scanYingdaoDirectory({
    sourceDir,
    loadWorkbook:async filePath => {
      loaded.push(filePath);
      return { headers:['产品ID'],rows:[['1688-1']] };
    },
    parseRows:({ rows })=>rows,
  });

  assert.deepEqual(loaded,[path.join(sourceDir,'601.xlsx')]);
  assert.equal(result.sourceExportFiles,1);
  assert.equal(result.parsedFiles,1);
  assert.equal(result.uniqueTemuGoodsId,1);
  assert.equal(result.totalSourceCandidates,1);
  assert.deepEqual(result.failedFiles,[]);
  assert.deepEqual(result.preview,[{ filename:'601.xlsx',temu_goods_id:'601' }]);
});
