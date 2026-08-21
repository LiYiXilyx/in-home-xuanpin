import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { extractHyperlink,extractHyperlinkLabel,manualValuesForProduct,timestampedWorkbookPath } from '../../src/modules/export/manual-values.mjs';
import { saveWorkbookWithFallback } from '../../src/modules/export/export-service.mjs';

test('manual values prefer goods_id and use canonical_url only as fallback',() => {
  const state={
    byGoodsId:new Map([['g1',{ '人工备注':'goods-note' }]]),
    byCanonicalUrl:new Map([['https://example.test/g1',{ '人工备注':'url-note' }],['https://example.test/g2',{ '人工备注':'fallback' }]])
  };
  assert.equal(manualValuesForProduct(state,{ goods_id:'g1',canonical_url:'https://example.test/g1' })['人工备注'],'goods-note');
  assert.equal(manualValuesForProduct(state,{ goods_id:'g2',canonical_url:'https://example.test/g2' })['人工备注'],'fallback');
  assert.equal(extractHyperlink('=HYPERLINK("https://example.test/g1","打开商品")'),'https://example.test/g1');
  assert.equal(extractHyperlinkLabel('=HYPERLINK("https://example.test/g1","https://example.test/g1")'),'https://example.test/g1');
});

test('occupied fixed workbook falls back to a timestamped file',async () => {
  const fixed=path.resolve('output','Temu运营商品池.xlsx');
  const attempts=[];
  const saved=await saveWorkbookWithFallback({},fixed,{
    now:() => new Date('2026-08-21T10:11:12.345Z'),
    saveImpl:async target => {
      attempts.push(target);
      if (target === fixed) throw Object.assign(new Error('locked'),{ code:'EBUSY' });
    }
  });
  assert.equal(attempts.length,2);
  assert.notEqual(saved,fixed);
  assert.match(path.basename(saved),/^Temu运营商品池-20260821-101112-345\.xlsx$/);
  assert.equal(saved,timestampedWorkbookPath(fixed,new Date('2026-08-21T10:11:12.345Z')));
});
