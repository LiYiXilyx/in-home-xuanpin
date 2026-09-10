import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { scanYingdaoDirectory } from '../../src/modules/sourcing/yingdao-directory-scanner.mjs';

test('current official directory contains exactly 50 parseable direct exports', async () => {
  const sourceDir=process.env.YINGDAO_REAL_SOURCE_DIR;
  assert.ok(sourceDir,'YINGDAO_REAL_SOURCE_DIR must identify the approved real export directory');

  const result=await scanYingdaoDirectory({
    sourceDir,
    importedAt:'2026-08-31T00:00:00.000Z',
  });
  const repeated=await scanYingdaoDirectory({
    sourceDir,
    importedAt:'2026-08-31T00:00:00.000Z',
  });

  assert.equal(result.sourceExportFiles,50);
  assert.equal(result.parsedFiles,50);
  assert.deepEqual(result.failedFiles,[]);
  assert.equal(result.uniqueTemuGoodsId,50);
  assert.equal(result.totalSourceCandidates,1499);
  assert.deepEqual(result.invalidFiles,[]);
  assert.deepEqual(result.duplicateGoodsId,[]);
  assert.equal(result.preview.length,10);
  assert.ok(result.preview.every(item=>item.filename===`${item.temu_goods_id}.xlsx`));
  assert.ok(result.files.every(file=>path.basename(file.filename)===file.filename));
  assert.ok(result.candidates.every(item=>typeof item.temu_goods_id==='string'));
  assert.ok(result.candidates.every(item=>item['1688_product_id']===null || typeof item['1688_product_id']==='string'));
  assert.ok(result.candidates.every(item=>item.source_export_file===`${item.temu_goods_id}.xlsx`));
  assert.equal(repeated.sourceManifestSha256,result.sourceManifestSha256);
  assert.equal(repeated.canonicalText,result.canonicalText);
});
