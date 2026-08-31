# Initial Category Pool V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operator-controlled, open-ended Initial Campaign that can safely capture a brand-new Category, run deterministic mandatory QA on an immutable snapshot, and explicitly activate that Category's first Active Pool without affecting Motorcycle data.

**Architecture:** A new migration adds the `initial` Campaign type plus category eligibility, live Candidate ledger, QA snapshot, batch-context, and activation-idempotency persistence. A centralized quantity policy keeps the legacy target sentinel inside persistence, while focused Initial modules own deterministic hashing, QA, and activation coordination; the existing Catalog service, Manual Bind Extension, HTTP controller/router, and vanilla UI orchestrate those primitives without changing Refresh/Expansion semantics.

**Tech Stack:** Node.js 22 ESM, `node:sqlite` synchronous SQLite, Node test runner, existing HTTP server/router/controllers, vanilla HTML/CSS/ES modules, SHA-256 canonical JSON hashing.

**Spec:** `docs/superpowers/specs/2026-08-31-initial-category-pool-v1-design.md`

## Global Constraints

- Work only in `/private/tmp/temu-multi-category-safety-v1` on `codex/multi-category-safety-v1`.
- Do not begin Task 1 until this plan is explicitly approved.
- Do not push, write production SQLite, start real Temu capture, repair Active Pool, or change the Motorcycle 2135/1149 blocker.
- Do not resume, read as current, or modify the paused 1208/2000 Campaign.
- Product identity remains exactly `platform + goods_id`; Category belongs to membership/Pool scope, not Product identity.
- Initial is `baseline=0`, `quantityMode=OPEN_ENDED`, `captureLimit=null`, and has no business target or minimum count.
- The database-only `target_count` sentinel is exactly `2147483647`; it must never drive business logic or appear in UI/API/Extension/QA/reporting.
- Refresh and Expansion retain their current target, checkpoint, QA, materialization, and activation semantics.
- New Categories require explicit scoped taxonomy bindings; this work does not implement taxonomy content, Classification, or Opportunity.
- Manual Bind remains passive: automatic scroll/navigation/pagination/See more/category/sort switching/CAPTCHA handling are all OFF.
- `SINGLE_DASHBOARD_PROCESS_REQUIRED=YES`; V1 application mutex is not a distributed lock.
- All automated writes use temporary SQLite, fixtures, temporary Profile directories, or explicit copied SQLite files.
- Production database access, if any final audit is requested, is read-only; never apply migration 026 to production in this work.
- The nine existing CRLF migration diffs (`001`, `002`, `003`, `004`, `009`, `010`, `011`, `012`, `013`) remain unstaged and absent from every feature commit.
- Do not implement YingDao export, Multi-Country/Multi-Currency, QA performance optimization, or a multi-process lock.
- The approved full-suite baseline is exactly seven failures matched by test file, test name, and failure reason/error class; new failures are forbidden.

## File and Responsibility Map

- `db/migrations/026_initial_category_pool.sql`: only new schema migration; extends Campaign type and adds Initial-specific persistence.
- `src/modules/catalog-scale/campaign-quantity-policy.mjs`: sole interpreter of storage target versus business quantity semantics.
- `src/modules/catalog-scale/initial-candidate-hash.mjs`: versioned canonical normalization and SHA-256 Candidate hashing.
- `src/modules/catalog-scale/taxonomy-pipeline-capability.mjs`: exact Category/binding implementation capability registry; never a taxonomy fallback.
- `src/modules/catalog-scale/initial-pool-qa.mjs`: mandatory Gate evaluator and Gate timing model.
- `src/modules/catalog-scale/initial-activation-coordinator.mjs`: single-process per-Campaign activation mutex.
- `src/db/repositories/initial-pool-repository.mjs`: Initial eligibility, live Candidate ledger, QA snapshot, and activation-request persistence.
- `src/db/repositories/catalog-campaign-repository.mjs`: existing Campaign/Source/Queue primitives plus category-scoped Initial materialization into core Product/Pool tables.
- `src/modules/catalog-scale/catalog-campaign-service.mjs`: Initial create/capture/QA/activation orchestration and exact safety Gate ordering.
- `src/server/controllers/catalog-controller.mjs`, `src/server/router.mjs`: explicit Initial HTTP contracts.
- `browser-extension/catalog-manual-passive-runner.js`: OPEN_ENDED Manual Bind behavior without stage target or auto-stop.
- `tools/catalog-manual-passive-admin.mjs`: diagnostic output uses semantic quantity policy and never prints the sentinel.
- `ui/operator-campaign.js`, `ui/app.js`, `ui/index.html`, `ui/styles.css`: Initial/Expansion capability selection, QA state, and explicit activation UI.
- `test/fixtures/initial-category-pool-fixture.mjs`: temporary SQLite, fake Category, complete cards, and protected Motorcycle fingerprints.
- `scripts/verify-initial-category-pool-safety.mjs`: temporary-fixture final Gate verifier; imports no production config.
- `docs/superpowers/verification/2026-08-31-initial-category-pool-v1.md`: final evidence recorded only after all verification passes.

---

### Task 1: Migration 026 and Historical-schema Safety

**Files:**
- Create: `db/migrations/026_initial_category_pool.sql`
- Create: `test/integration/initial-category-pool-migration.test.mjs`
- Modify: `test/integration/migrations.test.mjs`

**Interfaces:**
- Produces: `campaign_type='initial'` support while preserving `smoke|refresh|expansion|test`.
- Produces tables: `catalog_initial_pool_eligibility_audits`, `catalog_initial_pool_candidate_state`, `catalog_initial_pool_candidate_items`, `catalog_initial_pool_batch_contexts`, `catalog_initial_pool_qa_runs`, `catalog_initial_pool_qa_candidate_items`, `catalog_initial_pool_activation_requests`.
- Preserves: every existing `catalog_campaigns` column, row, index, foreign-key reference, and old migration checksum.
- Consumed by: Tasks 3–7.

- [ ] **Step 1: Write the RED empty-schema and historical-upgrade tests**

Create a temporary migrations directory containing copies of `001`–`025`, migrate and seed all four historical Campaign types plus a paused `1208/2000` Refresh, then add copied migration 026 and upgrade:

```js
test('026 adds Initial schema without changing historical Campaigns',t=>{
  const fixture=historicalMigrationFixture(t);
  const before=fixture.snapshot();
  fixture.installMigration026();
  const result=migrateDatabase({databasePath:fixture.databasePath,migrationsDir:fixture.migrationsDir});
  assert.deepEqual(result.applied,['026_initial_category_pool.sql']);
  assert.deepEqual(fixture.snapshotHistoricalCampaigns(),before.campaigns);
  assert.deepEqual(fixture.snapshotHistoricalReferences(),before.references);
  assert.equal(fixture.db.prepare('PRAGMA integrity_check').pluck().get(),'ok');
  assert.deepEqual(fixture.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.doesNotThrow(()=>fixture.insertInitialCampaign({targetCount:2147483647}));
});
```

Add a rollback case that copies 026 to a temporary directory and injects invalid SQL after the table rebuild. Assert the old `catalog_campaigns` schema/rows remain and `schema_migrations` has no 026 row.

- [ ] **Step 2: Run the migration tests and verify RED**

```bash
node --test test/integration/initial-category-pool-migration.test.mjs
```

Expected: FAIL because migration 026 and the Initial tables do not exist.

- [ ] **Step 3: Implement the controlled Campaign table rebuild**

Start 026 with the existing migration-runner marker:

```sql
-- migrate: foreign_keys=off

CREATE TABLE catalog_campaigns_v26 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  campaign_type TEXT NOT NULL CHECK(campaign_type IN ('smoke','refresh','expansion','test','initial')),
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  target_gate TEXT NOT NULL DEFAULT 'non_electronic_unique_count' CHECK(target_gate IN (
    'non_electronic_unique_count','business_eligible_count','reviewable_unique_count'
  )),
  target_count INTEGER NOT NULL CHECK(target_count > 0),
  baseline_pool_count INTEGER NOT NULL DEFAULT 0 CHECK(baseline_pool_count >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','opening','waiting_category_confirmation','running','paused','manual_required',
    'qa_pending','qa_failed','completed','failed','cancelled'
  )),
  qa_status TEXT NOT NULL DEFAULT 'pending' CHECK(qa_status IN ('pending','passed','failed')),
  raw_observed_count INTEGER NOT NULL DEFAULT 0 CHECK(raw_observed_count >= 0),
  electronic_excluded_count INTEGER NOT NULL DEFAULT 0 CHECK(electronic_excluded_count >= 0),
  non_electronic_unique_count INTEGER NOT NULL DEFAULT 0 CHECK(non_electronic_unique_count >= 0),
  business_eligible_count INTEGER NOT NULL DEFAULT 0 CHECK(business_eligible_count >= 0),
  reviewable_unique_count INTEGER NOT NULL DEFAULT 0 CHECK(reviewable_unique_count >= 0),
  source_count INTEGER NOT NULL DEFAULT 0 CHECK(source_count >= 0),
  completed_source_count INTEGER NOT NULL DEFAULT 0 CHECK(completed_source_count >= 0),
  config_json TEXT NOT NULL DEFAULT '{}',
  qa_summary_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  browser_profile_name TEXT,
  browser_profile_directory TEXT,
  browser_control_mode TEXT,
  baseline_source TEXT CHECK(baseline_source IS NULL OR baseline_source IN ('ACTIVE_POOL_VERSION','LEGACY_ACTIVE_MEMBERSHIPS')),
  baseline_pool_version_id TEXT
) STRICT;
```

Copy every column explicitly, drop only the old table, rename `catalog_campaigns_v26`, and recreate `idx_catalog_campaigns_category_status`. Do not update any historical value.

- [ ] **Step 4: Add exact Initial persistence tables**

Use exact Category/Campaign foreign keys, strict JSON text columns, and uniqueness:

```sql
CREATE TABLE catalog_initial_pool_candidate_state (
  campaign_id TEXT PRIMARY KEY REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK(current_revision >= 0),
  current_hash TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK(candidate_count >= 0),
  candidate_hash_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  field_set_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalog_initial_pool_candidate_items (
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE RESTRICT,
  first_batch_id TEXT NOT NULL,
  staging_product_id INTEGER,
  activation_payload_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  first_seen_sequence INTEGER NOT NULL CHECK(first_seen_sequence > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id,platform,goods_id)
) STRICT;
```

Add the remaining tables with these exact persistence contracts:

```sql
CREATE TABLE catalog_initial_pool_eligibility_audits (
  campaign_id TEXT PRIMARY KEY REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  pool_history_count INTEGER NOT NULL CHECK(pool_history_count = 0),
  active_membership_count INTEGER NOT NULL CHECK(active_membership_count = 0),
  prior_nonterminal_initial_count INTEGER NOT NULL CHECK(prior_nonterminal_initial_count = 0),
  pool_history_json TEXT NOT NULL DEFAULT '[]',
  active_membership_ids_json TEXT NOT NULL DEFAULT '[]',
  eligible INTEGER NOT NULL CHECK(eligible = 1),
  checked_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalog_initial_pool_batch_contexts (
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  capture_mode TEXT NOT NULL,
  site_country TEXT NOT NULL,
  language TEXT NOT NULL,
  currency TEXT NOT NULL,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  sort_order TEXT NOT NULL,
  page_url TEXT NOT NULL,
  binding_version TEXT NOT NULL,
  binding_fingerprint TEXT NOT NULL,
  page_health_status TEXT NOT NULL,
  dom_ready INTEGER NOT NULL CHECK(dom_ready IN (0,1)),
  network_ready INTEGER NOT NULL CHECK(network_ready IN (0,1)),
  captcha_blocking INTEGER NOT NULL CHECK(captcha_blocking IN (0,1)),
  search_no_results INTEGER NOT NULL CHECK(search_no_results IN (0,1)),
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(campaign_id,source_id,batch_id)
) STRICT;

CREATE TABLE catalog_initial_pool_qa_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES catalog_campaigns(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','PASSED','FAILED')),
  candidate_count INTEGER NOT NULL CHECK(candidate_count > 0),
  candidate_revision INTEGER NOT NULL CHECK(candidate_revision > 0),
  candidate_hash TEXT NOT NULL,
  candidate_hash_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  field_set_version TEXT NOT NULL,
  mandatory_passed INTEGER CHECK(mandatory_passed IS NULL OR mandatory_passed IN (0,1)),
  checks_json TEXT NOT NULL DEFAULT '[]',
  failure_codes_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,request_id)
) STRICT;

CREATE TABLE catalog_initial_pool_qa_candidate_items (
  qa_run_id TEXT NOT NULL REFERENCES catalog_initial_pool_qa_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  platform TEXT NOT NULL,
  goods_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  source_id TEXT NOT NULL,
  first_batch_id TEXT NOT NULL,
  staging_product_id INTEGER,
  activation_payload_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(qa_run_id,platform,goods_id),
  UNIQUE(qa_run_id,ordinal)
) STRICT;

CREATE TABLE catalog_initial_pool_activation_requests (
  request_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES catalog_campaigns(id) ON DELETE RESTRICT,
  category_key TEXT NOT NULL,
  category_profile_version TEXT NOT NULL,
  qa_run_id TEXT NOT NULL REFERENCES catalog_initial_pool_qa_runs(id) ON DELETE RESTRICT,
  candidate_revision INTEGER NOT NULL CHECK(candidate_revision > 0),
  candidate_hash TEXT NOT NULL,
  parameters_hash TEXT NOT NULL,
  pool_version_id TEXT NOT NULL UNIQUE REFERENCES catalog_pool_versions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;
```

The audit-only `staging_product_id` columns must not reference staging with `ON DELETE RESTRICT` or `CASCADE`.

- [ ] **Step 5: Update the existing migration inventory test**

Change the expected applied list/count from 25 to 26 and add all seven new table names. Keep the existing old-checksum tests intact.

- [ ] **Step 6: Run GREEN and migration regressions**

```bash
node --test test/integration/initial-category-pool-migration.test.mjs test/integration/migrations.test.mjs
```

Expected: all PASS, including injected rollback and historical `1208/2000` equality.

- [ ] **Step 7: Verify exact staging and commit Task 1**

```bash
git diff --check -- db/migrations/026_initial_category_pool.sql test/integration/initial-category-pool-migration.test.mjs test/integration/migrations.test.mjs
git add -- db/migrations/026_initial_category_pool.sql test/integration/initial-category-pool-migration.test.mjs test/integration/migrations.test.mjs
git diff --cached --name-only
git commit -m "feat: add Initial Category Pool schema"
```

The cached list must contain exactly those three paths. Never use `git add db/migrations` or a migration glob.

---

### Task 2: Centralized Campaign Quantity Policy

**Files:**
- Create: `src/modules/catalog-scale/campaign-quantity-policy.mjs`
- Create: `test/unit/campaign-quantity-policy.test.mjs`
- Modify: `src/db/repositories/catalog-campaign-repository.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`

**Interfaces:**
- Produces: `INITIAL_TARGET_STORAGE_SENTINEL = 2147483647`.
- Produces: `initialQuantityConfig()` returning the frozen config fragment.
- Produces: `getCampaignQuantityPolicy(campaign)` returning `{quantityMode,captureLimit,businessTarget,remaining,targetReached}`.
- Produces: mapped Initial Campaign with `storageTargetCount=2147483647`, `targetCount=null`, and `quantityPolicy`.
- Preserves: numeric `targetCount` and current target behavior for every non-Initial Campaign.

- [ ] **Step 1: Write RED quantity contract tests**

```js
test('Initial sentinel is storage-only and public quantities are null',()=>{
  const campaign=initialCampaign({targetCount:2147483647,config:{quantityMode:'OPEN_ENDED',captureLimit:null,
    targetCountStorage:{kind:'LEGACY_NOT_NULL_SENTINEL',value:2147483647}}});
  assert.deepEqual(getCampaignQuantityPolicy(campaign),{
    quantityMode:'OPEN_ENDED',captureLimit:null,businessTarget:null,remaining:null,targetReached:null
  });
});

test('sentinel alone never identifies a non-Initial Campaign',()=>{
  const policy=getCampaignQuantityPolicy({campaignType:'refresh',targetCount:2147483647,nonElectronicUniqueCount:10,config:{}});
  assert.equal(policy.quantityMode,'TARGETED');
  assert.equal(policy.businessTarget,2147483647);
});

test('malformed Initial quantity config hard fails',()=>{
  assert.throws(()=>getCampaignQuantityPolicy(initialCampaign({config:{quantityMode:'TARGETED'}})),
    error=>error.code==='INITIAL_QUANTITY_POLICY_INVALID');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/campaign-quantity-policy.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the sole semantic resolver**

```js
export const INITIAL_TARGET_STORAGE_SENTINEL=2147483647;

export function initialQuantityConfig(){
  return {quantityMode:'OPEN_ENDED',captureLimit:null,
    targetCountStorage:{kind:'LEGACY_NOT_NULL_SENTINEL',value:INITIAL_TARGET_STORAGE_SENTINEL}};
}

export function getCampaignQuantityPolicy(campaign){
  if(campaign.campaignType!=='initial'){
    const target=Number(campaign.storageTargetCount??campaign.targetCount);
    const current=Number(campaign.nonElectronicUniqueCount??0);
    return {quantityMode:'TARGETED',captureLimit:target,businessTarget:target,
      remaining:Math.max(0,target-current),targetReached:current>=target};
  }
  const storage=campaign.config?.targetCountStorage;
  if(campaign.config?.quantityMode!=='OPEN_ENDED'||campaign.config?.captureLimit!==null
    ||storage?.kind!=='LEGACY_NOT_NULL_SENTINEL'||storage?.value!==INITIAL_TARGET_STORAGE_SENTINEL
    ||Number(campaign.storageTargetCount??campaign.targetCount)!==INITIAL_TARGET_STORAGE_SENTINEL){
    throw new AppError('Initial数量策略无效。',{code:'INITIAL_QUANTITY_POLICY_INVALID'});
  }
  return {quantityMode:'OPEN_ENDED',captureLimit:null,businessTarget:null,remaining:null,targetReached:null};
}
```

- [ ] **Step 4: Integrate repository mapping without breaking old Campaigns**

For mapped rows, preserve raw storage separately and expose semantic target:

```js
const storageTargetCount=Number(row.target_count);
const base={campaignType:row.campaign_type,storageTargetCount,targetCount:storageTargetCount,
  nonElectronicUniqueCount:Number(row.non_electronic_unique_count),config:parseJson(row.config_json)};
const quantityPolicy=getCampaignQuantityPolicy(base);
return {...base,targetCount:quantityPolicy.businessTarget,quantityPolicy};
```

Persistence continues to receive an explicit numeric `targetCount`; only Initial creation may pass the sentinel.

- [ ] **Step 5: Audit and guard every Catalog target branch**

Run the repository-wide search and classify every hit. Existing Refresh/Expansion code stays targeted. Any generic branch in `captureBatch`, `rpaContext`, status mapping, completion, QA, activation, or progress must call the policy or explicitly require `refresh|expansion` before comparing a target.

```bash
rg -n "targetCount|target_count|targetReached|target_reached|remaining|TARGET_GATE_REACHED|Math\.min\([^\n]*target" src/modules/catalog-scale src/db/repositories src/server/controllers tools browser-extension ui
```

Do not change Extension/UI behavior yet; record those concrete hits for Tasks 5 and 8.

- [ ] **Step 6: Run GREEN and target regressions**

```bash
node --test test/unit/campaign-quantity-policy.test.mjs test/integration/catalog-refresh.test.mjs test/integration/catalog-expansion.test.mjs test/integration/operator-campaign-create.test.mjs
```

Expected: quantity tests PASS and all existing targeted Campaign tests remain PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add -- src/modules/catalog-scale/campaign-quantity-policy.mjs test/unit/campaign-quantity-policy.test.mjs src/db/repositories/catalog-campaign-repository.mjs src/modules/catalog-scale/catalog-campaign-service.mjs
git diff --cached --name-only
git commit -m "feat: centralize Campaign quantity semantics"
```

Confirm the cached list contains no migration path.

---

### Task 3: Initial Campaign Creation and Profile Capabilities

**Files:**
- Create: `test/fixtures/initial-category-pool-fixture.mjs`
- Create: `test/integration/initial-campaign-create.test.mjs`
- Create: `src/db/repositories/initial-pool-repository.mjs`
- Create: `src/modules/catalog-scale/taxonomy-pipeline-capability.mjs`
- Create: `test/unit/taxonomy-pipeline-capability.test.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `src/server/controllers/catalog-controller.mjs`

**Interfaces:**
- Produces fixture: `createInitialPoolFixture(t,{withProtectedMotorcycle=true})`, `completeCard(goodsId)`, `motorcycleFingerprint(db)`.
- Produces repository: `getInitialEligibility(profile)`, `recordInitialEligibilityAudit(campaign,input)`, `findInitialByRequestId(requestId)`.
- Produces service: `createOperatorInitialCampaign({profile,campaignName,requestId})`.
- Extends profile description with `profile_valid`, `expansion_available`, `initial_pool_available`, `classification_available`, `opportunity_available`.
- Consumes Task 2: `initialQuantityConfig()`, sentinel, and centralized policy.

- [ ] **Step 1: Build the temporary fake-Category fixture and RED tests**

The fixture creates a temporary migrated SQLite and an in-memory validated fake Profile:

```js
export function fixtureCategoryProfile(){
  return validateCategoryProfile({
    category_key:'fixture-category-b',category_profile_version:'fixture-category-b-v1',display_name:'Fixture Category B',
    site_country:'DE',language:'en',currency:'EUR',sort_order:'Top Sales',target_count:2000,
    exclude_electronics:true,exclude_usb:true,exclude_battery:true,price_min_eur:5,
    taxonomy:'fixture-category-b-taxonomy',
    membership_scope:{site_country:'DE',language:'en',currency:'EUR',primary_category:'Fixture',subcategory:'Category B',sort_order:'Top Sales'},
    page_health:{category_names:['Fixture Category B']},
    taxonomy_bindings:{
      classify:{taxonomy_name:'fixture-category-b-classify',taxonomy_version:null,rule_version:'fixture-classify-v1'},
      fine_classify:{taxonomy_name:'fixture-category-b-fine',taxonomy_version:'fixture-fine-v1',rule_version:'fixture-fine-rule-v1'},
      opportunity:{taxonomy_name:'fixture-category-b-opportunity',taxonomy_version:'fixture-opportunity-v1',rule_version:'fixture-opportunity-rule-v1'}
    },legacy_membership_scopes:[],
    navigation:{entry_method:'site_menu',breadcrumbs:['Fixture','Category B'],category_confirmation_gate:true},
    business_rules:{default_gate:'non_electronic_unique_count',manual_review_on_low_confidence:true,
      count_manual_review_as_non_electronic:false,hard_exclusion_codes:[...REQUIRED_ELECTRONIC_EXCLUSION_CODES]}
  });
}
```

Tests must cover happy path, exact replay, request conflict, Pool history, explicit active membership inconsistency, duplicate name, active RPA conflict, and zero-write fingerprints.

```js
test('eligible no-Pool Category creates one open-ended UNBOUND Initial Campaign atomically',async t=>{
  const f=await createInitialPoolFixture(t);
  const result=f.service.createOperatorInitialCampaign({profile:f.profile,campaignName:'Fixture Initial',requestId:'initial-create-1'});
  assert.equal(result.campaignType,'initial');
  assert.equal(result.baselineCount,0);
  assert.equal(result.targetCount,null);
  assert.equal(result.quantityMode,'OPEN_ENDED');
  const stored=f.db.prepare('SELECT target_count,config_json FROM catalog_campaigns WHERE id=?').get(result.campaignId);
  assert.equal(stored.target_count,2147483647);
  assert.equal(JSON.parse(stored.config_json).quantityMode,'OPEN_ENDED');
  assert.equal(f.db.prepare('SELECT target_quota FROM catalog_sources WHERE campaign_id=?').get(result.campaignId).target_quota,null);
  assert.equal(f.service.currentOperatorManualContext().queue.checkpoint.runner_state,'UNBOUND');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test test/integration/initial-campaign-create.test.mjs
```

Expected: FAIL because Initial repository/service methods do not exist.

- [ ] **Step 3: Implement exact Initial eligibility**

`getInitialEligibility(profile)` must query Pool history by exact `category_key` across all profile versions and active memberships by exact keyed full scope. It must never invoke the Motorcycle null-category resolver:

```js
const poolHistory=db.prepare('SELECT id,status,category_profile_version FROM catalog_pool_versions WHERE category_key=? ORDER BY created_at,id')
  .all(profile.category_key);
const activeMemberships=db.prepare(`SELECT m.id,m.product_id FROM catalog_memberships m
  WHERE m.category_key=? AND m.site_country=? AND m.language=? AND m.currency=?
    AND m.primary_category=? AND m.subcategory=? AND m.sort_order=? AND m.active=1 ORDER BY m.id`)
  .all(profile.category_key,scope.site_country,scope.language,scope.currency,
    scope.primary_category,scope.subcategory,scope.sort_order);
```

Return stable evidence counts/IDs. Pool history yields `INITIAL_POOL_ALREADY_EXISTS` for active and `INITIAL_POOL_HISTORY_EXISTS` otherwise. Scoped active memberships without Pool yield `INITIAL_CATEGORY_STATE_INCONSISTENT`.

- [ ] **Step 4: Implement atomic Initial creation**

Inside one `transaction(db,...)`:

```js
function createOperatorInitialCampaign(input){
  const profile=validateCategoryProfile(input.profile);
  const campaignName=requiredString(input.campaignName,'campaignName',256);
  const requestId=requiredString(input.requestId,'requestId',128);
  return transaction(db,()=>{
    const replay=initialRepository.findInitialByRequestId(requestId);
    if(replay)return exactInitialCreateReplay(replay,{profile,campaignName,requestId});
    if(repository.listActiveRpaQueues().length)throw coded('CATALOG_RPA_CLAIM_CONFLICT');
    assertInitialEligibility(initialRepository.getInitialEligibility(profile));
    let campaign=createCampaignRecord({name:campaignName,campaignType:'initial',profile,baselinePoolCount:0,
      targetCount:INITIAL_TARGET_STORAGE_SENTINEL,browserContext:manualBrowserContext(),
      configExtras:{...initialQuantityConfig(),operatorCreate:{requestId,captureMode:MANUAL_PASSIVE_CAPTURE_MODE}}});
    initialRepository.recordInitialEligibilityAudit(campaign,initialRepository.getInitialEligibility(profile));
    initialRepository.initializeCandidateState(campaign);
    const source=repository.createSource(campaign,{sourceKey:'manual-bind-passive',sourceType:'category',
      sortOrder:profile.sort_order,targetQuota:null,priority:1,navigationHint:passiveNavigationHint()});
    campaign=repository.transitionCampaign(campaign.id,'running');
    return claimInitialUnboundContext(campaign,source);
  });
}
```

Checkpoint must omit `session_target` and include `quantity_mode:'OPEN_ENDED'`, `capture_limit:null`, and all automatic flags false.

- [ ] **Step 5: Split Profile capabilities**

Create an exact capability registry keyed by Category and all three binding fields:

```js
const IMPLEMENTED=Object.freeze({
  'motorcycle-accessories':Object.freeze({
    classify:Object.freeze({taxonomy_name:'week1-motorcycle-accessories',taxonomy_version:null,rule_version:'week1-rule-v1'}),
    fine_classify:Object.freeze({taxonomy_name:'week2-motorcycle-fine-v1',taxonomy_version:null,rule_version:'week2-fine-rule-v1'}),
    opportunity:Object.freeze({taxonomy_name:'motorcycle-opportunity',taxonomy_version:'motorcycle-opportunity-v2',rule_version:'active-pool-rule-v2'})
  })
});

export function hasTaxonomyPipelineImplementation(profile,pipeline){
  const expected=IMPLEMENTED[profile.category_key]?.[pipeline];
  const actual=profile.taxonomy_bindings?.[pipeline];
  return Boolean(expected&&actual&&expected.taxonomy_name===actual.taxonomy_name
    &&expected.taxonomy_version===actual.taxonomy_version&&expected.rule_version===actual.rule_version);
}
```

This registry describes existing implementations only; it does not classify, add taxonomy content, or permit cross-Category fallback. Tests must prove a fake Category using Motorcycle binding strings still returns false because its `category_key` differs.

`describeOperatorProfile(profile)` returns both backward-compatible `available` for Expansion and explicit capabilities. Initial availability requires valid Profile plus exact empty eligibility. `classification_available` requires both classify and fine-classify capabilities; `opportunity_available` requires the opportunity capability.

- [ ] **Step 6: Run GREEN and creation regressions**

```bash
node --test test/integration/initial-campaign-create.test.mjs test/integration/operator-campaign-create.test.mjs test/integration/multi-category-isolation.test.mjs test/unit/category-profile.test.mjs test/unit/taxonomy-pipeline-capability.test.mjs
```

Expected: Initial tests PASS; Expansion operator creation and Motorcycle legacy behavior remain PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add -- test/fixtures/initial-category-pool-fixture.mjs test/integration/initial-campaign-create.test.mjs src/db/repositories/initial-pool-repository.mjs src/modules/catalog-scale/taxonomy-pipeline-capability.mjs test/unit/taxonomy-pipeline-capability.test.mjs src/modules/catalog-scale/catalog-campaign-service.mjs src/server/controllers/catalog-controller.mjs
git diff --cached --name-only
git commit -m "feat: create open-ended Initial Campaigns"
```

---

### Task 4: Deterministic Live Candidate Ledger

**Files:**
- Create: `src/modules/catalog-scale/initial-candidate-hash.mjs`
- Create: `test/unit/initial-candidate-hash.test.mjs`
- Create: `test/integration/initial-candidate-ledger.test.mjs`
- Modify: `src/db/repositories/initial-pool-repository.mjs`

**Interfaces:**
- Produces constants: `CANDIDATE_HASH_VERSION='v1'`, `NORMALIZATION_VERSION='v1'`, `FIELD_SET_VERSION='initial-pool-activation-v1'`.
- Produces: `buildInitialActivationPayload({campaign,source,batchId,product})`.
- Produces: `hashInitialCandidate(items,{hashVersion})` returning `{hash,count,rows}`.
- Produces repository: `applyCandidateItems(campaign,items)`, `getCandidateState(campaignId)`, `listCandidateItems(campaignId)`, `freezeQaCandidate(input)`.
- Consumed by: Tasks 5–7.

- [ ] **Step 1: Write RED canonical-hash tests**

```js
test('canonical hash ignores key order input order timezone and last_seen_at',()=>{
  const a=[payload('2',{last_seen_at:'2026-08-31T01:00:00+08:00'}),payload('1',{price_amount:12})];
  const b=[reverseKeys(payload('1',{price_amount:12,last_seen_at:'ignored'})),reverseKeys(payload('2'))];
  assert.equal(hashInitialCandidate(a,{hashVersion:'v1'}).hash,hashInitialCandidate(b,{hashVersion:'v1'}).hash);
});

test('activation business changes alter the hash',()=>{
  assert.notEqual(hashInitialCandidate([payload('1',{price_amount:12})],{hashVersion:'v1'}).hash,
    hashInitialCandidate([payload('1',{price_amount:13})],{hashVersion:'v1'}).hash);
});
```

Also assert unsupported version returns `INITIAL_POOL_HASH_VERSION_UNSUPPORTED`.

- [ ] **Step 2: Run hash tests and verify RED**

```bash
node --test test/unit/initial-candidate-hash.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement canonical serialization**

Use an explicit field list, normalized scalar rules, sorted identities, and recursive stable key ordering only for the versioned `raw` business payload:

```js
const V1_FIELDS=['platform','goods_id','category_key','category_profile_version','title','source_url','canonical_url',
  'image_url','price_amount','currency','sales_count','rating','review_count','listing_rank',
  'electronic_screening_status','business_eligible','reviewable','quality_status','source_id','first_batch_id'];

export function hashInitialCandidate(items,{hashVersion}){
  if(hashVersion!=='v1')throw new AppError('不支持的Candidate hash版本。',{code:'INITIAL_POOL_HASH_VERSION_UNSUPPORTED'});
  const rows=items.map(normalizeV1).sort((a,b)=>a.platform.localeCompare(b.platform)||a.goods_id.localeCompare(b.goods_id));
  const serialized=canonicalJson({candidate_hash_version:'v1',normalization_version:'v1',
    field_set_version:'initial-pool-activation-v1',items:rows});
  return {hash:createHash('sha256').update(serialized,'utf8').digest('hex'),count:rows.length,rows};
}
```

- [ ] **Step 4: Write RED live-ledger integration tests**

Directly apply normalized items to a temporary Initial Campaign and assert:

```text
first item → revision 1/count 1
identical replay → revision/hash unchanged
new item → revision 2/count 2
business-field change → revision 3/hash changed
timestamp-only change → revision/hash unchanged
staging deletion → ledger/count/hash unchanged
campaign non_electronic_unique_count mirrors ledger count
```

- [ ] **Step 5: Implement atomic ledger updates**

`applyCandidateItems` upserts by `(campaign_id,platform,goods_id)`, recomputes the full Candidate hash from ledger payloads, and advances revision only when the computed hash differs. Update Candidate state and `catalog_campaigns.non_electronic_unique_count` in the same transaction scope supplied by the caller.

`freezeQaCandidate` copies current ledger rows to immutable QA Candidate rows; it never reads staging.

- [ ] **Step 6: Run GREEN and repository regressions**

```bash
node --test test/unit/initial-candidate-hash.test.mjs test/integration/initial-candidate-ledger.test.mjs test/integration/catalog-campaign.test.mjs
```

- [ ] **Step 7: Commit Task 4**

```bash
git add -- src/modules/catalog-scale/initial-candidate-hash.mjs test/unit/initial-candidate-hash.test.mjs test/integration/initial-candidate-ledger.test.mjs src/db/repositories/initial-pool-repository.mjs
git diff --cached --name-only
git commit -m "feat: persist deterministic Initial candidates"
```

---

### Task 5: OPEN_ENDED Manual Capture Integration

**Files:**
- Create: `test/integration/initial-manual-capture.test.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `src/db/repositories/initial-pool-repository.mjs`
- Modify: `browser-extension/catalog-manual-passive-runner.js`
- Modify: `tools/catalog-manual-passive-admin.mjs`
- Modify: `test/unit/catalog-manual-passive-runner.test.mjs`

**Interfaces:**
- Consumes Task 2: `getCampaignQuantityPolicy()`.
- Consumes Task 4: Candidate payload/hash and ledger repository.
- Produces: each accepted Initial batch atomically persists batch, Page/Binding context evidence, staging audit, and Candidate ledger.
- Produces service: `getInitialOperatorStatus(campaignId)` returning semantic quantity fields and live Candidate state.
- Produces Extension Initial states: `UNBOUND|PAGE_BOUND|CAPTURING|COMPLETED`; never `TARGET_REACHED` from quantity.
- Preserves targeted Manual runner behavior for Refresh/Expansion.

- [ ] **Step 1: Write RED integration tests at 10, 100, and 1000**

Use complete cards in multiple batches and the existing exact page binding fixture:

```js
test('Initial Manual Capture remains open at 10 100 and 1000 unique products',async t=>{
  const f=await boundInitialFixture(t);
  for(const end of [10,100,1000]){
    const cards=range(f.current+1,end).map(id=>completeCard(String(id)));
    f.capture({batchId:`batch-${end}`,cards});
    const current=f.service.getInitialOperatorStatus(f.campaignId);
    assert.equal(current.liveUniqueCount,end);
    assert.equal(current.targetCount,null);
    assert.equal(current.remaining,null);
    assert.equal(current.targetReached,null);
    assert.equal(current.status,'running');
  }
});
```

Add zero-write tests for UNBOUND, activation mutex, invalid Category/Profile, changed URL/context fingerprint, wrong DE/en/EUR/Top Sales, CAPTCHA, SEARCH_NO_RESULTS, and DOM/Network both not ready.

- [ ] **Step 2: Run RED**

```bash
node --test test/integration/initial-manual-capture.test.mjs
```

Expected: current target branch stops/truncates or the Candidate ledger/context evidence is absent.

- [ ] **Step 3: Integrate Candidate ledger after all pre-write Gates**

Extend the internal `captureBatch` input with `pageBinding=null` and `captureMode=null`; `captureExtensionBatch` passes its already validated `input.page_binding` and `input.capture_mode`. Include both in the idempotency payload hash.

In `captureBatch`, compute policy once. The target break applies only when `quantityMode==='TARGETED'`. For Initial, accepted screened products are converted to activation payloads and written with batch context in the same existing transaction:

```js
const policy=getCampaignQuantityPolicy(campaign);
if(policy.quantityMode==='TARGETED'&&acceptedNonElectronic>=policy.businessTarget&&shouldStopTargeted(...))break;
// existing batch/staging/exclusion writes
if(campaign.campaignType==='initial'){
  initialRepository.recordBatchContext({campaign,source,batch,pageContext,pageBinding,captureMode});
  initialRepository.applyCandidateItems(campaign,passedProducts.map(product=>
    buildInitialActivationPayload({campaign,source,batchId,product})));
}
```

After refreshing counts, rebuild semantic policy and emit a target-neutral audit:

```js
const refreshedPolicy=getCampaignQuantityPolicy(refreshedCampaign);
const audit={campaignTarget:refreshedPolicy.businessTarget,targetReached:refreshedPolicy.targetReached,
  remaining:refreshedPolicy.remaining,serviceObserved,electronicExcluded,otherBusinessExcluded,
  eligibleGoods,acceptedGoods,stoppedDueToTarget,unprocessedAfterTarget,failed:0,campaignStagingDeduped:duplicateCount};
```

`getCaptureContext`, `rpaContext`, `captureExtensionBatch`, and `getStatus` must expose `quantityMode`, `captureLimit`, semantic `targetCount`, `remaining`, and `targetReached` from the centralized policy. Initial returns null quantities; Refresh/Expansion remain numeric.

- [ ] **Step 4: Split Extension runner behavior by semantic policy**

For Initial context:

```js
if(campaign.quantityMode==='OPEN_ENDED'){
  this.sessionTarget=null;
  const candidates=this.dependencies.passiveCandidates({limit:null,submitted:new Set()});
  // after submission return PAGE_BOUND, never TARGET_REACHED
}
```

Update the local `passiveCandidates` dependency contract so `limit===null` returns the full current strict DOM/Network intersection; numeric limits retain the current slice behavior. Do not run `assertStageAllowed`, `50/300/final target`, remaining subtraction, or target completion for Initial. Existing targeted tests must remain byte-for-behavior equivalent.

- [ ] **Step 5: Remove diagnostic sentinel leakage**

`tools/catalog-manual-passive-admin.mjs` must render Initial as:

```json
{"quantity_mode":"OPEN_ENDED","target":null,"remaining":null,"target_reached":null}
```

The CLI remains diagnostic and does not gain Initial QA/Activation commands.

- [ ] **Step 6: Run GREEN and Manual Bind regressions**

```bash
node --test test/integration/initial-manual-capture.test.mjs test/integration/catalog-manual-binding.test.mjs test/integration/catalog-rpa.test.mjs test/unit/catalog-manual-passive-runner.test.mjs test/unit/catalog-manual-binding.test.mjs
npm run check:network-capture
```

- [ ] **Step 7: Commit Task 5**

```bash
git add -- test/integration/initial-manual-capture.test.mjs src/modules/catalog-scale/catalog-campaign-service.mjs src/db/repositories/initial-pool-repository.mjs browser-extension/catalog-manual-passive-runner.js tools/catalog-manual-passive-admin.mjs test/unit/catalog-manual-passive-runner.test.mjs
git diff --cached --name-only
git commit -m "feat: capture Initial Campaigns without a target"
```

---

### Task 6: Immutable Initial QA and Mandatory Gates

**Files:**
- Create: `src/modules/catalog-scale/initial-pool-qa.mjs`
- Create: `test/unit/initial-pool-qa.test.mjs`
- Create: `test/integration/initial-pool-qa.test.mjs`
- Modify: `src/db/repositories/initial-pool-repository.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `src/modules/catalog-scale/category-profile.mjs`
- Modify: `test/unit/category-profile.test.mjs`

**Interfaces:**
- Produces: `evaluateInitialPoolQa({db,campaign,profile,qaRun,candidateItems,eligibility,now,integrityCheck,foreignKeyCheck})`.
- Produces service: `runInitialPoolQa({campaignId,categoryKey,categoryProfileVersion,requestId})`.
- Produces service: `getInitialQaState(campaignId)` returning `NOT_RUN|RUNNING|FAILED|PASSED_CURRENT|STALE` plus counts/delta/timing/checks.
- Consumes Task 4 immutable Candidate snapshot; never reads staging for business payload.

- [ ] **Step 1: Write RED table-driven Gate tests**

Use one complete Candidate and override one evidence field per case:

```js
for(const fixture of [
  ['INITIAL_CAMPAIGN_IDENTITY_INVALID',x=>x.campaign.campaignType='refresh'],
  ['INITIAL_POOL_EMPTY',x=>x.candidateItems=[]],
  ['INITIAL_GOODS_ID_DUPLICATE',x=>x.candidateItems.push({...x.candidateItems[0]})],
  ['INITIAL_MARKET_CONTEXT_INVALID',x=>x.batchContexts[0].currency='USD'],
  ['INITIAL_SOURCE_CONTEXT_INVALID',x=>x.batchContexts[0].sortOrder='Recommended'],
  ['INITIAL_PAGE_HEALTH_INVALID',x=>x.batchContexts[0].captchaBlocking=true],
  ['INITIAL_BINDING_EVIDENCE_INVALID',x=>x.batchContexts[0].bindingFingerprint='wrong'],
  ['INITIAL_DATA_QUALITY_FAILED',x=>x.candidateItems[0].activationPayload.image_url=null],
  ['INITIAL_MEMBERSHIP_AMBIGUOUS',x=>x.membershipEvidence.ambiguous=true],
  ['INITIAL_CROSS_CATEGORY_CONTAMINATION',x=>x.candidateItems[0].categoryKey='foreign'],
  ['SQLITE_INTEGRITY_FAILED',x=>x.integrityCheck=()=>['broken']],
  ['SQLITE_FOREIGN_KEY_FAILED',x=>x.foreignKeyCheck=()=>[{table:'bad'}]]
])test(`mandatory QA blocks ${fixture[0]}`,()=>assertGateFailure(fixture));
```

Assert Profile thresholds may increase but never reduce the code floors of 95/95/95/90/90/90.

- [ ] **Step 2: Run RED unit QA tests**

```bash
node --test test/unit/initial-pool-qa.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure Gate evaluator with timing**

Each Gate returns `{name,passed,errorCode,durationMs,details}`. Overall PASS is `checks.every(check=>check.passed)`. `integrity_check` and `foreign_key_check` remain mandatory and have no automatic elapsed-time failure.

```js
function timedGate(name,errorCode,check,{nowMs}){
  const started=nowMs();let passed=false,details={};
  try{({passed,details={}}=check());}finally{}
  return {name,passed,errorCode:passed?null:errorCode,durationMs:Math.max(0,nowMs()-started),details};
}
```

Taxonomy Gate validates frozen binding structure/scope only; it must not require a classifier implementation.

Extend `validateBusinessRules` with optional `initial_pool_quality` containing `title`, `price`, `image`, `sales`, `rating`, and `review_count`. Missing configuration resolves to the code floors. Every supplied value must be within `[0,1]` and greater than or equal to its corresponding floor; a lower value makes the Profile invalid rather than weakening QA.

```json
{
  "initial_pool_quality": {
    "title": 0.98,
    "price": 0.97,
    "image": 0.96,
    "sales": 0.92,
    "rating": 0.91,
    "review_count": 0.90
  }
}
```

- [ ] **Step 4: Write RED QA orchestration tests**

Cover:

```text
live=0 → INITIAL_POOL_EMPTY
live=1/10/87/137/500 → QA allowed
same QA request + same revision → same run
same request + changed revision → INITIAL_QA_REQUEST_CONFLICT
PASS + identical replay → PASSED_CURRENT
PASS + changed Candidate → STALE with correct counts/delta
QA snapshot remains valid after original staging deletion
RUNNING row exists before evaluator hook returns
duration recorded; a deliberately long injected checker does not auto-fail
```

- [ ] **Step 5: Implement run/finalize orchestration**

Phase A short transaction validates exact identity, requires nonempty ledger, handles exact request replay, inserts `RUNNING` QA run, and copies immutable Candidate rows.

Phase B evaluates the frozen rows.

Phase C transaction persists checks/failure codes/duration and mirrors `catalog_campaigns.qa_status` to `passed|failed`; Candidate changes after the snapshot are represented by derived `STALE`, not by mutating historical QA rows.

- [ ] **Step 6: Run GREEN and existing QA regressions**

```bash
node --test test/unit/initial-pool-qa.test.mjs test/integration/initial-pool-qa.test.mjs test/unit/category-profile.test.mjs test/integration/catalog-refresh.test.mjs test/integration/catalog-expansion.test.mjs
```

- [ ] **Step 7: Commit Task 6**

```bash
git add -- src/modules/catalog-scale/initial-pool-qa.mjs test/unit/initial-pool-qa.test.mjs test/integration/initial-pool-qa.test.mjs src/db/repositories/initial-pool-repository.mjs src/modules/catalog-scale/catalog-campaign-service.mjs src/modules/catalog-scale/category-profile.mjs test/unit/category-profile.test.mjs
git diff --cached --name-only
git commit -m "feat: gate immutable Initial Pool QA"
```

---

### Task 7: Atomic Category-scoped Initial Activation

**Files:**
- Create: `src/modules/catalog-scale/initial-activation-coordinator.mjs`
- Create: `test/unit/initial-activation-coordinator.test.mjs`
- Create: `test/integration/initial-pool-activation.test.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `src/db/repositories/initial-pool-repository.mjs`
- Modify: `src/db/repositories/catalog-campaign-repository.mjs`

**Interfaces:**
- Produces: `createInitialActivationCoordinator()` with `isActivating(campaignId)` and `run(campaignId,work)`.
- Produces service: `activateInitialPool({campaignId,categoryKey,categoryProfileVersion,requestId})`.
- Produces repository: `materializeInitialPool({campaign,profile,qaRun,candidateItems,requestId,hooks})`.
- Preserves: existing `activatePoolVersion()` for Refresh/Expansion.

- [ ] **Step 1: Write RED mutex tests**

```js
test('coordinator releases Campaign lock after success and failure',()=>{
  const gate=createInitialActivationCoordinator();
  assert.equal(gate.isActivating('c1'),false);
  gate.run('c1',()=>assert.equal(gate.isActivating('c1'),true));
  assert.equal(gate.isActivating('c1'),false);
  assert.throws(()=>gate.run('c1',()=>{throw new Error('boom');}),/boom/);
  assert.equal(gate.isActivating('c1'),false);
});
```

- [ ] **Step 2: Run RED mutex test**

```bash
node --test test/unit/initial-activation-coordinator.test.mjs
```

- [ ] **Step 3: Implement the minimal per-Campaign coordinator**

```js
export function createInitialActivationCoordinator(){
  const held=new Set();
  return {
    isActivating:id=>held.has(String(id)),
    run(id,work){
      const key=String(id);
      if(held.has(key))throw new AppError('首池正在建立。',{code:'INITIAL_POOL_ACTIVATION_IN_PROGRESS'});
      held.add(key);try{return work();}finally{held.delete(key);}
    }
  };
}
```

- [ ] **Step 4: Write RED activation integration tests**

Cover exact request, current PASS, stale candidate, Pool race, same-request replay, new-request repeated click, same Product/two memberships, Motorcycle fingerprint equality, and taxonomy implementation unavailable after Raw Pool activation.

Use an injected phase hook to prove rollback at:

```text
afterProduct
afterSnapshot
afterMembership
afterPool
afterPoolItem
afterActivationHistory
afterSourceComplete
afterQueueComplete
beforeCampaignComplete
```

For each hook, assert zero net changes to Product/Snapshot/Membership/Pool/activation request and that a later capture can proceed.

- [ ] **Step 5: Implement Activation orchestration with P0 critical section**

```js
function activateInitialPool(input){
  return activationCoordinator.run(input.campaignId,()=>transaction(db,()=>{
    const campaign=requireExactInitialCampaign(input);
    const replay=initialRepository.findActivationReplay(input.requestId);
    if(replay)return exactActivationReplay(replay,input);
    const existing=initialRepository.findActivationByCampaign(campaign.id);
    if(existing)return exactAlreadyActivatedReplay(existing,input);
    assertNoPoolHistoryForActivation(campaign);
    const current=initialRepository.getCandidateState(campaign.id);
    const qa=initialRepository.getLatestPassedQa(campaign.id);
    if(!qa)throw coded('INITIAL_POOL_QA_REQUIRED');
    if(qa.candidateHash!==current.currentHash||qa.candidateRevision!==current.currentRevision
      ||qa.candidateCount!==current.candidateCount)throw coded('INITIAL_POOL_QA_STALE');
    rerunMandatoryInitialQa({campaign,qa,current});
    return repository.materializeInitialPool({campaign,qaRun:qa,
      candidateItems:initialRepository.listQaCandidateItems(qa.id),requestId:input.requestId});
  }));
}
```

`exactAlreadyActivatedReplay` requires the same Campaign/category/profile and returns the original Pool without inserting a second activation request. A Pool from another Campaign remains `INITIAL_POOL_ALREADY_EXISTS`.

The service owns one coordinator instance. `captureBatch` and `captureExtensionBatch` must call `isActivating(campaign.id)` before `registerBatch`; a held Gate throws `INITIAL_POOL_ACTIVATION_IN_PROGRESS` before batch, staging, context, or ledger writes.

The transaction covers final validation through Product/Snapshot/Membership/Pool/Pool items/activation history/Source/Queue/Campaign completion.

- [ ] **Step 6: Materialize only frozen payload**

For each QA item, parse and validate `activation_payload_json`, create/reuse Product by `(platform,goods_id)`, create Product Snapshot, and create/reuse only the exact Category-scoped membership. Never query staging for business fields.

To satisfy the existing non-null Pool-item staging FK, upsert a staging projection from frozen payload and use only its ID. Missing original staging must not fail.

Activate only collected membership IDs. Do not issue global active-membership or Pool deactivation. Require before commit:

```text
Pool rows == composite identities == goods IDs == QA count
active scoped memberships == QA count
Pool/membership intersection == QA count
previous Pool == none
```

Complete Source/Queue/Campaign only after every data Gate passes.

- [ ] **Step 7: Prove concurrent capture is blocked with zero writes**

At an `afterFinalValidation` hook call capture against the same service. It must return `INITIAL_POOL_ACTIVATION_IN_PROGRESS`; batch/ledger counts remain unchanged; Activation then commits successfully.

- [ ] **Step 8: Run GREEN and Pool regressions**

```bash
node --test test/unit/initial-activation-coordinator.test.mjs test/integration/initial-pool-activation.test.mjs test/integration/multi-category-isolation.test.mjs test/integration/catalog-refresh.test.mjs test/integration/catalog-expansion.test.mjs test/integration/export-multi-category.test.mjs
```

- [ ] **Step 9: Commit Task 7**

```bash
git add -- src/modules/catalog-scale/initial-activation-coordinator.mjs test/unit/initial-activation-coordinator.test.mjs test/integration/initial-pool-activation.test.mjs src/modules/catalog-scale/catalog-campaign-service.mjs src/db/repositories/initial-pool-repository.mjs src/db/repositories/catalog-campaign-repository.mjs
git diff --cached --name-only
git commit -m "feat: atomically activate first Category Pools"
```

---

### Task 8: Initial Operator API and UI

**Files:**
- Create: `test/integration/initial-pool-api.test.mjs`
- Create: `test/unit/initial-pool-ui.test.mjs`
- Modify: `src/server/controllers/catalog-controller.mjs`
- Modify: `src/server/router.mjs`
- Modify: `ui/operator-campaign.js`
- Modify: `ui/app.js`
- Modify: `ui/index.html`
- Modify: `ui/styles.css`
- Modify: `test/unit/operator-campaign-ui.test.mjs`
- Modify: `test/integration/operator-campaign-api.test.mjs`

**Interfaces:**
- Adds `POST /api/catalog/operator/initial-campaigns`.
- Adds `POST /api/catalog/operator/initial-campaigns/:campaign_id/qa-runs`.
- Adds `POST /api/catalog/operator/initial-campaigns/:campaign_id/activate`.
- Extends current Operator context with Initial quantity, live Candidate, QA, and activation state.
- Produces UI builders: `buildInitialCreatePayload`, `buildInitialQaPayload`, `buildInitialActivationPayload`, `initialOperatorViewModel`.

- [ ] **Step 1: Write RED API contract tests**

Use a temporary server/Profile directory. Assert the client cannot submit target, QA result, candidate hash, or Pool count as authority:

```js
test('Initial API creates QA-runs and activates only explicit exact scope',async t=>{
  const f=await initialServerFixture(t);
  const created=await f.post('/api/catalog/operator/initial-campaigns',{
    category_key:f.profile.category_key,category_profile_version:f.profile.category_profile_version,
    campaign_name:'Initial UI',request_id:'create-1',target_count:1
  });
  assert.equal(created.result.target_count,null);
  await f.captureTen(created.result.campaign_id);
  const qa=await f.post(`/api/catalog/operator/initial-campaigns/${created.result.campaign_id}/qa-runs`,{
    campaign_id:created.result.campaign_id,category_key:f.profile.category_key,
    category_profile_version:f.profile.category_profile_version,request_id:'qa-1',qa_passed:true
  });
  assert.equal(qa.result.qa_status,'PASSED_CURRENT');
  const activation=await f.post(`/api/catalog/operator/initial-campaigns/${created.result.campaign_id}/activate`,{
    campaign_id:created.result.campaign_id,category_key:f.profile.category_key,
    category_profile_version:f.profile.category_profile_version,request_id:'activate-1'
  });
  assert.equal(activation.result.pool_count,10);
});
```

Add exact HTTP status/error-code/zero-write tests for wrong category/profile, empty QA, stale QA, QA failure, active Pool race, and activation in progress.

- [ ] **Step 2: Run RED API tests**

```bash
node --test test/integration/initial-pool-api.test.mjs
```

- [ ] **Step 3: Add controller and router endpoints**

Controller resolves the exact Profile from the registry for create/QA/activation, passes only explicit fields to the service, and maps no frontend QA decision.

Router patterns are exact and bounded:

```js
if(request.method==='POST'&&url.pathname==='/api/catalog/operator/initial-campaigns')...
const qa=url.pathname.match(/^\/api\/catalog\/operator\/initial-campaigns\/([^/]+)\/qa-runs$/);
const activate=url.pathname.match(/^\/api\/catalog\/operator\/initial-campaigns\/([^/]+)\/activate$/);
```

- [ ] **Step 4: Write RED UI model tests**

```js
test('Initial view never exposes target or sentinel',()=>{
  const view=initialOperatorViewModel({campaign_type:'initial',quantity_mode:'OPEN_ENDED',
    target_count:null,remaining:null,target_reached:null,live_unique_count:137,qa:{status:'STALE',candidate_count:137},current_candidate_count:180});
  assert.equal(view.modeLabel,'不限数量 / OPEN_ENDED');
  assert.equal(view.currentCount,180);
  assert.equal(view.unreviewedDelta,43);
  assert.equal(view.activationEnabled,false);
  assert.doesNotMatch(JSON.stringify(view),/2147483647/);
});
```

Cover empty, UNBOUND, capturing, QA RUNNING, FAILED, PASSED_CURRENT, STALE, activation in progress, activation success, and capability switch to Expansion.

- [ ] **Step 5: Implement capability-driven UI**

When `initial_pool_available=true`, hide requested-new/target/remaining controls and render:

```text
首次建立商品池
采集模式：不限数量 / OPEN_ENDED
当前已采集：N
[创建首次采集任务]
[运行首池 QA]
[建立首个商品池]
```

QA button is disabled for zero Candidates. Activation is disabled unless `PASSED_CURRENT`. During QA show RUNNING and elapsed time; long execution is not treated as failure. During Activation disable all Initial write buttons.

STALE renders QA coverage, current count, and delta. Failure renders stable error code, failed Gate, and actionable guidance without bypass.

Success renders Pool Version/Category/Count/Activated At/Source Campaign, refreshes Profile capabilities, and switches to existing Expansion controls.

- [ ] **Step 6: Add stable operator error messages**

Add messages for all Initial stable codes, especially `INITIAL_POOL_EMPTY`, `INITIAL_POOL_QA_STALE`, `INITIAL_POOL_QA_REQUIRED`, `INITIAL_POOL_ACTIVATION_IN_PROGRESS`, `INITIAL_POOL_ALREADY_EXISTS`, `INITIAL_POOL_HISTORY_EXISTS`, and `INITIAL_CATEGORY_STATE_INCONSISTENT`. Messages must tell the operator to rerun QA or inspect the Category; none may offer force/repair/bypass.

- [ ] **Step 7: Run GREEN and UI/API regressions**

```bash
node --test test/integration/initial-pool-api.test.mjs test/unit/initial-pool-ui.test.mjs test/unit/operator-campaign-ui.test.mjs test/integration/operator-campaign-api.test.mjs test/unit/operator-campaign-console.test.mjs
node --check ui/app.js
node --check ui/operator-campaign.js
node --check src/server/controllers/catalog-controller.mjs
node --check src/server/router.mjs
```

- [ ] **Step 8: Commit Task 8**

```bash
git add -- test/integration/initial-pool-api.test.mjs test/unit/initial-pool-ui.test.mjs src/server/controllers/catalog-controller.mjs src/server/router.mjs ui/operator-campaign.js ui/app.js ui/index.html ui/styles.css test/unit/operator-campaign-ui.test.mjs test/integration/operator-campaign-api.test.mjs
git diff --cached --name-only
git commit -m "feat: operate first Category Pool from dashboard"
```

---

### Task 9: Final Safety Harness, Full Regression, and Evidence

**Files:**
- Create: `scripts/verify-initial-category-pool-safety.mjs`
- Create: `test/unit/initial-pool-safety-verifier.test.mjs`
- Modify: `package.json`
- Create after GREEN: `docs/superpowers/verification/2026-08-31-initial-category-pool-v1.md`

**Interfaces:**
- Produces command: `npm run qa:initial-pool`.
- Produces JSON Gate report using only a temporary SQLite and fake Category fixture.
- Produces final verification document with exact test commands, results, known-baseline identity, commits, git status, and Final Gates.
- Must not load `TEMU_CONFIG_PATH` or any production database path.

- [ ] **Step 1: Write RED safety-verifier test**

```js
test('safety verifier uses temporary SQLite and reports every required Gate',async()=>{
  const result=await runInitialPoolSafetyVerification({makeFixture:createVerifierFixture});
  assert.equal(result.productionDatabaseWrites,0);
  assert.equal(result.realTemuCaptureStarted,false);
  assert.equal(result.gates.INITIAL_SENTINEL_STORAGE_ONLY,'YES');
  assert.equal(result.gates.INITIAL_SENTINEL_EXPOSED_TO_UI,'NO');
  assert.equal(result.gates.INITIAL_AUTO_STOP_BY_SENTINEL,'NO');
  assert.equal(result.gates.INITIAL_QA_DEPENDS_ON_TARGET,'NO');
  assert.equal(result.gates.EXISTING_TARGET_CAMPAIGNS_UNCHANGED,'YES');
  assert.equal(result.gates.MOTORCYCLE_POOL_UNCHANGED,'YES');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test test/unit/initial-pool-safety-verifier.test.mjs
```

Expected: verifier module is missing.

- [ ] **Step 3: Implement the temporary-only verifier**

The script must create its own temporary directory/database/Profile, seed protected Motorcycle state, exercise Initial create/capture 10/QA/activation, compare fingerprints, and remove the directory in `finally`. Reject `--config`, `TEMU_CONFIG_PATH`, and arbitrary database arguments.

```js
if(process.env.TEMU_CONFIG_PATH||process.argv.includes('--config')){
  throw new Error('Initial safety verifier禁止读取正式配置。');
}
```

Output one JSON object containing Gate names and evidence counts. It must not open Chrome, use network capture, or import Dashboard startup code.

- [ ] **Step 4: Add the package command and run GREEN focused feature tests**

Add:

```json
"qa:initial-pool": "node scripts/verify-initial-category-pool-safety.mjs"
```

Run:

```bash
node --test test/unit/campaign-quantity-policy.test.mjs test/unit/initial-candidate-hash.test.mjs test/unit/initial-pool-qa.test.mjs test/unit/initial-activation-coordinator.test.mjs test/unit/initial-pool-ui.test.mjs test/unit/initial-pool-safety-verifier.test.mjs
node --test test/integration/initial-category-pool-migration.test.mjs test/integration/initial-campaign-create.test.mjs test/integration/initial-candidate-ledger.test.mjs test/integration/initial-manual-capture.test.mjs test/integration/initial-pool-qa.test.mjs test/integration/initial-pool-activation.test.mjs test/integration/initial-pool-api.test.mjs
npm run qa:initial-pool
```

Expected: every new test PASS.

- [ ] **Step 5: Run related regressions**

```bash
node --test test/integration/migrations.test.mjs test/integration/operator-campaign-create.test.mjs test/integration/operator-campaign-api.test.mjs test/integration/catalog-manual-binding.test.mjs test/integration/catalog-rpa.test.mjs test/integration/catalog-refresh.test.mjs test/integration/catalog-expansion.test.mjs test/integration/multi-category-isolation.test.mjs test/integration/classification-multi-category.test.mjs test/integration/export-multi-category.test.mjs test/unit/catalog-manual-passive-runner.test.mjs test/unit/category-profile.test.mjs test/unit/operator-campaign-ui.test.mjs test/unit/operator-campaign-console.test.mjs test/integration/operator-launcher-health.test.mjs
npm run check
```

Expected: all directly related regressions PASS. If an approved baseline failure appears in a touched safety module, stop and determine whether this feature must fix it; do not mechanically waive it.

- [ ] **Step 6: Run the full suite and compare exact failure identities**

```bash
npm test
```

Record each failure's test file, test name, and reason/error class. The result is acceptable only when:

```text
NEW_FEATURE_TESTS = PASS
RELATED_REGRESSION_TESTS = PASS
KNOWN_BASELINE_FAILURES = exact same 7
NEW_FAILURES = 0
```

Seven failures with any identity substitution is a failure.

- [ ] **Step 7: Perform static sentinel and forbidden-operation audit**

```bash
rg -n "2147483647|TARGET_REACHED|remaining|target_count|targetCount" src browser-extension tools ui
rg -n "UPDATE catalog_memberships SET active=0 WHERE active=1|UPDATE catalog_pool_versions SET status='superseded'.*WHERE status='active'" src
git diff --name-only 2dd0e1d..HEAD -- db/migrations
git status --short
```

Every sentinel hit must be persistence/resolver/test-only. Every target hit must be targeted-Campaign-only or semantic-policy output. No global deactivation may exist in the new Initial path. The migration diff list for feature commits must contain only `026_initial_category_pool.sql`; the nine CRLF files remain unstaged working-tree changes.

- [ ] **Step 8: Write the final verification evidence**

Create `docs/superpowers/verification/2026-08-31-initial-category-pool-v1.md` containing:

```text
NEW_FEATURE_TESTS
RELATED_REGRESSION_TESTS
FULL_SUITE
KNOWN_BASELINE_FAILURES exact identities
NEW_FAILURES
Motorcycle before/after fingerprint
Migration rollback evidence
Production access statement
Commit list
Final git status
Every Final Gate from the Design Spec
```

Do not claim `SAFE_FOR_NEW_CATEGORY_INITIAL_10_ROW_DRY_RUN=YES` unless every Gate and regression above has fresh passing evidence.

- [ ] **Step 9: Commit Task 9 evidence and verifier**

```bash
git add -- scripts/verify-initial-category-pool-safety.mjs test/unit/initial-pool-safety-verifier.test.mjs package.json docs/superpowers/verification/2026-08-31-initial-category-pool-v1.md
git diff --cached --name-only
git commit -m "docs: verify Initial Category Pool safety"
```

The cached list must contain exactly those four paths and no migration or production-data path.

## Design-to-Plan Coverage

| Design Spec area | Implementation Task | Verification evidence |
|---|---|---|
| Product/Category identity and first-Pool eligibility | Tasks 3 and 7 | Fake Category plus protected Motorcycle fingerprints |
| Initial campaign type and migration compatibility | Task 1 | Empty/historical/rollback migration tests |
| Sentinel storage-only quantity semantics | Task 2 | Resolver unit tests and static leakage audit |
| Atomic Initial creation and Profile capabilities | Task 3 | Zero-write conflict/idempotency/capability tests |
| Open-ended Manual Bind capture | Task 5 | 10/100/1000, Page Health, binding, and no-auto-stop tests |
| Live Candidate ledger independent of staging | Task 4 | Deterministic hash/revision/staging-cleanup tests |
| Immutable QA snapshot and mandatory Gates | Task 6 | Table-driven Gate tests, timing, PASS/STALE tests |
| P0 Activation/capture mutual exclusion | Task 7 | Coordinator/concurrent-capture/rollback hooks |
| Frozen-payload category-scoped materialization | Task 7 | Missing-staging, same Product/two memberships, Pool intersection tests |
| Explicit QA/Activation APIs and Operator UI | Task 8 | API authority rejection and UI state/disabled-button tests |
| Taxonomy separation | Tasks 3, 6, and 7 | Exact capability registry and Raw Pool/classification-blocked test |
| Historical target Campaign regression | Tasks 1, 2, and 9 | Refresh/Expansion and paused 1208/2000 equality |
| Full suite, exact seven baseline failures, Final Gates | Task 9 | Temporary safety verifier and committed verification evidence |

Self-review result:

```text
SPEC_REQUIREMENTS_WITHOUT_TASK = 0
PLAN_PLACEHOLDERS = 0
INTERFACE_NAME_CONFLICTS = 0
DESIGN_TO_PLAN_COVERAGE = PASS
```

## Final Handoff Format

After Task 9, return:

```text
WORKTREE
BRANCH
TASK COMMITS 1–9
NEW_FEATURE_TESTS
RELATED_REGRESSION_TESTS
FULL_SUITE
KNOWN_BASELINE_FAILURES
NEW_FAILURES
GIT STATUS

INITIAL_SENTINEL_STORAGE_ONLY = YES / NO
INITIAL_SENTINEL_EXPOSED_TO_UI = YES / NO
INITIAL_AUTO_STOP_BY_SENTINEL = YES / NO
INITIAL_QA_DEPENDS_ON_TARGET = YES / NO
EXISTING_TARGET_CAMPAIGNS_UNCHANGED = YES / NO
INITIAL_POOL_QA_UI_READY = YES / NO
INITIAL_POOL_ACTIVATION_BUTTON_READY = YES / NO
ACTIVATION_REQUIRES_EXPLICIT_OPERATOR_ACTION = YES / NO
ACTIVATION_CATEGORY_SCOPED = YES / NO
ACTIVATION_IDEMPOTENT = YES / NO
ACTIVATION_CAPTURE_MUTEX = PASS / FAIL
ACTIVATION_TRANSACTION_ROLLBACK = PASS / FAIL
QA_FAILURE_CANNOT_BE_BYPASSED = YES / NO
QA_STALE_BLOCKS_ACTIVATION = YES / NO
FROZEN_PAYLOAD_IS_ACTIVATION_SOURCE = YES / NO
INITIAL_OPEN_ENDED_CAPTURE = YES / NO
INITIAL_MINIMUM_COUNT_REQUIRED = YES / NO
INITIAL_TARGET_REQUIRED = YES / NO
SINGLE_DASHBOARD_PROCESS_REQUIRED = YES / NO
MOTORCYCLE_POOL_UNCHANGED = YES / NO
PRODUCTION_DATABASE_WRITES = 0 / NONZERO
REAL_TEMU_CAPTURE_STARTED = YES / NO
NEW_FAILURES = 0 / NONZERO
SAFE_FOR_NEW_CATEGORY_INITIAL_10_ROW_DRY_RUN = YES / NO
```

Do not push. Do not run a real Temu dry run in this implementation plan.
