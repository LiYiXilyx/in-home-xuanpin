import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createOperationsServer} from '../../src/server/index.mjs';
import {verifyYingdaoUiDelivery} from '../../scripts/1688/verify-yingdao-ui-delivery.mjs';
import {verifyReviewConsoleSafety} from '../../scripts/1688/verify-sourcing-safety.mjs';

const acceptanceRoot=process.env.YINGDAO_ACCEPTANCE_PROJECT_ROOT;
const realAvailable=Boolean(acceptanceRoot&&fs.existsSync(path.join(acceptanceRoot,'data/1688_sourcing.db')));

test('shared Operator serves Catalog and YingDao roots, modules and Review Console from one server',{skip:!acceptanceRoot},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'yingdao-operator-smoke-')),config=JSON.parse(fs.readFileSync(path.join(acceptanceRoot,'config.json'),'utf8'));config.app.databasePath=path.join(temp,'temu-smoke.db');
  const app=await createOperationsServer({config,sourcingDatabasePath:path.resolve('data/1688_sourcing.db'),logError(){}}),address=await app.listen({port:0});
  try {
    const [home,review,module]=await Promise.all([fetch(`${address.url}/`),fetch(`${address.url}/sourcing-review.html`),fetch(`${address.url}/modules/yingdao/panel.js`)]),html=await home.text();
    assert.equal(home.status,200);assert.match(html,/id="catalog-module-root"/);assert.match(html,/id="yingdao-module-root"/);
    assert.equal(review.status,200);assert.match(await review.text(),/1688候选人工复核/);assert.equal(module.status,200);assert.match(await module.text(),/mountYingdaoPanel/);
  } finally {await app.close();fs.rmSync(temp,{recursive:true,force:true});}
});

test('real Review V1 remains 50 goods 250 candidates with zero mapping errors',{skip:!realAvailable},async()=>{
  const report=await verifyReviewConsoleSafety({sourcingDatabasePath:path.join(acceptanceRoot,'data/1688_sourcing.db'),temuDatabasePath:path.join(acceptanceRoot,'data/temu_research_v2.db'),
    runId:'yingdao_random5_v1_20260831_001',projectRoot:acceptanceRoot});
  assert.equal(report.pass,true);assert.equal(report.goods,50);assert.equal(report.candidates,250);assert.equal(report.image_mapping_error,0);assert.equal(report.sourcing_integrity,'ok');assert.equal(report.sourcing_foreign_key_violations,0);
  const delivery=verifyYingdaoUiDelivery({projectRoot:process.cwd(),reviewSafety:report});assert.equal(delivery.review_v1_goods,50);assert.equal(delivery.review_v1_candidates,250);assert.equal(delivery.review_v1_image_mapping_errors,0);
});
