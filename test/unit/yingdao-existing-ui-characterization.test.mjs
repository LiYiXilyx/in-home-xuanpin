import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('validated YingDao sourcing and review delivery is present on the Catalog shared baseline',()=>{
  const router=fs.readFileSync('src/server/router.mjs','utf8');
  const server=fs.readFileSync('src/server/index.mjs','utf8');
  const html=fs.readFileSync('ui/index.html','utf8');
  assert.match(router,/\/api\/sourcing\/settings/);
  assert.match(router,/\/api\/sourcing\/review\/bootstrap/);
  assert.match(server,/createSourcingController/);
  assert.match(server,/createSourcingReviewController/);
  assert.match(html,/id="yingdao-module-root"/);
  assert.equal(fs.existsSync('ui/sourcing-review.html'),true);
  assert.equal(fs.existsSync('db/sourcing-migrations/004_sourcing_review_console_v1.sql'),true);
});
