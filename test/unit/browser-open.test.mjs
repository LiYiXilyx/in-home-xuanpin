import assert from 'node:assert/strict';
import test from 'node:test';
import { runBrowserOpenCommand } from '../../src/app/commands/browser-open.mjs';

test('browser smoke validation reports stale category pages as NOT_READY',async () => {
  const page={ url:() => 'https://www.temu.com/category.html?_x_sessn_id=secret' };
  const result=await runBrowserOpenCommand({ catalog:{ jobs:[{}] } },{ smoke:true },{
    openSession:async () => ({ endpoint:'http://127.0.0.1:9223',context:{} }),
    closeSession:async () => {},findPage:async () => page,
    inspectPage:async () => ({ status:'NOT_READY',code:'STALE_CATEGORY_PAGE',checks:{ PAGE_HEALTH:'STALE_CATEGORY_PAGE' },productLinkCount:0 }),
    inspectDetailAvailability:async () => { throw new Error('NOT_READY 页面不应进行详情抽查'); }
  });
  assert.equal(result.status,'NOT_READY');
  assert.equal(result.pageState,'STALE_CATEGORY_PAGE');
  assert.equal(result.productLinkCount,0);
  assert.equal(result.pageUrl,'https://www.temu.com/category.html');
});

test('browser smoke does not report READY when listing cards lead to unavailable details',async () => {
  const page={ url:() => 'https://www.temu.com/de-en/motorcycles--accessories-o3-585.html' };
  const result=await runBrowserOpenCommand({ catalog:{ jobs:[{}] } },{ smoke:true },{
    openSession:async () => ({ endpoint:'http://127.0.0.1:9223',context:{} }),closeSession:async () => {},findPage:async () => page,
    inspectPage:async () => ({ status:'READY',code:'READY',checks:{ PAGE_HEALTH:'READY' },productLinkCount:40 }),
    inspectDetailAvailability:async () => ({ status:'NOT_READY',code:'DETAIL_AVAILABILITY_MISMATCH',checks:{ PAGE_HEALTH:'DETAIL_AVAILABILITY_MISMATCH' },productLinkCount:0 })
  });
  assert.equal(result.status,'NOT_READY');assert.equal(result.pageState,'DETAIL_AVAILABILITY_MISMATCH');
});
