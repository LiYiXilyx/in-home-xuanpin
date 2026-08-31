# Initial Category Pool V1 Design Spec

**Status:** APPROVED

**Date:** 2026-08-31

**Scope:** Germany / English / EUR + Multi-Category
**Implementation status:** DESIGN ONLY — NOT IMPLEMENTED

## 1. Objective

Initial Category Pool V1 adds a safe operator workflow for a Category that has never had a formal Pool:

```text
Create Initial Campaign
→ manually detect and bind a healthy Temu Category page
→ manually capture as many products as the operator chooses
→ explicitly run Initial Pool QA
→ freeze and evaluate an immutable candidate snapshot
→ enable activation only when every mandatory Gate passes
→ operator explicitly clicks “建立首个商品池”
→ atomically materialize and activate the Category's first Active Pool
```

The system does not choose the product quantity. It enforces Category/Campaign isolation, Manual Bind safety, identity uniqueness, deterministic QA, and explicit category-scoped activation.

## 2. Non-goals and Safety Boundary

This version does not:

- repair the existing Motorcycle Active Pool or memberships;
- modify, resume, or reuse the paused 1208/2000 Campaign;
- classify a new Category with the Motorcycle taxonomy;
- implement a new taxonomy, Classification pipeline, or Opportunity pipeline;
- implement Multi-Country or Multi-Currency;
- implement YingDao export;
- implement automatic scrolling, navigation, pagination, See more clicking, category/sort switching, or CAPTCHA handling;
- run a real 100-row capture or any real Temu capture;
- add a distributed lock for multiple Dashboard processes;
- optimize SQLite integrity-check performance;
- modify old migration files or their recorded checksums.

Implementation and tests must use temporary SQLite, fixtures, or an explicit copied database. Production SQLite remains read-only.

## 3. Core Invariants

### 3.1 Product identity remains unchanged

```text
product identity = platform + goods_id
```

Category never enters Product identity. The same Product may have independent memberships in Motorcycle and another Category.

### 3.2 Category and Campaign identity are explicit

Every Initial operation requires exact:

```text
campaign_id
category_key
category_profile_version
```

Creation and Activation additionally require `request_id`. No latest Campaign, target, control mode, display name, or text matching may be used to infer identity or resume work.

### 3.3 Initial capture is open-ended

```text
INITIAL business target = NONE
baseline = 0
quantity_mode = OPEN_ENDED
capture_limit = null
```

The operator decides how many products to capture and when to run QA. Initial has no `requested_initial_count`, `minimum_initial_pool_count`, `TARGET_REACHED`, or `remaining_to_target` Gate.

The following are all valid:

```text
10 → QA → first Pool of 10
87 → QA → first Pool of 87
137 → QA → first Pool of 137
500 → QA → first Pool of 500
```

The only quantity-related QA rejection is an empty candidate set.

### 3.4 Target reached is never activation

Initial has no target-reached event. For every Campaign type:

```text
capture progress != Pool activation
```

Initial Pool activation always requires a current mandatory QA PASS and an explicit operator click.

## 4. Quantity Persistence Compatibility

`catalog_campaigns.target_count` is currently `NOT NULL CHECK(target_count > 0)`. V1 retains this schema shape and stores:

```text
campaign_type = initial
target_count = 2147483647
baseline_pool_count = 0
```

The sentinel `2147483647` is persistence compatibility only. Initial creation freezes:

```json
{
  "quantityMode": "OPEN_ENDED",
  "captureLimit": null,
  "targetCountStorage": {
    "kind": "LEGACY_NOT_NULL_SENTINEL",
    "value": 2147483647
  }
}
```

### 4.1 Central quantity resolver

All business consumers must use one centralized semantic resolver, equivalent to:

```text
getCampaignQuantityPolicy(campaign)
```

For `campaign_type=initial`, it returns:

```json
{
  "quantity_mode": "OPEN_ENDED",
  "capture_limit": null,
  "business_target": null,
  "remaining": null,
  "target_reached": null
}
```

It must HARD FAIL when an Initial Campaign has malformed or inconsistent `quantityMode`, `captureLimit`, or sentinel metadata. It must not silently infer an Initial Campaign from the sentinel.

`target_count=2147483647` on a non-Initial Campaign retains that Campaign type's normal target semantics.

No module may scatter checks such as:

```text
if target_count == 2147483647 then Initial
```

The sentinel must never be exposed through Operator UI, Extension context, public Service/API models, operating-status logs, QA summaries, Excel, or reports. Initial public models return:

```text
target_count = null
remaining = null
target_reached = null
```

## 5. Campaign and Profile Capabilities

The Profile API separates configuration validity from workflow capabilities:

```json
{
  "profile_valid": true,
  "expansion_available": false,
  "initial_pool_available": true,
  "classification_available": false,
  "opportunity_available": false
}
```

- `profile_valid` means the Category Profile, DE/en/EUR context, Top Sales source, membership scope, and explicit taxonomy bindings are structurally valid.
- `expansion_available` requires exactly one nonempty, internally consistent Active Pool.
- `initial_pool_available` requires proof that the Category has never had a formal Pool.
- Classification and Opportunity availability require the bound pipeline implementation in addition to valid bindings.

Missing taxonomy bindings or scope mismatch invalidates the Profile and HARD FAILS. A valid binding whose implementation is not ready does not block Raw Pool activation:

```text
Raw Active Pool = READY
Classification = BLOCKED
Opportunity = BLOCKED
```

There is never fallback to the Motorcycle taxonomy.

## 6. Proving Initial Category Eligibility

Initial eligibility is evaluated inside the creation transaction using exact Category identity:

```text
catalog_pool_versions.category_key = requested category_key
```

`display_name`, breadcrumb text, subcategory text, and fuzzy matching are prohibited.

The Category must have:

```text
zero Pool history across every profile version
zero explicitly scoped active memberships
no other non-terminal Initial Campaign for the Category
no category/profile identity conflict
```

Changing `category_profile_version` does not reset Pool history. Any formal Pool row for the same `category_key`, including active, ready, draft, superseded, or QA-failed history, prevents a new “first Pool” flow.

Stable errors include:

```text
INITIAL_POOL_ALREADY_EXISTS
INITIAL_POOL_HISTORY_EXISTS
INITIAL_CATEGORY_STATE_INCONSISTENT
```

New Categories may not use the Motorcycle legacy-membership compatibility resolver. Global `category_key IS NULL` memberships are not guessed to belong to the new Category.

## 7. Initial Campaign Creation

### 7.1 API

```text
POST /api/catalog/operator/initial-campaigns
```

Request:

```json
{
  "category_key": "new-category",
  "category_profile_version": "new-category-v1",
  "campaign_name": "New Category Initial Capture",
  "request_id": "uuid"
}
```

There is no requested count, target, minimum, or capture limit in the request.

### 7.2 Idempotency

The same `request_id` returns the same Campaign only when every creation parameter is identical. A parameter mismatch returns:

```text
OPERATOR_CREATE_IDEMPOTENCY_CONFLICT
```

`request_id` is not resume and cannot resolve a latest or unrelated Campaign.

### 7.3 Atomic creation

One transaction performs:

```text
resolve and validate exact Category Profile
→ revalidate Initial eligibility
→ reject active RPA queue conflict
→ create Initial Campaign
→ freeze resolved taxonomy bindings
→ record an explicit baseline=0 empty-category audit
→ create one manual Category Source
→ create and claim its Queue
→ create Source Run
→ write UNBOUND checkpoint
→ establish explicit current Operator context
```

An active queue conflict returns `CATALOG_RPA_CLAIM_CONFLICT` with zero writes. Creation never cancels, deletes, resumes, or modifies another Campaign.

`catalog_sources.target_quota` currently allows NULL and Initial stores:

```text
source.target_quota = NULL
```

The Initial checkpoint contains:

```json
{
  "runner_state": "UNBOUND",
  "capture_mode": "MANUAL_BIND_PASSIVE_CAPTURE",
  "quantity_mode": "OPEN_ENDED",
  "capture_limit": null,
  "capture_paused": true,
  "automatic_scroll": false,
  "automatic_navigation": false,
  "automatic_pagination": false,
  "automatic_see_more": false,
  "automatic_category_switching": false,
  "automatic_sort_switching": false,
  "automatic_captcha_handling": false,
  "direct_api": false
}
```

It does not contain `session_target` or `remaining`.

## 8. Manual Bind Passive Capture

Initial reuses `MANUAL_BIND_PASSIVE_CAPTURE` without weakening it:

```text
operator opens a healthy Temu Category page
→ detects the current page
→ explicitly binds it to the current Campaign
→ manually scrolls or clicks See more
→ manually clicks capture current page
```

Required Page Health evidence includes:

```text
Germany
English
EUR
exact Category
Top Sales
product list exists
not SEARCH_NO_RESULTS
not CAPTCHA blocking
DOM or Network READY
```

Page context changes invalidate the binding. Unbound or unhealthy capture produces zero writes.

The Extension consumes only explicit server current context and receives:

```json
{
  "campaign_type": "initial",
  "quantity_mode": "OPEN_ENDED",
  "capture_limit": null,
  "target_count": null,
  "remaining": null,
  "target_reached": null
}
```

Server-side capture Gate order is:

```text
exact Campaign identity
→ valid Initial quantity policy
→ non-terminal Campaign
→ activation mutex not held
→ Queue/claim/current-context match
→ valid page binding
→ Page Health PASS
→ category/profile/source context match
→ register idempotent batch
```

Every Gate before batch registration must fail with zero writes.

Initial capture never compares the sentinel, slices to a target, emits `TARGET_REACHED`, completes, pauses, or stops accepting products because of quantity.

## 9. Persisted Batch Context Evidence

Existing capture batches do not persist the complete Page Health and binding evidence required for Initial QA. V1 adds Initial batch-context evidence, written atomically with each accepted Initial batch:

```text
campaign_id
source_id
batch_id
capture_mode
site_country
language
currency
category_key
category_profile_version
sort_order
page_url
binding_version
binding_fingerprint
page_health_status
dom_ready
network_ready
captcha_blocking
search_no_results
context_json
created_at
```

Every Candidate item must trace to exactly one matching Campaign/Source/Batch evidence record.

## 10. Initial Live Candidate Ledger

Initial business state must not depend on the retention lifetime of `catalog_staging_products`. V1 therefore maintains an authoritative, Campaign-scoped live Candidate ledger:

```text
catalog_initial_pool_candidate_state
catalog_initial_pool_candidate_items
```

The state row records:

```text
campaign_id
category_key
category_profile_version
current_revision
current_hash
candidate_count
candidate_hash_version
normalization_version
field_set_version
updated_at
```

Each live Candidate item records its current normalized `activation_payload_json`, identity, scope, row hash, Source/Batch provenance, and an optional audit-only staging ID.

An accepted Initial capture batch updates staging evidence, batch-context evidence, the live Candidate ledger, and mirrored Campaign counts in the same transaction. A change to the normalized activation payload advances the ledger revision and recomputes the deterministic hash. An identical replay does not.

For Initial Campaigns:

```text
authoritative live_unique_count = live Candidate ledger count
catalog_campaigns.non_electronic_unique_count = compatibility mirror
```

QA copies the live ledger into an immutable QA snapshot. Activation compares the current ledger revision/hash/count with the latest PASS QA snapshot. Neither operation reconstructs candidate state from live staging.

Maintenance cleanup or archival of staging does not alter the live Candidate ledger and therefore does not make QA stale by itself. A later accepted capture that changes an activation payload does make QA stale.

## 11. Candidate State and Immutable QA Snapshot

The quantity model is:

```text
live_unique_count
  current unique eligible products in the Initial Campaign

qa_candidate_count
  number frozen when the operator runs QA

qa_candidate_revision/hash
  exact deterministic version of the frozen activation payload

activated_pool_count
  number in the latest current PASS snapshot activated as the first Pool
```

QA creates immutable audit data only. It does not create Product, Product Snapshot, Membership, or Pool rows.

New persistence includes:

```text
catalog_initial_pool_candidate_state
catalog_initial_pool_candidate_items
catalog_initial_pool_qa_runs
catalog_initial_pool_qa_candidate_items
catalog_initial_pool_batch_contexts
catalog_initial_pool_activation_requests
```

### 11.1 QA run fields

```text
id
campaign_id
category_key
category_profile_version
request_id
status
candidate_count
candidate_revision
candidate_hash
candidate_hash_version
normalization_version
field_set_version
mandatory_passed
checks_json
failure_codes_json
started_at
completed_at
duration_ms
created_at
```

Gate durations should be recorded in `checks_json`; total `duration_ms` is mandatory.

### 11.2 Candidate item fields

Each item freezes at least:

```text
qa_run_id
ordinal
staging_product_id (audit only)
platform
goods_id
category_key
category_profile_version
title
source_url
canonical_url
image_url
price_amount
currency
sales_count
rating
review_count
listing_rank
electronic_screening_status
business_eligible
reviewable
quality_status
source_id
first_batch_id
activation_payload_json
row_hash
```

Required uniqueness:

```text
UNIQUE(qa_run_id, platform, goods_id)
UNIQUE(qa_run_id, ordinal)
```

`staging_product_id` is audit evidence only and must not create a dependency that prevents staging cleanup.

## 12. Deterministic Candidate Hash

V1 freezes:

```text
candidate_hash_version = v1
normalization_version = v1
field_set_version = initial-pool-activation-v1
sorting = platform ASC, goods_id ASC
serialization = deterministic canonical JSON
encoding = UTF-8
algorithm = SHA-256
```

The hash covers the complete business payload Activation will materialize. It excludes object insertion order, local timezone, runtime timestamps, auto-increment IDs, `last_seen_at`, and other nondeterministic/non-business values.

Candidate revision changes only when the activation payload changes, including a new/removed eligible product or changed business/screening field. Idempotent batch replay, identical normalized data, or timestamp-only changes do not change revision/hash.

Every QA run saves its hash versions. Activation verifies using the QA run's version. Unsupported versions HARD FAIL with:

```text
INITIAL_POOL_HASH_VERSION_UNSUPPORTED
```

Future code may not reinterpret an old QA run with a newer hash rule.

## 13. Initial QA State Model

Initial Campaign remains `running` while QA occurs so manual capture can continue. Initial QA has its own authoritative state:

```text
NOT_RUN
RUNNING
FAILED
PASSED_CURRENT
STALE
```

`STALE` is derived when the latest completed QA's candidate revision/hash differs from current candidate state.

The existing `catalog_campaigns.qa_status` supports only `pending/passed/failed` and remains a compatibility mirror:

- current PASS maps to `passed`;
- current failure maps to `failed`;
- candidate mutation after a result maps back to `pending`;
- Initial APIs/UI derive the authoritative state from Initial QA runs.

QA snapshot creation is a short transaction. QA evaluates that immutable snapshot after it is committed. Capture may continue during or after QA. If candidate state changes, the historical result remains recorded but public status is immediately `STALE` and activation is disabled.

## 14. QA API and Idempotency

```text
POST /api/catalog/operator/initial-campaigns/:campaign_id/qa-runs
```

Request:

```json
{
  "campaign_id": "...",
  "category_key": "...",
  "category_profile_version": "...",
  "request_id": "uuid"
}
```

The server computes candidate count/hash and Gate results. It never accepts frontend `qa_passed`, candidate count/hash, coverage, or Gate results.

The same QA `request_id` returns the same run only when request identity and candidate revision/hash are identical. Otherwise it returns `INITIAL_QA_REQUEST_CONFLICT`. A deliberate new QA run uses a new request ID.

An empty candidate returns `INITIAL_POOL_EMPTY`. There is no nonzero minimum.

## 15. Mandatory QA Gates

Initial QA reuses existing authoritative field-coverage, SQLite, scope, and identity primitives where applicable. It must not create a weaker parallel interpretation.

Every Gate below is mandatory:

| Gate | Requirement | Stable failure code |
|---|---|---|
| Campaign identity | Initial type and exact Campaign/category/profile | `INITIAL_CAMPAIGN_IDENTITY_INVALID` |
| Quantity policy | Valid OPEN_ENDED config; sentinel storage only | `INITIAL_QUANTITY_POLICY_INVALID` |
| Nonempty candidate | Candidate count greater than zero | `INITIAL_POOL_EMPTY` |
| Product identity | Valid `platform + goods_id` | `INITIAL_PRODUCT_IDENTITY_INVALID` |
| Uniqueness | Row/composite identity/Temu goods_id counts agree | `INITIAL_GOODS_ID_DUPLICATE` |
| Category scope | Candidate ledger, frozen scope, Source, and Batch agree; staging is optional audit evidence | `INITIAL_CATEGORY_SCOPE_MISMATCH` |
| Profile scope | Frozen Campaign profile version agrees | `INITIAL_PROFILE_SCOPE_MISMATCH` |
| Membership isolation | No foreign Category membership collision | `INITIAL_MEMBERSHIP_CONTAMINATION` |
| Initial eligibility | No Pool history or scoped active memberships | `INITIAL_POOL_ALREADY_EXISTS` / `INITIAL_CATEGORY_STATE_INCONSISTENT` |
| Market context | DE/en/EUR for every accepted batch | `INITIAL_MARKET_CONTEXT_INVALID` |
| Source context | Category page, Top Sales, Manual Bind | `INITIAL_SOURCE_CONTEXT_INVALID` |
| Page Health | Not blocked/no-results; DOM or Network READY | `INITIAL_PAGE_HEALTH_INVALID` |
| Binding evidence | Exact Campaign/Source/URL/context fingerprint | `INITIAL_BINDING_EVIDENCE_INVALID` |
| Required fields | Identity, scope, currency, and URL evidence present | `INITIAL_REQUIRED_FIELDS_MISSING` |
| Electronic exclusion | No excluded/manual-review-required candidate | `INITIAL_ELECTRONIC_GATE_FAILED` |
| Data quality | Code floor and any stricter Profile thresholds pass | `INITIAL_DATA_QUALITY_FAILED` |
| Batch consistency | Every Candidate traces to its Campaign/Source/Batch | `INITIAL_BATCH_CONSISTENCY_FAILED` |
| No ambiguity | No ambiguous membership/scope resolution | `INITIAL_MEMBERSHIP_AMBIGUOUS` |
| Cross Category | No foreign Candidate/membership/Pool item; any retained staging evidence also agrees | `INITIAL_CROSS_CATEGORY_CONTAMINATION` |
| SQLite integrity | `PRAGMA integrity_check` returns `ok` | `SQLITE_INTEGRITY_FAILED` |
| Foreign keys | `PRAGMA foreign_key_check` returns no rows | `SQLITE_FOREIGN_KEY_FAILED` |
| Taxonomy binding | Frozen bindings are complete and scope-correct | `TAXONOMY_BINDING_INVALID` |

Code-level minimum field coverage is:

```text
title >= 95%
price >= 95%
image >= 95%
sales >= 90%
rating >= 90%
review_count >= 90%
```

A Category Profile may only tighten these floors. Quantity is not a QA threshold.

`integrity_check` and `foreign_key_check` are database-level operations and may take longer as the database grows. UI must show `RUNNING`; V1 must not convert a long duration into an automatic QA failure. Performance optimization is deferred.

## 16. Activation API

```text
POST /api/catalog/operator/initial-campaigns/:campaign_id/activate
```

Request:

```json
{
  "campaign_id": "...",
  "category_key": "...",
  "category_profile_version": "...",
  "request_id": "uuid"
}
```

The server reruns mandatory safety evaluation and never trusts frontend QA state.

Activation requires:

```text
Initial Campaign identity exact
Category still has zero Pool history
latest QA mandatory PASS
current candidate revision/hash == latest PASS revision/hash
current candidate count == latest PASS count
```

A mismatch returns `INITIAL_POOL_QA_STALE` and creates no Pool.

### 16.1 Activation idempotency

Activation request persistence records:

```text
request_id
campaign_id
category_key
category_profile_version
qa_run_id
candidate_revision
candidate_hash
parameters_hash
pool_version_id
created_at
```

- Same request ID and identical parameters returns the original Pool.
- Same request ID and different parameters returns `INITIAL_ACTIVATION_IDEMPOTENCY_CONFLICT`.
- A Campaign already activated by itself returns its same Pool and never creates a second one.
- A Pool created by another Campaign returns `INITIAL_POOL_ALREADY_EXISTS`.
- `catalog_pool_versions.campaign_id UNIQUE` is a second database uniqueness Gate.

## 17. P0 Activation/Capture Concurrency Gate

Activation and capture must be mutually exclusive across the critical section:

```text
final candidate validation
→ materialization
→ Active Pool creation
→ membership activation
→ Source/Queue completion
→ Campaign completion
```

V1 uses two layers:

```text
campaign-scoped application mutex
+
one SQLite write transaction
```

The mutex is acquired before the Activation transaction. Capture checks it before any write and returns:

```text
INITIAL_POOL_ACTIVATION_IN_PROGRESS
0 writes
```

Inside the single transaction, Activation recomputes current candidate count/revision/hash, verifies the latest PASS snapshot, materializes only that snapshot, activates the Pool/memberships, and closes Source/Queue/Campaign.

Any exception rolls back the entire transaction. The mutex is released in `finally`, leaving the Campaign able to continue capture when activation failed before commit. Success makes the Campaign terminal, so later capture is permanently blocked.

```text
SINGLE_DASHBOARD_PROCESS_REQUIRED = YES
```

The application mutex is not a distributed lock. V1 relies on the existing Launcher single-instance Dashboard plus SQLite transaction atomicity. Multiple Dashboard processes sharing one SQLite require a future database claim/lease design.

## 18. Frozen Payload Materialization

Activation's sole business input is the latest current PASS QA snapshot:

```text
activation_payload_json
platform + goods_id
category/profile scope
candidate revision/hash
```

It must not reread live staging to reconstruct Product, Snapshot, Membership, or Pool business data.

The current `catalog_pool_version_items.staging_product_id` is a required legacy foreign key. Activation therefore creates or refreshes a staging projection from the frozen payload inside the transaction and uses the resulting ID solely as a persistence adapter:

```text
frozen QA payload
→ staging projection
→ existing Pool item foreign key
```

The original live staging row may have changed, been archived, or been deleted. Activation still succeeds from the frozen payload when that QA run remains the current legitimate PASS snapshot.

## 19. Category-scoped Materialization

Activation atomically performs:

```text
QA Candidate Items
→ products
→ product_snapshots
→ scoped memberships
→ catalog_pool_version_items
→ first Active Pool
```

Product reuse is by `platform + goods_id`. Membership lookup and creation use the complete frozen Category scope. A Product already in Motorcycle keeps that membership and gains a separate membership for the new Category.

Only membership IDs created/resolved for the current Candidate and Category are activated. Global membership deactivation is forbidden. Initial does not deactivate another Category's Pool or memberships.

The new Pool records:

```text
category_key = Initial Campaign Category
category_profile_version = frozen Campaign Profile
product_count = latest PASS candidate count
status = active
previous_pool_version_id = null
source_campaign_id = Initial Campaign
```

Before commit:

```text
Pool row count
== distinct(platform + goods_id)
== distinct Temu goods_id
== candidate count
== active scoped membership count
== Pool/membership intersection count
```

Any mismatch rolls back everything.

## 20. Activation Completion and Capability Switch

The Activation transaction finishes:

```text
Pool active
→ Source completed
→ Queue completed/closed
→ claim closed
→ Campaign completed
→ compatibility qa_status=passed
→ Operator context marked complete
```

Subsequent capture returns a terminal Initial Campaign error with zero writes.

Profile capability then becomes:

```text
initial_pool_available = false
expansion_available = true
active_pool_count = activated_pool_count
```

The UI switches from “首次建立商品池” to the existing “新增采集” flow. Classification and Opportunity remain blocked when their bound implementations are unavailable.

## 21. Operator UI

For an eligible Category with no Pool:

```text
首次建立商品池
当前已采集：0
状态：等待页面绑定
[创建首次采集任务]
```

During capture:

```text
当前已采集：137
采集模式：不限数量 / OPEN_ENDED
状态：采集中，可继续采集
[运行首池 QA]
```

It must not display a target input, `137 / 2147483647`, remaining count, or TARGET_REACHED.

The UI displays QA states `NOT_RUN`, `RUNNING`, `FAILED`, `PASSED_CURRENT`, and `STALE`. For example:

```text
QA覆盖：137
当前：180
新增未QA：43
状态：STALE
```

“运行首池 QA” is disabled only when the live Candidate is empty or another incompatible operation is in progress. “建立首个商品池” is disabled by default and enabled only for `PASSED_CURRENT`.

QA failures show the failed Gate, stable error code, and actionable guidance. There is no force/bypass control.

Activation success shows:

```text
首个商品池已建立
Pool Version
Category
Count
Activated At
Source Campaign
```

## 22. Migration Design

Implementation creates a new migration only:

```text
db/migrations/026_initial_category_pool.sql
```

It:

- adds only `initial` to the existing `catalog_campaigns.campaign_type` CHECK;
- preserves `smoke`, `refresh`, `expansion`, and `test` semantics;
- adds Initial live Candidate ledger, QA snapshot, batch-context, and activation-idempotency tables/indexes;
- does not update historical Campaign rows;
- does not modify old migration files or checksums;
- does not include the nine CRLF migration diffs in feature commits.

SQLite cannot alter an existing CHECK directly, so the controlled table rebuild must preserve every historical column, value, index, and foreign-key relationship. The migration is atomic and records migration 026 only after all schema/data/foreign-key verification succeeds.

## 23. TDD Matrix

Implementation follows strict per-Task RED → minimal implementation → GREEN → related regression → commit.

### 23.1 Migration

- Empty database applies all migrations and accepts Initial.
- Historical fixtures preserve all four old Campaign types.
- Paused 1208/2000 Campaign, checkpoint, target, status, Source, Queue, and claims are unchanged.
- Pool, membership, and foreign-key references remain identical.
- `integrity_check=ok` and `foreign_key_check` returns no rows.
- Injected rebuild/copy/index/verification failures fully roll back and do not record migration 026.
- Existing migration bytes/checksums remain unchanged.

### 23.2 Quantity policy

- Initial sentinel resolves only to OPEN_ENDED through the centralized resolver.
- Initial capture remains allowed at 10, 100, and 1000.
- Initial public `target_count`, `remaining`, and `target_reached` are null.
- Malformed Initial quantity config HARD FAILS.
- Sentinel on a non-Initial Campaign does not imply OPEN_ENDED.
- Refresh/Expansion target behavior remains unchanged.
- Sentinel leakage tests cover UI, API, Extension, QA, logging, and reports.

### 23.3 Creation and isolation

- Eligible fake Category creates an atomic Initial Campaign with baseline zero, NULL source quota, claimed Queue, and UNBOUND checkpoint.
- Pool history, scoped active memberships, active RPA conflict, and identity mismatch each HARD FAIL with zero writes.
- Creation request idempotency is exact.
- Motorcycle Pool/memberships/Campaigns and paused 1208/2000 Campaign remain unchanged.

### 23.4 Manual Bind capture

- Unbound capture produces zero writes.
- Every Page Health failure produces zero writes.
- Page context changes invalidate binding.
- Repeated batch and goods identity handling are idempotent.
- All automatic browser controls remain off.
- No sentinel-triggered stop, pause, completion, or target event occurs.
- Every accepted Initial batch has exact persisted context evidence.
- Accepted capture atomically updates the live Candidate ledger and Campaign count mirror.
- Staging cleanup does not change the live Candidate ledger, candidate hash, or current QA state.

### 23.5 Candidate hash

- JSON key order, input order, local timezone, and `last_seen_at` do not alter the hash.
- Business-field or eligible-set changes alter revision/hash.
- Identical data does not alter revision/hash.
- Unsupported hash version HARD FAILS.

### 23.6 QA

- Empty Candidate is blocked; 1, 10, 87, 137, and 500 are allowed.
- Candidate snapshot remains readable after live staging deletion/change.
- Every mandatory Gate has table-driven PASS/FAIL/error-code tests.
- QA state covers NOT_RUN/RUNNING/FAILED/PASSED_CURRENT/STALE.
- Continued capture after PASS makes QA STALE; identical repeated data does not.
- QA duration is recorded and a long run is not automatically failed.
- QA request idempotency is exact.

### 23.7 Activation

- Missing explicit identity fields HARD FAIL.
- Frontend QA claims are ignored; server revalidates.
- Current PASS activates; stale hash/count creates no Pool.
- Same request returns the same Pool; mismatched replay conflicts.
- Repeated click never creates a second Pool.
- Activation concurrent capture is blocked before any capture write.
- Candidate mutation before final validation returns `INITIAL_POOL_QA_STALE` and releases the mutex.
- Fault injection at Product, Snapshot, Membership, Pool, Pool item, activation history, Source, Queue, and Campaign phases proves full rollback and recoverability.
- Activation succeeds from frozen payload after original staging removal.

### 23.8 Category and UI isolation

- Same Product supports two independent Category memberships.
- Category B activation does not change Motorcycle Pool, memberships, Campaigns, snapshots, or activation history.
- SQL assertions prohibit global membership/Pool deactivation.
- UI covers empty, capturing, QA running/failure/pass/stale, activation, success, and Expansion switch.
- Classification/Opportunity remain blocked without their Category-specific implementation.

## 24. Regression and Baseline Policy

All new feature tests and related regressions must pass:

```text
NEW_FEATURE_TESTS = PASS
RELATED_REGRESSION_TESTS = PASS
NEW_FAILURES = 0
```

The approved baseline remains exactly seven failures. Comparison uses the exact tuple:

```text
test file
test name
failure reason / error class
```

An equal count with a changed failure identity is not acceptable.

Related regressions include Campaign/resume/checkpoint/membership/materialization/Pool/baseline/classification/taxonomy/legacy resolver/Excel/Manual Bind/Operator Create/Launcher safety and existing Refresh/Expansion target behavior.

## 25. Motorcycle and Production Protection

Temporary fixtures snapshot protected Motorcycle state before and after every Initial scenario:

```text
Active Pool ID and items
active memberships
Campaign rows
paused 1208/2000 checkpoint
snapshots
activation history
```

They must remain identical.

Production database checks are read-only. This feature does not apply migration 026, create a Campaign, run Initial QA, activate a Pool, repair Active Pool consistency, or start capture against production during implementation.

The existing blocker remains untouched:

```text
Active Pool = 2135
Active Memberships = 1149
baseline_consistency = false
Profile available = false
```

## 26. Final Verification Gates

Implementation is not complete unless it reports:

```text
INITIAL_SENTINEL_STORAGE_ONLY = YES
INITIAL_SENTINEL_EXPOSED_TO_UI = NO
INITIAL_AUTO_STOP_BY_SENTINEL = NO
INITIAL_QA_DEPENDS_ON_TARGET = NO
EXISTING_TARGET_CAMPAIGNS_UNCHANGED = YES

INITIAL_POOL_QA_UI_READY = YES
INITIAL_POOL_ACTIVATION_BUTTON_READY = YES
ACTIVATION_REQUIRES_EXPLICIT_OPERATOR_ACTION = YES
ACTIVATION_CATEGORY_SCOPED = YES
ACTIVATION_IDEMPOTENT = YES
ACTIVATION_CAPTURE_MUTEX = PASS
ACTIVATION_TRANSACTION_ROLLBACK = PASS
QA_FAILURE_CANNOT_BE_BYPASSED = YES
QA_STALE_BLOCKS_ACTIVATION = YES
FROZEN_PAYLOAD_IS_ACTIVATION_SOURCE = YES

INITIAL_OPEN_ENDED_CAPTURE = YES
INITIAL_MINIMUM_COUNT_REQUIRED = NO
INITIAL_TARGET_REQUIRED = NO
SINGLE_DASHBOARD_PROCESS_REQUIRED = YES

MOTORCYCLE_POOL_UNCHANGED = YES
PRODUCTION_DATABASE_WRITES = 0
REAL_TEMU_CAPTURE_STARTED = NO
NEW_FAILURES = 0

SAFE_FOR_NEW_CATEGORY_INITIAL_10_ROW_DRY_RUN = YES / NO
```

The final dry-run Gate means only that the system is safe for a future explicit operator-controlled 10-row dry run. It does not authorize or imply that this design or implementation phase started real Temu capture.

## 27. Approved Design Gate

```text
DESIGN_SECTION_1 = APPROVED
DESIGN_SECTION_2 = APPROVED
DESIGN_SECTION_3 = APPROVED
DESIGN_SECTION_4 = APPROVED

DESIGN_GATE = PASS
SPEC_ADJUSTMENT_REQUIRED = NO
```
