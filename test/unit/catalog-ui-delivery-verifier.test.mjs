import test from 'node:test';
import assert from 'node:assert/strict';
import { runCatalogUiDeliveryVerification } from '../../scripts/verify-catalog-ui-delivery.mjs';

test('Catalog UI verifier uses temporary state and reports every required Gate',async()=>{
  const result=await runCatalogUiDeliveryVerification({env:{},argv:[]});
  assert.equal(result.productionDatabaseWrites,0);assert.equal(result.realTemuCaptureStarted,false);
  assert.equal(result.yingdaoBusinessImplemented,false);assert.equal(result.gates.CATALOG_UI_NAMESPACE_ISOLATED,'YES');
  assert.equal(result.gates.CATALOG_API_NAMESPACE_ISOLATED,'YES');assert.equal(result.gates.CATALOG_STATE_ISOLATED,'YES');
  assert.equal(result.gates.CATALOG_POLLING_ISOLATED,'YES');assert.equal(result.gates.YINGDAO_UI_ROOT_PRESERVED,'YES');
  assert.equal(result.gates.YINGDAO_ROOT_REQUIRED_BY_CATALOG,'NO');assert.equal(result.gates.CATALOG_EVENTS_REQUIRED_FOR_YINGDAO_CORRECTNESS,'NO');
  assert.equal(result.gates.APP_JS_CATALOG_DUPLICATE_IMPLEMENTATION,'NO');assert.equal(result.gates.CATALOG_POOL_READ_DB_WRITES,0);
  assert.equal(result.gates.CATALOG_POOL_READ_GLOBAL_FALLBACK,'NO');
});

test('Catalog UI verifier rejects production config and arbitrary database inputs',async()=>{
  await assert.rejects(()=>runCatalogUiDeliveryVerification({env:{TEMU_CONFIG_PATH:'/prod/config.json'},argv:[]}),
    error=>error.code==='CATALOG_UI_VERIFIER_PRODUCTION_INPUT_FORBIDDEN');
  await assert.rejects(()=>runCatalogUiDeliveryVerification({env:{},argv:['--config','config.json']}),
    error=>error.code==='CATALOG_UI_VERIFIER_PRODUCTION_INPUT_FORBIDDEN');
  await assert.rejects(()=>runCatalogUiDeliveryVerification({env:{},argv:['--database=/tmp/data.db']}),
    error=>error.code==='CATALOG_UI_VERIFIER_PRODUCTION_INPUT_FORBIDDEN');
});
