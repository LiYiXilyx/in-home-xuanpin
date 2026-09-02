import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('new category boundary audit freezes the existing reuse seams',()=>{
  const auditPath=path.join(root,'docs/superpowers/audits/2026-09-02-new-category-onboarding-boundary-audit.md');
  assert.equal(fs.existsSync(auditPath),true,'boundary audit must exist before implementation');
  const audit=fs.readFileSync(auditPath,'utf8');
  for(const marker of [
    'PROFILE_SOURCES = BUILT_IN + OPERATOR_MANAGED',
    'MANUAL_BIND_MODE = MANUAL_BIND_PASSIVE_CAPTURE',
    'PREVIEW_SCOPE = campaign_id + candidate_revision',
    'FORMAL_SCOPE = category_key + category_profile_version + pool_version_id',
    'MOTORCYCLE_POLICY_REUSE_FOR_CAPTURE_ONLY = NO',
    'SECOND_CAPTURE_STACK = NO',
  ]) assert.match(audit,new RegExp(escapeRegExp(marker)));
});

test('current implementation exposes the characterized Catalog seams',()=>{
  const files={
    registry:'src/modules/catalog-scale/category-profile-registry.mjs',
    profile:'src/modules/catalog-scale/category-profile.mjs',
    qa:'src/modules/catalog-scale/initial-pool-qa.mjs',
    manual:'browser-extension/catalog-manual-binding.js',
    export:'src/modules/export/export-service.mjs',
  };
  for(const [name,relative] of Object.entries(files)){
    const source=fs.readFileSync(path.join(root,relative),'utf8');
    assert.ok(source.length>100,`${name} seam must remain present`);
  }
  assert.match(fs.readFileSync(path.join(root,files.registry),'utf8'),/createCategoryProfileRegistry/);
  assert.match(fs.readFileSync(path.join(root,files.qa),'utf8'),/evaluateInitialPoolQa/);
  assert.match(fs.readFileSync(path.join(root,files.manual),'utf8'),/category_names/);
  assert.match(fs.readFileSync(path.join(root,files.export),'utf8'),/exportOperationsWorkbook/);
});

function escapeRegExp(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
