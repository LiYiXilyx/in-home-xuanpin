import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const scriptPath=path.resolve(import.meta.dirname,'../../scripts/verify-multi-category-readonly.mjs');

test('production QA script is read-only and reports every protected counter',()=>{
  const source=fs.readFileSync(scriptPath,'utf8');
  assert.match(source,/openDatabase\(.+\{\s*readOnly:true\s*\}/s);
  for(const key of ['integrityCheck','foreignKeyViolations','LEGACY_MEMBERSHIP_NULL_CATEGORY_KEY','LEGACY_ACTIVE_MEMBERSHIP_NULL_CATEGORY_KEY','legacyMembershipsUniquelyResolved','legacyMembershipsUnresolved','legacyMembershipsAmbiguous','protectedCampaign','protectedActivePool','protectedProductCount'])assert.match(source,new RegExp(key));
  assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
});
