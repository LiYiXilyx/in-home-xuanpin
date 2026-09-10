# Multi-Category Safety Foundation V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a second DE / English / EUR category safe across Campaign resume, membership materialization, active pools, classification, Excel, and operator-bound passive capture without changing production data.

**Architecture:** `category_key` is the canonical category discriminator, while explicit pool and snapshot IDs are the stable inputs for downstream work. A normalized Category Profile freezes uniform taxonomy bindings and membership scope into each Campaign. All compatibility for null-key Motorcycle memberships is read-only, pool-authoritative, uniquely resolved, and unavailable to new categories.

**Tech Stack:** Node.js 22 ESM, `node:test`, SQLite, browser-extension Manifest V3, `@oai/artifact-tool` workbook runtime.

**Spec:** `docs/superpowers/specs/2026-08-31-multi-category-safety-foundation-v1-design.md`

## Global Constraints

- Product identity remains `platform + external_product_id`; category never enters `products` identity.
- No real Temu capture, no production database writes, no production membership backfill, and no production reclassification/materialization.
- Do not resume or mutate the paused `1208 / 2000` Motorcycle Full Refresh Campaign.
- New Category Profiles require all three taxonomy bindings; only recognized historical Motorcycle profiles receive legacy binding resolution.
- `MANUAL_BIND_PASSIVE_CAPTURE` has no automatic navigation, scrolling, pagination, See more, category/sort switching, or CAPTCHA handling.
- Every behavior change follows a witnessed RED → minimal GREEN → regression cycle.
- Do not push.

---

### Task 1: Normalize Category Profile scope and taxonomy bindings

**Files:**
- Modify: `config/categories/motorcycle-accessories.json`
- Modify: `src/modules/catalog-scale/category-profile.mjs`
- Test: `test/unit/category-profile.test.mjs`

**Interfaces:**
- Produces: `validateCategoryProfile(input)` returning frozen `membership_scope`, `legacy_membership_scopes`, and `taxonomy_bindings`.
- Produces: `resolveTaxonomyBinding(profile,pipeline)` returning `{taxonomyName,taxonomyVersion,ruleVersion,categoryScope}`.
- Consumes: existing `ConfigError` and historical Motorcycle profile version.

- [ ] **Step 1: Write failing binding and legacy-gate tests**

```js
test('new categories require uniform bindings and cannot inherit legacy taxonomy',() => {
  const profile=fixtureProfile('category-b');
  delete profile.taxonomy_bindings;
  assert.throws(() => validateCategoryProfile(profile),error => error.code==='CATEGORY_PROFILE_BINDING_REQUIRED');
});

test('resolved binding freezes the owning category scope without inventing a version',() => {
  const profile=validateCategoryProfile(fixtureProfile('category-b'));
  assert.deepEqual(resolveTaxonomyBinding(profile,'classify'),{
    taxonomyName:'category-b-rules',taxonomyVersion:null,ruleVersion:'category-b-rule-v1',categoryScope:'category-b'
  });
});
```

- [ ] **Step 2: Run the unit test and verify RED**

Run: `node --test test/unit/category-profile.test.mjs`

Expected: FAIL because `resolveTaxonomyBinding` and required multi-pipeline binding validation do not exist.

- [ ] **Step 3: Implement the normalized profile and recognized Motorcycle compatibility**

```js
export function resolveTaxonomyBinding(profile,pipeline) {
  const binding=profile.taxonomy_bindings?.[pipeline];
  if (!binding) throw coded('CATEGORY_PROFILE_BINDING_REQUIRED',`缺少 taxonomy_bindings.${pipeline}`);
  return Object.freeze({ taxonomyName:binding.taxonomy_name,taxonomyVersion:binding.taxonomy_version,
    ruleVersion:binding.rule_version,categoryScope:profile.category_key });
}
```

Add explicit `membership_scope`, two exact Motorcycle legacy scope aliases already present in production, and the three real Motorcycle bindings. Use `null` only where the current taxonomy exposes no separate version.

- [ ] **Step 4: Run the unit test and verify GREEN**

Run: `node --test test/unit/category-profile.test.mjs`

Expected: PASS with no warnings.

- [ ] **Step 5: Commit Task 1**

```bash
git add config/categories/motorcycle-accessories.json src/modules/catalog-scale/category-profile.mjs test/unit/category-profile.test.mjs
git commit -m "feat: freeze category taxonomy bindings"
```

### Task 2: Add category-scope and legacy membership resolver

**Files:**
- Create: `src/modules/catalog-scale/category-scope.mjs`
- Create: `test/unit/category-scope.test.mjs`

**Interfaces:**
- Consumes: normalized Category Profile and explicit pool version ID.
- Produces: `membershipScopePredicate(profile,{alias})` with SQL and ordered parameters.
- Produces: `resolveMembershipCandidates(db,{profile,poolVersionId,productId,activeOnly})` returning `{membershipIds,uniquelyResolved,unresolved,ambiguous}` or throwing a coded scope error.

- [ ] **Step 1: Write failing resolver tests for unique, unresolved, ambiguous, and new-category denial**

```js
test('legacy Motorcycle membership resolves only with pool identity and exact full scope',() => {
  const result=resolveMembershipCandidates(db,{profile:motorcycle,poolVersionId:'pool-a',productId:1,activeOnly:true});
  assert.deepEqual(result.membershipIds,[11]);
  assert.equal(result.uniquelyResolved,1);
});

test('new category cannot consume a null-key Motorcycle membership',() => {
  assert.throws(() => resolveMembershipCandidates(db,{profile:categoryB,poolVersionId:'pool-b',productId:1}),
    error => error.code==='CATEGORY_SCOPE_UNRESOLVED');
});
```

- [ ] **Step 2: Run the resolver test and verify RED**

Run: `node --test test/unit/category-scope.test.mjs`

Expected: FAIL because `category-scope.mjs` does not exist.

- [ ] **Step 3: Implement strict resolution**

```js
export function resolveMembershipCandidates(db,{profile,poolVersionId,productId,activeOnly=false}) {
  assertPoolOwnership(db,poolVersionId,profile.category_key,profile.category_profile_version);
  const keyed=selectKeyedMemberships(db,profile,productId,activeOnly);
  if (keyed.length===1) return audit(keyed,0,0);
  if (keyed.length>1) throw scopeError('CATEGORY_SCOPE_AMBIGUOUS',keyed);
  if (profile.category_key!=='motorcycle-accessories') throw scopeError('CATEGORY_SCOPE_UNRESOLVED',[]);
  const legacy=selectExactLegacyMembershipsInPool(db,profile,poolVersionId,productId,activeOnly);
  if (legacy.length===1) return audit(legacy,1,0);
  throw scopeError(legacy.length ? 'CATEGORY_SCOPE_AMBIGUOUS':'CATEGORY_SCOPE_UNRESOLVED',legacy);
}
```

The implementation must contain no `UPDATE` statement and no global active-membership fallback.

- [ ] **Step 4: Run the resolver test and verify GREEN**

Run: `node --test test/unit/category-scope.test.mjs`

Expected: PASS for all four legacy scenarios.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/modules/catalog-scale/category-scope.mjs test/unit/category-scope.test.mjs
git commit -m "feat: resolve category memberships safely"
```

### Task 3: Enforce explicit Campaign creation and resume selection

**Files:**
- Create: `src/modules/catalog-scale/campaign-selection.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `tools/catalog-full-refresh-admin.mjs`
- Modify: `tools/catalog-manual-passive-admin.mjs`
- Modify: `tools/catalog-expansion-admin.mjs`
- Create: `test/integration/catalog-multi-category-resume.test.mjs`

**Interfaces:**
- Produces: `validateResumeCampaign(service,{campaignId,profile,campaignType})`.
- Campaign creation freezes the normalized profile and resolved bindings in `config_json`.
- Admin `create` without `--resume-campaign` creates a new ID; resume paths require the explicit option.

- [ ] **Step 1: Write failing Campaign/checkpoint isolation tests**

```js
test('same mode and target never select another category campaign',() => {
  const a=service.createCampaign({name:'a',campaignType:'refresh',profile:aProfile,targetCount:2000});
  seedCheckpoint(db,a.id,1208);
  const b=service.createCampaign({name:'b',campaignType:'refresh',profile:bProfile,targetCount:2000});
  assert.notEqual(a.id,b.id);
  assert.equal(service.getStatus(b.id).campaign.nonElectronicUniqueCount,0);
});

test('resume rejects wrong category before checkpoint access',() => {
  assert.throws(() => validateResumeCampaign(service,{campaignId:a.id,profile:bProfile,campaignType:'refresh'}),
    error => error.code==='CAMPAIGN_CATEGORY_MISMATCH');
});
```

- [ ] **Step 2: Run the Campaign test and verify RED**

Run: `node --test test/integration/catalog-multi-category-resume.test.mjs`

Expected: FAIL because explicit selection validation is absent and admin implicit finders remain.

- [ ] **Step 3: Implement Campaign validation and remove implicit finders**

```js
export function validateResumeCampaign(service,{campaignId,profile,campaignType}) {
  if (!campaignId) throw coded('CAMPAIGN_RESUME_ID_REQUIRED','Resume 必须显式提供 campaign_id。');
  const campaign=service.getCampaign(campaignId);
  if (campaign.categoryKey!==profile.category_key) throw coded('CAMPAIGN_CATEGORY_MISMATCH','Campaign category 不匹配。');
  if (campaign.categoryProfileVersion!==profile.category_profile_version) throw coded('CAMPAIGN_PROFILE_VERSION_MISMATCH','Campaign profile 不匹配。');
  if (campaign.campaignType!==campaignType) throw coded('CAMPAIGN_TYPE_MISMATCH','Campaign type 不匹配。');
  return campaign;
}
```

Delete calls to `findLatest`, `findManualCampaignId`, and global unfinished-Expansion selection. Ensure validation occurs before status/checkpoint/queue reads that influence execution.

- [ ] **Step 4: Run Campaign tests and affected admin syntax checks**

Run: `node --test test/integration/catalog-multi-category-resume.test.mjs test/integration/catalog-resume.test.mjs`

Run: `node --check tools/catalog-full-refresh-admin.mjs && node --check tools/catalog-manual-passive-admin.mjs && node --check tools/catalog-expansion-admin.mjs`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/modules/catalog-scale/campaign-selection.mjs src/modules/catalog-scale/catalog-campaign-service.mjs tools/catalog-full-refresh-admin.mjs tools/catalog-manual-passive-admin.mjs tools/catalog-expansion-admin.mjs test/integration/catalog-multi-category-resume.test.mjs test/integration/catalog-resume.test.mjs
git commit -m "fix: require explicit campaign resume"
```

### Task 4: Isolate materialization, baseline, reconciliation, and activation

**Files:**
- Modify: `src/db/repositories/catalog-campaign-repository.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Create: `test/integration/catalog-multi-category-isolation.test.mjs`
- Modify: `test/integration/catalog-refresh.test.mjs`
- Modify: `test/integration/catalog-expansion.test.mjs`

**Interfaces:**
- Repository methods receive the frozen Category Profile or resolved scope.
- `getBaselineConsistency(categoryKey)` resolves exactly one category active pool.
- `activatePoolVersion(campaign)` mutates only membership IDs validated for that category.

- [ ] **Step 1: Write the failing 12-scenario temporary-SQLite integration fixture**

```js
test('shared goods identity has two memberships and Category B activation leaves A active',async t => {
  const {db,service,a,b}=await twoCategoryFixture(t);
  materialize(service,a,'SAME001');
  const beforeA=db.prepare("SELECT * FROM catalog_memberships WHERE category_key='category-a'").get();
  materialize(service,b,'SAME001');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM products WHERE external_product_id='SAME001'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_memberships WHERE product_id=(SELECT id FROM products WHERE external_product_id='SAME001')").get().n,2);
  activate(service,b);
  assert.equal(db.prepare("SELECT active FROM catalog_memberships WHERE category_key='category-a'").get().active,1);
  assert.deepEqual(db.prepare("SELECT * FROM catalog_memberships WHERE category_key='category-a'").get(),beforeA);
});
```

- [ ] **Step 2: Run the isolation test and verify RED**

Run: `node --test test/integration/catalog-multi-category-isolation.test.mjs`

Expected: FAIL because materialization selects by product ID and activation globally deactivates memberships.

- [ ] **Step 3: Replace product-only and global-active SQL with scoped resolution**

```js
const resolved=resolveMembershipCandidates(db,{profile:campaign.config.categoryProfile,
  poolVersionId:campaign.baselinePoolVersionId ?? targetPool.id,productId:product.id});
const membershipId=resolved.membershipIds[0] ?? insertScopedMembership(product.id,campaign,staging);
```

Every deactivate statement must constrain `category_key=?` or use validated IDs from the resolver. Baseline capture must select from the explicit category pool, never from all active memberships.

- [ ] **Step 4: Run isolation, refresh, expansion, migration, and persistence tests**

Run: `node --test test/integration/catalog-multi-category-isolation.test.mjs test/integration/catalog-refresh.test.mjs test/integration/catalog-expansion.test.mjs test/integration/catalog-persistence.test.mjs test/integration/migrations.test.mjs`

Expected: PASS, including two simultaneous active pools and unchanged Category A row comparison.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/db/repositories/catalog-campaign-repository.mjs src/modules/catalog-scale/catalog-campaign-service.mjs test/integration/catalog-multi-category-isolation.test.mjs test/integration/catalog-refresh.test.mjs test/integration/catalog-expansion.test.mjs
git commit -m "fix: scope catalog pools by category"
```

### Task 5: Scope classification inputs and enforce taxonomy gates

**Files:**
- Modify: `src/db/repositories/classification-repository.mjs`
- Modify: `src/app/commands/classify.mjs`
- Modify: `src/modules/products/fine-classification-service.mjs`
- Modify: `src/db/repositories/analysis-repository.mjs`
- Modify: `src/modules/opportunity/opportunity-analysis-service.mjs`
- Create: `test/integration/classification-multi-category.test.mjs`

**Interfaces:**
- `listPoolProducts({poolVersionId,categoryKey})` replaces global `listActiveProducts()` for formal classification.
- `assertTaxonomyBinding({profile,pipeline,taxonomyName,taxonomyVersion,ruleVersion})` hard-fails before classification writes.

- [ ] **Step 1: Write failing classification and binding tests**

```js
test('Category B classification input excludes Category A-only products',() => {
  assert.deepEqual(repository.listPoolProducts({poolVersionId:'pool-b',categoryKey:'category-b'}).map(x=>x.goods_id),['B001','SAME001']);
});

test('Category B rejects Motorcycle taxonomy before replacing rows',() => {
  assert.throws(() => assertTaxonomyBinding({profile:bProfile,pipeline:'classify',taxonomyName:'week1-motorcycle-accessories',taxonomyVersion:null,ruleVersion:'week1-rule-v1'}),
    error => error.code==='TAXONOMY_BINDING_MISMATCH');
});
```

- [ ] **Step 2: Run the classification test and verify RED**

Run: `node --test test/integration/classification-multi-category.test.mjs`

Expected: FAIL because repository input is global and no binding gate exists.

- [ ] **Step 3: Implement pool-scoped inputs for classify, fine-classify, and Opportunity**

```js
export function assertTaxonomyBinding({profile,pipeline,taxonomyName,taxonomyVersion,ruleVersion}) {
  const expected=resolveTaxonomyBinding(profile,pipeline);
  if (expected.categoryScope!==profile.category_key) throw coded('TAXONOMY_CATEGORY_SCOPE_MISMATCH','taxonomy category scope 不匹配。');
  if (expected.taxonomyName!==taxonomyName || expected.taxonomyVersion!==taxonomyVersion || expected.ruleVersion!==ruleVersion)
    throw coded('TAXONOMY_BINDING_MISMATCH','taxonomy binding 不匹配。');
  return expected;
}
```

Require `poolVersionId` or category key resolving to one pool. Preserve existing taxonomy rule content.

- [ ] **Step 4: Run classification regressions**

Run: `node --test test/integration/classification-multi-category.test.mjs test/integration/classification.test.mjs test/integration/fine-classification-idempotence.test.mjs test/unit/fine-classification.test.mjs test/unit/opportunity-analysis.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/db/repositories/classification-repository.mjs src/app/commands/classify.mjs src/modules/products/fine-classification-service.mjs src/db/repositories/analysis-repository.mjs src/modules/opportunity/opportunity-analysis-service.mjs test/integration/classification-multi-category.test.mjs
git commit -m "fix: scope classification by pool"
```

### Task 6: Scope Operations/Opportunity Excel and preserve snapshot versions

**Files:**
- Modify: `src/db/repositories/report-repository.mjs`
- Modify: `src/modules/export/export-service.mjs`
- Modify: `src/modules/opportunity/opportunity-workbook.mjs`
- Modify: `tools/opportunity-analysis-admin.mjs`
- Create: `test/integration/export-multi-category.test.mjs`
- Modify: `test/unit/opportunity-v2.test.mjs`

**Interfaces:**
- Operations export requires `{poolVersionId,categoryKey}`.
- Opportunity `status`, `reanalyze`, and `excel` require `--snapshot`.
- Workbook metadata reads `snapshot.config.taxonomyVersion` and `snapshot.config.ruleVersion` verbatim.

- [ ] **Step 1: Write failing export-scope and legacy-version tests**

```js
test('Category B Operations rows exclude Category A-only goods',() => {
  assert.deepEqual(report.listProducts({poolVersionId:'pool-b',categoryKey:'category-b'}).map(x=>x.goods_id),['B001','SAME001']);
});

test('Opportunity workbook reports frozen v1 instead of current v2',async () => {
  const model=buildOpportunityWorkbookModel({snapshot:{config:{taxonomyVersion:'motorcycle-opportunity-v1',ruleVersion:'active-pool-rule-v2'}}});
  assert.equal(model.metadata.taxonomyVersion,'motorcycle-opportunity-v1');
});
```

- [ ] **Step 2: Run export tests and verify RED**

Run: `node --test test/integration/export-multi-category.test.mjs test/unit/opportunity-v2.test.mjs`

Expected: FAIL because Operations rows are global and workbook taxonomy is hardcoded.

- [ ] **Step 3: Implement explicit pool/snapshot inputs and truthful metadata**

```js
const taxonomyVersion=snapshot.config?.taxonomyVersion ?? null;
const ruleVersion=snapshot.config?.ruleVersion ?? null;
```

Remove global latest-snapshot fallback from formal admin actions and reject missing IDs with `SNAPSHOT_ID_REQUIRED`.

- [ ] **Step 4: Run export and Opportunity regressions**

Run: `node --test test/integration/export-multi-category.test.mjs test/integration/export.test.mjs test/unit/opportunity-analysis.test.mjs test/unit/opportunity-v2.test.mjs test/unit/opportunity-v21.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/db/repositories/report-repository.mjs src/modules/export/export-service.mjs src/modules/opportunity/opportunity-workbook.mjs tools/opportunity-analysis-admin.mjs test/integration/export-multi-category.test.mjs test/unit/opportunity-v2.test.mjs
git commit -m "fix: scope exports and snapshot metadata"
```

### Task 7: Implement MANUAL_BIND_PASSIVE_CAPTURE detection and binding contract

**Files:**
- Create: `browser-extension/catalog-manual-binding.js`
- Modify: `browser-extension/catalog-manual-passive-runner.js`
- Modify: `browser-extension/catalog-capture.js`
- Modify: `browser-extension/content-script.js`
- Modify: `browser-extension/manifest.json`
- Modify: `test/unit/catalog-manual-passive-runner.test.mjs`
- Create: `test/unit/catalog-manual-binding.test.mjs`

**Interfaces:**
- `detectCurrentPage({profile,domEvidence,networkEvidence})` is pure and returns a Page Health result plus fingerprint.
- `bindDetectedPage({detection,campaign,profile,sourceId,now})` returns an ephemeral binding.
- `validateBindingForCapture({binding,detection,campaign,profile})` returns the valid binding or throws before submit.
- `manualBatchId({campaignId,sourceId,bindingGeneration,contextFingerprint,contentFingerprint})` is deterministic.

- [ ] **Step 1: Write failing detect/bind/invalidate/idempotence tests**

```js
test('detection is separate from binding and unbound capture never submits',async () => {
  const detection=detectCurrentPage(healthyEvidence);
  assert.equal(detection.health.status,'READY');
  assert.equal(harness.submits,0);
  await assert.rejects(() => runner.captureCurrentPage(),error => error.code==='PAGE_BINDING_REQUIRED');
  assert.equal(harness.submits,0);
});

test('context changes invalidate binding',() => {
  assert.throws(() => validateBindingForCapture({binding,detection:{...detection,currency:'USD'},campaign,profile}),
    error => error.code==='PAGE_CONTEXT_LOST');
});
```

- [ ] **Step 2: Run manual unit tests and verify RED**

Run: `node --test test/unit/catalog-manual-binding.test.mjs test/unit/catalog-manual-passive-runner.test.mjs`

Expected: FAIL because the binding module and explicit manual click capture do not exist.

- [ ] **Step 3: Implement pure detection, ephemeral binding, and manual-only capture**

```js
export function validateBindingForCapture({binding,detection,campaign,profile}) {
  if (!binding) throw coded('PAGE_BINDING_REQUIRED','必须先检测并绑定当前页面。');
  if (binding.campaignId!==campaign.id || binding.categoryKey!==profile.category_key ||
      binding.contextFingerprint!==detection.contextFingerprint) throw coded('PAGE_CONTEXT_LOST','页面上下文变化，绑定已失效。');
  return binding;
}
```

Do not call `setInterval`, `.click()`, `scrollTo`, navigation APIs, or CAPTCHA actions from the new mode. Keep the old mode name only as an input alias.

- [ ] **Step 4: Run manual and extension unit tests**

Run: `node --test test/unit/catalog-manual-binding.test.mjs test/unit/catalog-manual-passive-runner.test.mjs test/unit/browser-extension.test.mjs`

Expected: PASS, including source assertions that automatic behavior is absent.

- [ ] **Step 5: Commit Task 7**

```bash
git add browser-extension/catalog-manual-binding.js browser-extension/catalog-manual-passive-runner.js browser-extension/catalog-capture.js browser-extension/content-script.js browser-extension/manifest.json test/unit/catalog-manual-binding.test.mjs test/unit/catalog-manual-passive-runner.test.mjs
git commit -m "feat: require operator-bound passive capture"
```

### Task 8: Add dynamic operator UI and server-side zero-write/idempotence gates

**Files:**
- Modify: `browser-extension/popup.html`
- Modify: `browser-extension/popup.js`
- Modify: `browser-extension/background.js`
- Modify: `src/server/controllers/catalog-controller.mjs`
- Modify: `src/server/router.mjs`
- Modify: `test/unit/browser-extension.test.mjs`
- Create: `test/integration/catalog-manual-binding.test.mjs`

**Interfaces:**
- UI renders binding snapshot fields without fixed Motorcycle labels.
- UI reserves a disabled-until-scoped `导出影刀任务` action carrying `{categoryKey,poolVersionId}` without implementing export.
- Server capture endpoint requires a validated binding envelope and deterministic batch ID.
- Existing batch uniqueness and payload hash provide database idempotence.

- [ ] **Step 1: Write failing UI and zero-write integration tests**

```js
test('unbound capture is rejected with zero database writes',async t => {
  const before=tableCounts(app.db);
  const response=await post('/api/catalog/manual-capture',{campaignId:'campaign-b',cards:[card('B001')]});
  assert.equal(response.status,400);
  assert.equal(response.body.error.code,'PAGE_BINDING_REQUIRED');
  assert.deepEqual(tableCounts(app.db),before);
});

test('same manual content is idempotent',async () => {
  await postBoundCapture(payload);
  const afterFirst=tableCounts(app.db);
  await postBoundCapture(payload);
  assert.deepEqual(tableCounts(app.db),afterFirst);
});
```

- [ ] **Step 2: Run UI/integration tests and verify RED**

Run: `node --test test/unit/browser-extension.test.mjs test/integration/catalog-manual-binding.test.mjs`

Expected: FAIL because dynamic fields and binding envelope validation are absent.

- [ ] **Step 3: Implement dynamic rendering and pre-write validation**

```js
renderManualState({category:profile.displayName,campaign:campaign.id,profile:campaign.categoryProfileVersion,
  pageHealth:detection.health.code,bindStatus:binding?.status ?? 'UNBOUND',target:campaign.targetCount,
  uniqueProgress:campaign.nonElectronicUniqueCount,newCount:audit.acceptedGoods,duplicateCount:audit.campaignStagingDeduped,
  failedCount:audit.failed,errorStatus:error?.code ?? null});
```

Validate the binding envelope before calling `captureExtensionBatch`. Remove fixed operational Motorcycle/Germany/Top Sales labels from current-state UI.

Add the YingDao seam as a UI event payload only. Do not create XLSX/images, compute `source_image_path`, or access SQLite from the seam.

- [ ] **Step 4: Run browser extension and catalog API regressions**

Run: `node --test test/unit/browser-extension.test.mjs test/integration/catalog-manual-binding.test.mjs test/integration/catalog-api.test.mjs test/integration/browser-extension.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add browser-extension/popup.html browser-extension/popup.js browser-extension/background.js src/server/controllers/catalog-controller.mjs src/server/router.mjs test/unit/browser-extension.test.mjs test/integration/catalog-manual-binding.test.mjs
git commit -m "feat: expose safe manual capture state"
```

### Task 9: Run full verification and production read-only QA

**Files:**
- Create: `scripts/verify-multi-category-readonly.mjs`
- Modify: `package.json`
- Create: `test/unit/multi-category-readonly-qa.test.mjs`
- Create: `docs/superpowers/verification/2026-08-31-multi-category-safety-foundation-v1.md`

**Interfaces:**
- `npm run qa:multi-category:readonly` opens `config.app.databasePath` with `{readOnly:true}` and prints stable JSON.
- The script records both legacy counts and exact protected Campaign/pool state.

- [ ] **Step 1: Write a failing read-only QA contract test**

```js
test('production QA script uses readOnly connection and reports protected counters',() => {
  const source=fs.readFileSync(scriptPath,'utf8');
  assert.match(source,/openDatabase\(.+\{\s*readOnly:true\s*\}/s);
  for (const key of ['integrityCheck','foreignKeyViolations','LEGACY_MEMBERSHIP_NULL_CATEGORY_KEY','LEGACY_ACTIVE_MEMBERSHIP_NULL_CATEGORY_KEY','protectedCampaign']) assert.match(source,new RegExp(key));
  assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test test/unit/multi-category-readonly-qa.test.mjs`

Expected: FAIL because the QA script does not exist.

- [ ] **Step 3: Implement read-only JSON QA**

```js
const db=openDatabase(config.app.databasePath,{readOnly:true});
const result={integrityCheck:db.prepare('PRAGMA integrity_check').get().integrity_check,
  foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length,
  LEGACY_MEMBERSHIP_NULL_CATEGORY_KEY:Number(db.prepare('SELECT COUNT(*) n FROM catalog_memberships WHERE category_key IS NULL').get().n),
  LEGACY_ACTIVE_MEMBERSHIP_NULL_CATEGORY_KEY:Number(db.prepare('SELECT COUNT(*) n FROM catalog_memberships WHERE category_key IS NULL AND active=1').get().n)};
```

- [ ] **Step 4: Run syntax, focused suites, full suite, and read-only before/after comparison**

Run: `npm run check`

Run: `npm run check:opportunity`

Run: `npm test`

Run twice: `npm run qa:multi-category:readonly -- --config config.json`

Expected: all commands exit 0; both QA JSON outputs are identical; integrity is `ok`; foreign-key violations are `0`; null-key counts remain `452` and `220`; the 2135 active pool and paused 1208/2000 Campaign are unchanged.

- [ ] **Step 5: Record verification evidence and commit Task 9**

```bash
git add scripts/verify-multi-category-readonly.mjs test/unit/multi-category-readonly-qa.test.mjs package.json docs/superpowers/verification/2026-08-31-multi-category-safety-foundation-v1.md
git commit -m "test: verify multi-category safety foundation"
```

- [ ] **Step 6: Produce independent final gates**

Report `SAFE_FOR_SECOND_CATEGORY_10_ROW_DRY_RUN = YES` only when Tasks 1–6 and production read-only QA pass. Report `SAFE_FOR_OPERATOR_MANUAL_CAPTURE = YES` only when Tasks 7–8 and production read-only QA pass. Any failed assertion makes its gate `NO` with the exact blocker.
