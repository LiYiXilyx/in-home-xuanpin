# Operator Campaign Create UI V1 Design

## 1. Purpose

Operator Campaign Create UI V1 removes the normal operator dependency on the `catalog:manual-passive` CLI. An operator opens the existing localhost console, selects a validated Category Profile, enters only the number of new products requested, and creates a new explicitly scoped Manual Bind campaign. The server calculates the total Campaign target, freezes the selected Category/Profile and current Active Pool baseline, claims the new Campaign's queue, and makes that exact Campaign available to the browser extension.

This feature preserves the Multi-Category Safety Foundation V1 invariants. It does not add automatic navigation, scrolling, pagination, See more clicking, CAPTCHA handling, collection, Campaign resume, Pool activation, or initial Category Pool creation.

## 2. Scope

### In scope

- Discover and validate Category Profiles from `config/categories/*.json`.
- Show validated Category/Profile choices and category-scoped Active Pool information in the localhost operator console.
- Accept `requested_new_count` instead of a precomputed Campaign target.
- Atomically create, baseline, start, and claim one new `MANUAL_BIND_PASSIVE_CAPTURE` Campaign.
- Return and display the explicit `campaign_id` without requiring the operator to copy it.
- Make the newly claimed Campaign the browser extension's unambiguous current Manual Bind context.
- Preserve the existing CLI as a development and diagnostic entry point.
- Provide idempotent handling of a repeated identical UI creation request.

### Out of scope

- Creating a first Active Pool for a Category with no existing Active Pool.
- Resuming, cancelling, deleting, superseding, or repairing another Campaign or queue.
- Starting a capture automatically after Campaign creation.
- Moving `检测当前页面`, `绑定当前页面`, or `采集当前页面` out of the Temu-page extension UI.
- Multi-Country or Multi-Currency behavior beyond the approved Germany / English / EUR scope.
- YingDao export implementation.

## 3. Safety Invariants

1. Product identity remains `platform + goods_id`; category does not enter product identity.
2. Every created Campaign has an explicit `category_key` and `category_profile_version`.
3. The server resolves the Profile from its validated registry. It never accepts Profile JSON or a Profile filesystem path from the browser.
4. The server calculates `target_count = active_pool_identity_count + requested_new_count`. A browser-supplied target is ignored or rejected.
5. Campaign creation never queries latest, paused, target-matching, or control-mode-matching Campaigns to infer a resume target.
6. The existing paused `1208 / 2000` Full Refresh Campaign is never resumed, mutated, cancelled, or selected.
7. Baseline capture is category scoped and must freeze the exact Active Pool ID and its complete identity set.
8. Missing, multiple, inconsistent, or unmappable Active Pools cause a hard failure before any write.
9. Any pre-existing active RPA queue causes `CATALOG_RPA_CLAIM_CONFLICT` before any write. The feature does not repair or release it.
10. Campaign creation, baseline capture, source/queue creation, transition, queue claim, and initial checkpoint are one atomic transaction.
11. Successful creation leaves the runner `UNBOUND`. It never detects, binds, scrolls, navigates, or captures a Temu page.
12. The current browser-extension context remains derived from exactly one running/manual-required Campaign with exactly one claimed active queue. No mutable global current-Campaign pointer is introduced.
13. No production history backfill or schema rewrite is part of this feature.

## 4. Category Profile Registry

The server owns a Category Profile Registry that scans the application repository's `config/categories` directory for files matching `*.json`. Tests inject a temporary registry directory; production does not accept a registry directory from an HTTP request.

Each file is parsed and passed through the existing `validateCategoryProfile()` function. The registry identity is:

```text
category_key + category_profile_version
```

The registry rejects duplicate identities. Invalid files are represented as unavailable diagnostics and cannot be selected for Campaign creation. The API never returns raw filesystem paths or sensitive configuration.

For every valid Profile, the registry-facing query resolves category-scoped baseline consistency through the existing Catalog Campaign repository/service. A selectable entry contains:

```json
{
  "category_key": "motorcycle-accessories",
  "category_profile_version": "motorcycle-accessories-v1",
  "display_name": "Motorcycle Accessories",
  "site_country": "DE",
  "language": "en",
  "currency": "EUR",
  "sort_order": "Top Sales",
  "capture_mode": "MANUAL_BIND_PASSIVE_CAPTURE",
  "active_pool_version_id": "catalog_pool_...",
  "active_pool_count": 2135,
  "profile_target_limit": 3000,
  "baseline_consistent": true,
  "available": true,
  "unavailable_code": null
}
```

A Category with no Active Pool is returned as unavailable with `INITIAL_ACTIVE_POOL_REQUIRED`. V1 does not create a baseline-zero Expansion Campaign because the existing Expansion activation semantics require a previous Active Pool. Initial pool creation belongs to a separate future design.

## 5. HTTP API

### `GET /api/catalog/operator/profiles`

Returns all discovered Profile summaries. Only entries with `available=true` can be submitted for Campaign creation. The response includes no Campaign selection fallback and no database mutation.

### `GET /api/catalog/operator-campaign/current`

Returns one of:

```json
{ "current": null }
```

or the one explicit claimed Manual Bind context. If more than one eligible context exists, it returns `CATALOG_RPA_CONTEXT_AMBIGUOUS`; it never chooses the latest context.

### `POST /api/catalog/operator-campaigns`

Request:

```json
{
  "category_key": "motorcycle-accessories",
  "category_profile_version": "motorcycle-accessories-v1",
  "requested_new_count": 10,
  "campaign_name": "Motorcycle Accessories Manual 10",
  "request_id": "operator-create-<client-generated-opaque-id>"
}
```

The request does not contain `target_count`, Active Pool count/ID, Campaign ID, browser mode, or taxonomy data. Those values are resolved by the server.

Successful response:

```json
{
  "campaign_id": "catalog_campaign_...",
  "campaign_name": "Motorcycle Accessories Manual 10",
  "category_key": "motorcycle-accessories",
  "category_profile_version": "motorcycle-accessories-v1",
  "capture_mode": "MANUAL_BIND_PASSIVE_CAPTURE",
  "baseline_pool_version_id": "catalog_pool_...",
  "baseline_count": 2135,
  "requested_new_count": 10,
  "target_count": 2145,
  "current_unique": 2135,
  "remaining": 10,
  "status": "running",
  "binding_status": "UNBOUND"
}
```

The route uses the same catalog CORS/no-store policy as the existing catalog endpoints. Normal operator-console requests are same-origin.

## 6. Atomic Creation Service

The Catalog Campaign Service gains one public orchestration method with a dependency on an already validated Profile object, not on a browser-provided path. Its logical input is:

```text
profile
requestedNewCount
campaignName
requestId
browserContext fixed to Profile 10 / Temu1店 / MANUAL_BIND_PASSIVE_CAPTURE
```

Within one `BEGIN IMMEDIATE` transaction, it performs these steps in order:

1. Validate `requested_new_count` as a positive integer.
2. Validate the Campaign name as non-empty and within the existing database limits.
3. Check for an idempotent replay by the same `request_id`.
4. Reject any different pre-existing active RPA queue with `CATALOG_RPA_CLAIM_CONFLICT`.
5. Re-resolve baseline consistency for the selected Profile.
6. Require exactly one consistent Active Pool with a positive identity count.
7. Calculate `target_count = baseline_count + requested_new_count`.
8. Require `target_count <= profile.target_count`.
9. Create a new `expansion` Campaign with explicit Category/Profile identity and the full frozen Profile, including taxonomy bindings.
10. Store the operator creation request identity and requested-new count in the frozen Campaign config for audit and idempotent replay.
11. Capture the exact Active Pool as Campaign baseline and verify that the stored baseline count and Pool ID equal the values resolved inside the transaction.
12. Create one `manual-bind-passive` category source with no automatic navigation behavior.
13. Transition the Campaign to `running`.
14. Explicitly claim that Campaign's pending queue.
15. Write an initial extension checkpoint with `runner_state=UNBOUND`, `capture_paused=true`, and every automatic control disabled.
16. Return the explicit Campaign context.

Any failure rolls the entire transaction back. In particular, a claim conflict cannot leave an orphan Campaign, baseline, source, queue, or source run.

The existing `createCampaign()` service path is factored into a transaction-neutral internal operation so both the existing public method and the new atomic orchestration use the same validation and frozen Profile behavior without nested `BEGIN IMMEDIATE` calls.

## 7. Idempotency

The operator browser creates one opaque `request_id` per submit attempt and retains it until that attempt receives a definitive response or the form inputs change.

The server stores the request identity in the Campaign's frozen config and derives or stores an exact Campaign identity for that request. A repeated request is returned as an idempotent replay only when all of these fields match:

```text
request_id
category_key
category_profile_version
requested_new_count
campaign_name
capture_mode
```

The replay returns the same `campaign_id`; it does not resume or create another Campaign. Reusing a request ID with different fields hard fails with `OPERATOR_CREATE_IDEMPOTENCY_CONFLICT`.

A different request ID while an active queue exists fails with `CATALOG_RPA_CLAIM_CONFLICT`.

## 8. Operator Console UI

The existing localhost console at `http://127.0.0.1:37821/` gains a dedicated panel above the legacy job controls.

### Creation form

The form contains:

```text
Category
Category Profile
采集模式
当前 Active Pool 数量
本次新增目标数量
Campaign Target
任务名称
创建采集任务
```

Behavior:

- Category and Profile options come only from `GET /api/catalog/operator/profiles`.
- Capture mode is read-only and always `MANUAL_BIND_PASSIVE_CAPTURE`.
- Active Pool count is read-only.
- Campaign Target is a display-only calculation of Active Pool count plus requested-new count.
- The server independently recalculates and validates the target.
- The create button is disabled while submitting and when the selected Profile is unavailable.
- Changing any creation input invalidates the current pending `request_id` and produces a new ID on the next submission.
- The UI does not call `/api/jobs/start`, any resume endpoint, or any capture endpoint.

### Current task card

After successful creation or page reload, the UI calls the explicit current-context endpoint and displays:

```text
当前采集任务
Category
Campaign Name
Campaign ID (visible for diagnostics, never required as operator input)
Baseline
Target
Current Unique
Remaining
Status
等待页面绑定 / current binding status
```

The existing hardcoded header `德国站 · 摩托配件 · Top Sales` becomes dynamic from the selected Profile or current Campaign. With no selection it displays `Germany / English / EUR · Multi-Category`.

The Temu-page extension remains responsible for `检测当前页面`, `绑定当前页面`, and `采集当前页面`. Successful localhost creation makes the context discoverable by the extension but does not send any command to the active tab.

## 9. Errors and Operator Messages

The server returns stable error codes; the UI shows both the code and a concise operator instruction.

| Code | Meaning and required behavior |
| --- | --- |
| `CATALOG_RPA_CLAIM_CONFLICT` | Another active queue exists. Stop. Do not cancel, resume, delete, or replace it. |
| `CATALOG_RPA_CONTEXT_AMBIGUOUS` | More than one eligible context exists. Stop and inspect; never choose latest. |
| `INITIAL_ACTIVE_POOL_REQUIRED` | Selected Category has no Active Pool. Use a separately designed initial-pool workflow. |
| `CATALOG_BASELINE_INCONSISTENT` | Pool and scoped memberships do not reconcile. No write. |
| `CATEGORY_PROFILE_NOT_FOUND` | The submitted key/version is not in the validated Registry. |
| `CATEGORY_PROFILE_VERSION_MISMATCH` | The Profile selection became stale. Refresh Profile options. |
| `CATALOG_TARGET_INVALID` | Requested-new count is invalid or calculated target exceeds the Profile limit. |
| `CAMPAIGN_NAME_CONFLICT` | Campaign name already exists. Change the name; do not reuse that Campaign. |
| `OPERATOR_CREATE_IDEMPOTENCY_CONFLICT` | A request ID was reused with different creation fields. Stop and refresh the form. |

All listed hard failures occur before commit. Errors never trigger compensating deletion or mutation of another Campaign.

## 10. Files and Responsibilities

Expected implementation boundaries:

- `src/modules/catalog-scale/category-profile-registry.mjs`: discover, validate, deduplicate, and resolve Profile identities.
- `src/modules/catalog-scale/catalog-campaign-service.mjs`: atomic operator Campaign orchestration and current context semantics.
- `src/db/repositories/catalog-campaign-repository.mjs`: exact idempotency lookup and transaction-neutral persistence helpers.
- `src/server/controllers/catalog-controller.mjs`: map HTTP inputs to Registry and service operations.
- `src/server/router.mjs`: expose the three operator Catalog endpoints.
- `src/server/index.mjs`: construct and inject the Profile Registry.
- `ui/operator-campaign.js`: pure form calculations, view-model mapping, request-ID lifecycle, and API calls.
- `ui/index.html`, `ui/app.js`, `ui/styles.css`: render and operate the creation/current-task panel.
- `tools/catalog-manual-passive-admin.mjs`: retain CLI behavior and reuse shared service orchestration where compatible; it remains diagnostic, not the normal operator path.

No database migration is planned unless implementation proves JSON-config idempotency lookup cannot be made exact and testable. If a schema change becomes necessary, implementation must stop and return to Design Gate rather than silently expanding scope.

## 11. Test Strategy

All database mutation tests use temporary SQLite fixtures. Production SQLite is not used by automated tests.

### Registry tests

- Valid Profiles are discovered and normalized.
- Invalid Profile JSON/bindings are unavailable and cannot be resolved for creation.
- Duplicate `category_key + category_profile_version` hard fails.
- No arbitrary HTTP filesystem path can select a Profile.

### Service and API tests

- Active Pool 2135 plus requested 10 produces target 2145.
- A browser-supplied target cannot affect server calculation.
- The new Campaign freezes the exact category, Profile version, taxonomy bindings, baseline Pool ID, and baseline identity count.
- Capture mode is exactly `MANUAL_BIND_PASSIVE_CAPTURE`.
- One source and queue are created and explicitly claimed.
- Initial checkpoint is `UNBOUND` and every automatic action is false.
- The new Campaign is returned by the explicit current-context endpoint.
- The paused `1208 / 2000` Campaign remains byte-for-byte semantically unchanged and is never selected.
- An active queue conflict produces `CATALOG_RPA_CLAIM_CONFLICT` and zero table-count or row-content changes.
- No Active Pool produces `INITIAL_ACTIVE_POOL_REQUIRED` and zero writes.
- Wrong Category/Profile produces a hard failure and zero writes.
- Same request ID and same fields returns the same Campaign.
- Same request ID with changed fields hard fails.
- Different request ID cannot reuse the active Campaign.
- A simulated failure after Campaign insertion rolls back Campaign, baseline, source, queue, checkpoint, and source-run writes.

### UI tests

- Requested-new input calculates the displayed target from the selected Active Pool count.
- Profile selection renders Category, Profile, mode, and availability accurately.
- Submit payload contains category key/version, requested-new count, name, and request ID but no target or Profile body.
- Successful response renders the current-task card without requiring Campaign ID input.
- Conflict errors display the code and do not call cancellation, resume, capture, navigation, or scrolling endpoints.
- Static/browser-source assertions confirm no automatic scrolling, navigation, pagination, See more click, category/sort switching, CAPTCHA handling, or immediate capture is introduced.

### Regression gates

- All new feature tests pass.
- All Catalog Campaign, Manual Bind, category-scope, classification, export, and server routing regressions pass.
- Full-suite failures match the approved seven baseline failures by test file, test name, and reason; `NEW_FAILURES=0`.

## 12. Acceptance Criteria

The feature is accepted only when:

```text
OPERATOR_CAN_CREATE_WITHOUT_CLI = YES
OPERATOR_NEVER_ENTERS_CAMPAIGN_ID = YES
TARGET_IS_SERVER_CALCULATED = YES
CREATE_AND_CLAIM_IS_ATOMIC = YES
CONFLICT_ZERO_WRITES = YES
NO_IMPLICIT_RESUME = YES
MANUAL_BIND_GATE_PRESERVED = YES
NEW_FEATURE_TESTS = PASS
RELATED_REGRESSION_TESTS = PASS
NEW_FAILURES = 0
```

The feature does not itself authorize or start a real Temu capture.
