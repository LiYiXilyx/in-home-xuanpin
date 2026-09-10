# Temu New Category Onboarding & Scoped Export V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator register a capture-only Temu Category, create an open-ended Initial Campaign, reuse Manual Bind capture and Initial Pool QA/activation, and export strictly scoped preview/formal Excel workbooks without CLI or per-category code changes.

**Architecture:** Extend the existing Catalog module with a two-source reloadable Profile Registry and an atomic operator profile store outside Git. Preserve the existing Initial Campaign, Manual Bind, QA, and activation services; add explicit capture-only capability semantics and two read-only scoped export paths. Shared UI and router changes remain Catalog-only and leave all YingDao business files untouched.

**Tech Stack:** Node.js ESM, `node:sqlite`, existing HTTP router/controllers, browser-extension Manual Bind runner, Artifact Tool Excel generation, Node test runner, temporary SQLite/profile/export fixtures.

**Spec:** `docs/superpowers/specs/2026-09-02-new-category-onboarding-scoped-export-v1-design.md`

## Global Constraints

- Base commit is `dd98a6ee635718f72e38ccbfea6f514b0e0846a8`.
- Fixed market contract is DE / English / EUR / Top Sales.
- Capture mode is `MANUAL_BIND_PASSIVE_CAPTURE`; quantity mode is `OPEN_ENDED`.
- Product identity remains `platform + goods_id`.
- Operator profiles live below `<dirname(TEMU_CONFIG_PATH)>/data/operator-category-profiles/`, never in Git.
- Capture-only taxonomy and Opportunity are explicitly `UNCONFIGURED`; Motorcycle fallback is forbidden.
- No automatic navigation, scrolling, See more, CAPTCHA handling, capture, QA, activation, or Pool selection.
- No global/latest Campaign, membership, Pool, candidate, or export fallback.
- All write tests use temporary directories and SQLite fixtures.
- Do not change `ui/modules/yingdao/*`, `ui/sourcing-review*`, `src/modules/sourcing/*`, sourcing routes/controllers, Random5, Review, Visual Index, or supplier cache.
- Every Task follows RED → minimal GREEN → focused regression → `git diff --check` → commit → normal feature branch push.
- Full suite may retain only the approved exact seven failures; no new failure is allowed.

## File structure

- Create `src/modules/catalog-scale/operator-category-profile.mjs`: normalize operator input, generate deterministic identity, produce capture-only schema.
- Create `src/modules/catalog-scale/operator-category-profile-store.mjs`: safe root validation, idempotency, atomic persistence.
- Modify `src/modules/catalog-scale/category-profile.mjs`: validate both legacy ruled and schema-v2 capture-only profiles.
- Modify `src/modules/catalog-scale/category-profile-registry.mjs`: scan built-in and operator sources with origin metadata and duplicate protection.
- Modify `src/modules/catalog-scale/taxonomy-pipeline-capability.mjs`: block unconfigured capture-only pipelines.
- Modify `src/modules/catalog-scale/initial-pool-qa.mjs`: split universal and explicitly enabled category policy gates.
- Create `src/db/repositories/catalog-scoped-export-repository.mjs`: exact Campaign revision and Pool tuple reads.
- Create `src/modules/catalog-scale/catalog-scoped-export-service.mjs`: build/save preview and formal workbooks.
- Modify `src/server/controllers/catalog-controller.mjs`, `src/server/router.mjs`, `src/server/index.mjs`: Catalog-only route registration and dependency composition.
- Modify `ui/modules/catalog/{state,model,api,panel,catalog.css}.js`: onboarding and export UI within Catalog root.
- Modify `browser-extension/catalog-manual-binding.js`: consume aliases, breadcrumbs, and normalized listing path from the selected Profile.
- Add focused unit/integration fixtures and one final delivery manifest/verification script.

---

### Task 1: Characterize Registry, QA, Manual Bind, and Export Boundaries

**Files:**
- Create: `docs/superpowers/audits/2026-09-02-new-category-onboarding-boundary-audit.md`
- Create: `test/unit/new-category-boundary-characterization.test.mjs`
- Test: existing Category Profile, Initial QA, Manual Bind, export, and Catalog/YingDao isolation tests

**Interfaces:**
- Consumes: current `createCategoryProfileRegistry`, `validateCategoryProfile`, `evaluateInitialPoolQa`, Manual Bind profile projection, and export repositories.
- Produces: executable characterization of the exact seams Tasks 2–8 may change and an audit that maps Motorcycle-only versus universal rules.

- [ ] **Step 1: Write failing boundary characterization**

Add assertions that the current single-directory registry lacks operator-source metadata, current ruled validator rejects a capture-only profile, current QA contains Motorcycle policy in its mandatory result, and no Campaign-revision/formal-Pool export API exists. The test must fail for those explicit missing contracts, not for unrelated implementation text.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test test/unit/new-category-boundary-characterization.test.mjs
```

Expected: FAIL because the new boundary audit contract is not yet published.

- [ ] **Step 3: Add minimal executable audit contract**

Record:

```js
export const NEW_CATEGORY_BOUNDARIES = Object.freeze({
  profileSources:['BUILT_IN','OPERATOR_MANAGED'],
  universalQa:true,
  manualBindMode:'MANUAL_BIND_PASSIVE_CAPTURE',
  previewScope:['campaign_id','candidate_revision'],
  formalScope:['category_key','category_profile_version','pool_version_id'],
});
```

The audit document lists exact current files/functions and prohibits a second capture/QA/export stack.

- [ ] **Step 4: Run GREEN and related regression**

```bash
node --test test/unit/new-category-boundary-characterization.test.mjs test/unit/category-profile-registry.test.mjs test/unit/initial-pool-qa.test.mjs test/unit/catalog-manual-binding.test.mjs test/integration/export-multi-category.test.mjs test/unit/yingdao-catalog-isolation.test.mjs
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add docs/superpowers/audits/2026-09-02-new-category-onboarding-boundary-audit.md test/unit/new-category-boundary-characterization.test.mjs
git commit -m "test: characterize new category onboarding boundaries"
git push origin codex/new-category-onboarding-v1
```

### Task 2: Operator Profile Store and Atomic Persistence

**Files:**
- Create: `src/modules/catalog-scale/operator-category-profile-store.mjs`
- Create: `test/unit/operator-category-profile-store.test.mjs`

**Interfaces:**
- Consumes: `normalizeOperatorCategoryProfile(input)` from Task 3 is initially injected as `validateInput` to preserve Task order.
- Produces: `createOperatorCategoryProfileStore({root,builtInRegistry,validateInput})` with `validate(input)` and `register({requestId,...input})`.

- [ ] **Step 1: Write RED tests**

Test temporary directories for:

```js
const store=createOperatorCategoryProfileStore({root,builtInRegistry,validateInput});
const first=await store.register({requestId:'request-1',...input});
const replay=await store.register({requestId:'request-1',...input});
assert.equal(replay.idempotentReplay,true);
```

Also assert atomic temp cleanup, canonical bytes, deterministic filename, changed-request conflict, built-in identity conflict, traversal rejection, symlink-root/path rejection, and no write from `validate()`.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/operator-category-profile-store.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement minimal safe store**

Use `fs.open(...,'wx')`, write/sync/close, and `fs.rename`. Resolve every existing parent with `realpath`, reject symlinks with `lstat`, require the generated final path to remain within the canonical root, and store request receipts under a private `.requests` subdirectory using the same atomic pattern.

- [ ] **Step 4: Run GREEN and filesystem regressions**

```bash
node --test test/unit/operator-category-profile-store.test.mjs test/unit/category-profile-registry.test.mjs test/unit/sourcing-settings.test.mjs
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add src/modules/catalog-scale/operator-category-profile-store.mjs test/unit/operator-category-profile-store.test.mjs
git commit -m "feat: persist operator category profiles atomically"
git push origin codex/new-category-onboarding-v1
```

### Task 3: Capture-only Profile Schema, Registry Sources, and Capabilities

**Files:**
- Create: `src/modules/catalog-scale/operator-category-profile.mjs`
- Modify: `src/modules/catalog-scale/category-profile.mjs`
- Modify: `src/modules/catalog-scale/category-profile-registry.mjs`
- Modify: `src/modules/catalog-scale/taxonomy-pipeline-capability.mjs`
- Modify: `src/modules/catalog-scale/initial-pool-qa.mjs`
- Test: `test/unit/operator-category-profile.test.mjs`
- Test: `test/unit/category-profile-registry.test.mjs`
- Test: `test/unit/initial-pool-qa.test.mjs`

**Interfaces:**
- Produces: `normalizeOperatorCategoryProfile(input)`, `validateOperatorCategoryDraft(input)`, `createCategoryProfileRegistry({builtInDirectory,operatorDirectory})`, and capture-only capability projection.
- Capture-only pipeline calls throw `CATEGORY_TAXONOMY_UNCONFIGURED`.

- [ ] **Step 1: Write RED tests**

Assert server-fixed market/capture fields, deterministic key/version, Unicode-without-Latin-alias rejection, explicit taxonomy status, no Motorcycle rules, two-source reload without restart, built-in precedence, cross-source duplicate hard failure, and capture-only QA result:

```js
assert.equal(result.categorySpecificPolicy.status,'NOT_CONFIGURED');
assert.equal(result.rawPoolActivationAllowed,true);
```

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/operator-category-profile.test.mjs test/unit/category-profile-registry.test.mjs test/unit/initial-pool-qa.test.mjs
```

- [ ] **Step 3: Implement minimal dual-schema validator and registry**

Route schema-v2 capture-only input to its validator before legacy ruled validation. Preserve built-in JSON behavior and infer `profile_origin:'BUILT_IN'` in memory. Registry returns sorted profiles by category key/version and rescans both roots on every call.

- [ ] **Step 4: Run GREEN and taxonomy/Motorcycle regressions**

```bash
node --test test/unit/operator-category-profile.test.mjs test/unit/category-profile-registry.test.mjs test/unit/category-profile.test.mjs test/unit/taxonomy-pipeline-capability.test.mjs test/unit/initial-pool-qa.test.mjs test/integration/classification-multi-category.test.mjs test/integration/initial-pool-qa.test.mjs
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add src/modules/catalog-scale/operator-category-profile.mjs src/modules/catalog-scale/category-profile.mjs src/modules/catalog-scale/category-profile-registry.mjs src/modules/catalog-scale/taxonomy-pipeline-capability.mjs src/modules/catalog-scale/initial-pool-qa.mjs test/unit/operator-category-profile.test.mjs test/unit/category-profile-registry.test.mjs test/unit/initial-pool-qa.test.mjs
git commit -m "feat: support capture-only operator category profiles"
git push origin codex/new-category-onboarding-v1
```

### Task 4: Validate/Register Profile APIs

**Files:**
- Modify: `src/server/index.mjs`
- Modify: `src/server/controllers/catalog-controller.mjs`
- Modify: `src/server/router.mjs`
- Test: `test/integration/operator-category-profile-api.test.mjs`

**Interfaces:**
- Produces: `POST /api/catalog/operator/category-profiles/validate` and `POST /api/catalog/operator/category-profiles`.
- Controller receives `operatorCategoryProfileStore`; server derives operator root from `config.configPath`.

- [ ] **Step 1: Write RED API tests**

Start the server with temporary config/profile/database roots. Fingerprint filesystem and SQLite before validation, then assert exact zero-write behavior. Test register/replay/conflict, generated field override rejection, built-in conflict, registry immediate visibility, and malformed body/route method rejection.

- [ ] **Step 2: Run RED**

```bash
node --test test/integration/operator-category-profile-api.test.mjs
```

Expected: 404 for both new endpoints.

- [ ] **Step 3: Implement minimal Catalog routes**

Add controller methods and exact POST route registration. Derive:

```js
const operatorProfileDirectory=path.join(path.dirname(config.configPath),'data/operator-category-profiles');
```

Use injected test overrides; do not change sourcing composition.

- [ ] **Step 4: Run GREEN and server/YingDao regressions**

```bash
node --test test/integration/operator-category-profile-api.test.mjs test/integration/operator-campaign-api.test.mjs test/integration/initial-pool-api.test.mjs test/integration/server-sourcing.test.mjs test/unit/yingdao-catalog-read-boundary.test.mjs
npm run check
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add src/server/index.mjs src/server/controllers/catalog-controller.mjs src/server/router.mjs test/integration/operator-category-profile-api.test.mjs
git commit -m "feat: expose operator category profile APIs"
git push origin codex/new-category-onboarding-v1
```

### Task 5: Catalog Add-new-category UI

**Files:**
- Modify: `ui/modules/catalog/state.js`
- Modify: `ui/modules/catalog/model.js`
- Modify: `ui/modules/catalog/api.js`
- Modify: `ui/modules/catalog/panel.js`
- Modify: `ui/modules/catalog/catalog.css`
- Modify: `test/fixtures/catalog-panel-dom-fixture.mjs`
- Test: `test/unit/catalog-new-category-panel.test.mjs`

**Interfaces:**
- Produces Catalog-owned onboarding state, validation rendering, and explicit `openListingUrl()` click action.
- Consumes Task 4 API responses; no YingDao event is required for correctness.

- [ ] **Step 1: Write RED UI tests**

Assert all editable/read-only fields and Catalog namespace, validation-only request, generated identity/capability rendering, no automatic `window.open`, one explicit click open, errors confined to Catalog root, and YingDao root/state/controls unchanged through loading/error/destroy.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-new-category-panel.test.mjs test/unit/catalog-dual-module-isolation.test.mjs
```

- [ ] **Step 3: Implement minimal local panel state and rendering**

Extend `catalogState` with `onboarding:{open,draft,validation,registered,profileSaved,campaignCreated}` and matching loading fields. The API client exposes only Catalog endpoints. Render via the supplied root only.

- [ ] **Step 4: Run GREEN and Catalog/YingDao UI regression**

```bash
node --test test/unit/catalog-new-category-panel.test.mjs test/unit/catalog-panel.test.mjs test/unit/catalog-state-model-api.test.mjs test/unit/catalog-polling-isolation.test.mjs test/unit/catalog-dual-module-isolation.test.mjs test/unit/yingdao-app-shell.test.mjs test/unit/yingdao-panel.test.mjs
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add ui/modules/catalog test/fixtures/catalog-panel-dom-fixture.mjs test/unit/catalog-new-category-panel.test.mjs
git commit -m "feat: add Catalog new category onboarding panel"
git push origin codex/new-category-onboarding-v1
```

### Task 6: Save Profile and Create OPEN_ENDED Initial Campaign

**Files:**
- Modify: `ui/modules/catalog/model.js`
- Modify: `ui/modules/catalog/panel.js`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Test: `test/unit/catalog-new-category-create-flow.test.mjs`
- Test: `test/integration/operator-new-category-initial.test.mjs`

**Interfaces:**
- Produces a sequential register → reload → select → existing Initial API flow with independent Profile and Campaign request ids.
- Failure after registration retains the profile and exposes retry without re-registration.

- [ ] **Step 1: Write RED flow tests**

Assert call order, new profile selection, Initial public quantities all `null`, current unique zero, UNBOUND, profile-saved/Campaign-failed conflict rendering, retry reuse, and no compensation delete.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-new-category-create-flow.test.mjs test/integration/operator-new-category-initial.test.mjs
```

- [ ] **Step 3: Implement minimal orchestration**

Keep profile and Campaign request ids stable for their own logical operations. After register response, refresh profile list before calling the existing Initial endpoint. Never treat Profile replay as Campaign resume.

- [ ] **Step 4: Run GREEN and Initial regressions**

```bash
node --test test/unit/catalog-new-category-create-flow.test.mjs test/integration/operator-new-category-initial.test.mjs test/unit/catalog-panel.test.mjs test/integration/initial-campaign-create.test.mjs test/integration/operator-campaign-api.test.mjs test/unit/campaign-quantity-policy.test.mjs
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add ui/modules/catalog/model.js ui/modules/catalog/panel.js src/modules/catalog-scale/catalog-campaign-service.mjs test/unit/catalog-new-category-create-flow.test.mjs test/integration/operator-new-category-initial.test.mjs
git commit -m "feat: create initial campaign from a saved operator profile"
git push origin codex/new-category-onboarding-v1
```

### Task 7: Operator Profile Manual Bind and Page Health Compatibility

**Files:**
- Modify: `browser-extension/catalog-manual-binding.js`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `src/modules/catalog-scale/initial-pool-qa.mjs`
- Test: `test/unit/operator-profile-manual-binding.test.mjs`
- Test: `test/integration/operator-profile-manual-capture.test.mjs`

**Interfaces:**
- Consumes profile aliases, breadcrumbs, normalized listing URL/path, market fields, and existing Manual Bind runner.
- Produces exact detection/binding/capture compatibility without a second capture mode.

- [ ] **Step 1: Write RED tests**

Test a fake non-Motorcycle profile through detect, bind, and capture. Wrong alias, breadcrumb, path, country, language, currency, sort, CAPTCHA, SEARCH_NO_RESULTS, and missing cards must block binding/capture with zero database writes. Valid electronics must be retained in Raw Capture and not subjected to Motorcycle exclusions.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/operator-profile-manual-binding.test.mjs test/integration/operator-profile-manual-capture.test.mjs
```

- [ ] **Step 3: Implement minimal profile-driven checks**

Extend the existing expected-category check to aliases + breadcrumbs + normalized listing path. Preserve binding fingerprint invalidation and the existing server-side Manual Bind proof gate. Branch business screening by explicit profile kind/capability, never by sentinel or missing fields.

- [ ] **Step 4: Run GREEN and Manual Bind/QA/activation regressions**

```bash
node --test test/unit/operator-profile-manual-binding.test.mjs test/integration/operator-profile-manual-capture.test.mjs test/unit/catalog-manual-binding.test.mjs test/unit/catalog-manual-passive-runner.test.mjs test/integration/catalog-manual-binding.test.mjs test/integration/initial-manual-capture.test.mjs test/integration/initial-pool-qa.test.mjs test/integration/initial-pool-activation.test.mjs
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add browser-extension/catalog-manual-binding.js src/modules/catalog-scale/catalog-campaign-service.mjs src/modules/catalog-scale/initial-pool-qa.mjs test/unit/operator-profile-manual-binding.test.mjs test/integration/operator-profile-manual-capture.test.mjs
git commit -m "feat: drive Manual Bind from operator profiles"
git push origin codex/new-category-onboarding-v1
```

### Task 8: Campaign-preview and Formal-Pool Scoped Excel

**Files:**
- Create: `src/db/repositories/catalog-scoped-export-repository.mjs`
- Create: `src/modules/catalog-scale/catalog-scoped-export-service.mjs`
- Modify: `src/server/controllers/catalog-controller.mjs`
- Modify: `src/server/router.mjs`
- Modify: `src/server/index.mjs`
- Modify: `ui/modules/catalog/api.js`
- Modify: `ui/modules/catalog/panel.js`
- Test: `test/integration/catalog-scoped-export.test.mjs`
- Test: `test/unit/catalog-scoped-workbook.test.mjs`

**Interfaces:**
- Produces `POST /api/catalog/operator/initial-campaigns/:id/preview-export` requiring exact revision and `POST /api/catalog/pools/:id/export` requiring exact Category/Profile tuple.
- Returns saved path metadata but never implicit scope.

- [ ] **Step 1: Write RED repository/workbook/API tests**

Use Category A/B fixtures sharing one goods identity. Assert exact preview revision, stale revision block, formal tuple match, deterministic goods order, required sheets/fields, PREVIEW/NOT_ACTIVE_POOL metadata, missing-image honesty, Category B exclusion of Motorcycle-only goods, and database fingerprint unchanged before/after export.

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/catalog-scoped-workbook.test.mjs test/integration/catalog-scoped-export.test.mjs
```

- [ ] **Step 3: Implement minimal scoped repository/service and UI buttons**

Read preview rows from the exact Initial candidate ledger and activation payload. Read formal rows from exact Pool version items/snapshots. Reuse Artifact Tool workbook and compatible-image helpers; save atomically into an injected output directory. UI sends explicit identities from current Catalog state.

- [ ] **Step 4: Run GREEN and export/isolation regressions**

```bash
node --test test/unit/catalog-scoped-workbook.test.mjs test/integration/catalog-scoped-export.test.mjs test/integration/export-multi-category.test.mjs test/integration/export.test.mjs test/integration/catalog-pool-products-api.test.mjs test/unit/catalog-panel.test.mjs test/unit/yingdao-catalog-isolation.test.mjs
npm run check
git diff --check
```

- [ ] **Step 5: Commit and push**

```bash
git add src/db/repositories/catalog-scoped-export-repository.mjs src/modules/catalog-scale/catalog-scoped-export-service.mjs src/server/controllers/catalog-controller.mjs src/server/router.mjs src/server/index.mjs ui/modules/catalog/api.js ui/modules/catalog/panel.js test/unit/catalog-scoped-workbook.test.mjs test/integration/catalog-scoped-export.test.mjs
git commit -m "feat: export scoped Catalog preview and Pool workbooks"
git push origin codex/new-category-onboarding-v1
```

### Task 9: Integration Regression, Delivery Manifest, and Feature Verification

**Files:**
- Create: `scripts/verify-new-category-onboarding-v1.mjs`
- Create: `docs/superpowers/manifests/2026-09-02-new-category-onboarding-scoped-export-v1.md`
- Create: `test/integration/new-category-onboarding-e2e.test.mjs`
- Modify: `package.json` to register the verifier only

**Interfaces:**
- Produces a temporary-only end-to-end verifier and delivery manifest.
- Consumes all Task 2–8 public contracts.

- [ ] **Step 1: Write RED end-to-end verification**

Exercise validate → register → registry reload → Initial create → Manual Bind evidence capture → preview export → QA → activation → formal export in temporary directories and SQLite. Assert no YingDao file diff, no production path use, no taxonomy fallback, zero cross-category export rows, and zero export DB writes.

- [ ] **Step 2: Run RED**

```bash
node --test test/integration/new-category-onboarding-e2e.test.mjs
node scripts/verify-new-category-onboarding-v1.mjs
```

- [ ] **Step 3: Implement minimal verifier and manifest**

Verifier rejects production config/database/output inputs, reports every final Gate, and deletes only its own temporary root. Manifest lists APIs, profile storage, UI ownership, Manual Bind reuse, export scopes, error codes, and exact owned files.

- [ ] **Step 4: Run all focused/related/full gates**

```bash
node --test test/unit/operator-category-profile*.test.mjs test/unit/catalog-new-category*.test.mjs test/unit/operator-profile-manual-binding.test.mjs test/unit/catalog-scoped-workbook.test.mjs test/integration/operator-category-profile-api.test.mjs test/integration/operator-new-category-initial.test.mjs test/integration/operator-profile-manual-capture.test.mjs test/integration/catalog-scoped-export.test.mjs test/integration/new-category-onboarding-e2e.test.mjs
node scripts/verify-new-category-onboarding-v1.mjs
node --test test/unit/catalog-*.test.mjs test/integration/initial-*.test.mjs test/integration/catalog-*.test.mjs
node --test test/unit/yingdao-*.test.mjs test/unit/sourcing-review*.test.mjs test/unit/visual-*.test.mjs test/unit/stable-random5.test.mjs
npm run check
YINGDAO_REAL_SOURCE_DIR="/Users/chuangyangdianzi/Desktop/1688导出excel" npm test
git diff --check
```

Compare all failures by file, test name, assertion/error class. Expected exact baseline is two `server-jobs` HTTP 400 assertions plus five image-cache error/status assertions.

- [ ] **Step 5: Remove local dependency link, commit, and push**

Remove only the known `node_modules` symlink after verification. Do not remove data or outputs outside the feature worktree. Then:

```bash
git add package.json scripts/verify-new-category-onboarding-v1.mjs docs/superpowers/manifests/2026-09-02-new-category-onboarding-scoped-export-v1.md test/integration/new-category-onboarding-e2e.test.mjs
git commit -m "test: verify new category onboarding delivery"
git push origin codex/new-category-onboarding-v1
git status --short
git rev-parse HEAD
git rev-parse origin/codex/new-category-onboarding-v1
```

Expected: local/remote feature HEAD equal and worktree clean.

## Stable integration and runtime acceptance

After Task 9:

1. Fetch origin and re-read stable branch/HEAD/status.
2. If stable HEAD is not the original feature ancestor, stop with `STOP_FOR_STABLE_BRANCH_ADVANCE`.
3. In the stable runtime worktree run `git merge --ff-only codex/new-category-onboarding-v1`.
4. Recreate local dependency setup without committing it if required.
5. Rerun Task 9 focused, related, `npm run check`, `git diff --check`, and full-suite gates from stable runtime.
6. Stop only a launcher-owned verified Dashboard; never kill a foreign listener or trust a PID file alone.
7. Start the stable launcher, require exact health identity, and open `http://127.0.0.1:37821/`.
8. Open the new-category form and perform validation-only smoke with disposable client fields. Do not register a profile or create a Campaign.
9. Save the screenshot outside the repository.
10. Push `codex/catalog-yingdao-runtime` normally and prove remote/local HEAD equality.

## Plan coverage gates

```text
PLAN_COVERAGE = PASS
PROFILE_REGISTRY_STORE = TASKS_2_4
CAPTURE_ONLY_SCHEMA = TASK_3
PROFILE_APIS = TASK_4
CATALOG_UI = TASK_5
INITIAL_CREATE = TASK_6
MANUAL_BIND = TASK_7
SCOPED_EXCEL = TASK_8
FULL_VERIFICATION = TASK_9
YINGDAO_BUSINESS_CHANGES = 0
```
