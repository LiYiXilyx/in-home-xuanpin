# Temu New Category Onboarding & Scoped Export V1 Design

Date: 2026-09-02  
Status: Approved for implementation  
Base: `dd98a6ee635718f72e38ccbfea6f514b0e0846a8`  
Owner: Single Codex owner for Catalog, shared UI integration, Git delivery, and runtime verification

## 1. Objective

An operator can register a new Temu category, create its first open-ended manual capture Campaign, capture as many products as desired, run Initial Pool QA, activate the first raw Pool, and export either the current capture preview or the formal Pool without editing JSON, using a CLI, or asking Codex to implement each category.

V1 is restricted to Germany / English / EUR / Top Sales and reuses `MANUAL_BIND_PASSIVE_CAPTURE`. It does not discover categories automatically, configure taxonomy, classify products, run Opportunity, automate navigation, or add YingDao behavior.

## 2. Non-negotiable safety boundaries

- Product identity remains `platform + goods_id`; category identity remains in Campaign, membership, candidate, and Pool scope.
- Every write uses exact `category_key + category_profile_version`; exports additionally require exact `campaign_id + candidate_revision` or `pool_version_id`.
- No latest/global fallback is permitted.
- Operator-managed capture-only profiles have taxonomy and Opportunity explicitly `UNCONFIGURED`; Motorcycle bindings, rules, exclusions, thresholds, and legacy membership resolution are never inherited.
- Built-in profiles are immutable from Operator APIs.
- Profile validation performs zero filesystem, database, Campaign, browser, and Temu writes.
- Profile registration writes only below the config-owned operator profile directory and never writes the Git worktree.
- Capture remains manual. The UI may open the validated listing URL only after an explicit click; it never switches market context, scrolls, clicks See more, handles CAPTCHA, or captures automatically.
- Profile persistence and Campaign creation are two explicit operations, not a fabricated cross-filesystem/SQLite transaction. A saved profile remains saved if Campaign creation fails.
- All automated write tests use temporary profile roots, SQLite databases, and export directories.
- No files under YingDao, sourcing, Review, Random5, Visual Index, supplier image cache, or sourcing API namespaces may change.

## 3. Current architecture and reuse points

The existing system already provides:

- `category-profile.mjs`: built-in Motorcycle profile validation and taxonomy binding gates.
- `category-profile-registry.mjs`: reload-on-list/resolve scanning for one built-in directory.
- `catalog-campaign-service.mjs`: atomic Initial Campaign creation, open-ended quantity policy, candidate ledger, Initial QA, activation mutex, category-scoped Pool activation, and Manual Bind capture.
- browser extension Manual Bind runner: detect, bind, and capture as separate explicit operator actions.
- `ui/modules/catalog/*`: Catalog-owned state, rendering, polling, and API client.
- `catalog-pool-read-repository.mjs`: strict Pool-scoped read API.
- existing Artifact Tool Excel builders and image compatibility helpers.

V1 extends these seams instead of creating parallel profile, capture, QA, activation, or export systems.

## 4. Profile source architecture

### 4.1 Sources

The registry scans two explicit sources on every `list()` and `resolve()`:

1. `BUILT_IN`: `<runtime>/config/categories/`
2. `OPERATOR_MANAGED`: `<dirname(TEMU_CONFIG_PATH)>/data/operator-category-profiles/`

The operator directory is derived by the server composition root from the resolved config path. Business modules receive the resolved directory and never contain a username or machine-specific path.

Each returned profile carries:

```json
{
  "profile_origin": "BUILT_IN | OPERATOR_MANAGED",
  "profile_kind": "MOTORCYCLE_RULED | CAPTURE_ONLY",
  "profile_schema_version": 1
}
```

Existing built-in profiles are adapted in memory with backward-compatible metadata; their JSON content is not rewritten.

### 4.2 Capture-only persisted schema

Operator profiles use schema version 2:

```json
{
  "profile_schema_version": 2,
  "profile_origin": "OPERATOR_MANAGED",
  "profile_kind": "CAPTURE_ONLY",
  "category_key": "server-generated",
  "category_profile_version": "server-generated",
  "display_name": "Pet Supplies",
  "page_category_name": "Pet Supplies",
  "category_aliases": ["Pet Supplies"],
  "parent_category": "Home & Pet",
  "breadcrumbs": ["Home & Pet", "Pet Supplies"],
  "listing_url": "https://www.temu.com/de-en/...",
  "site_country": "DE",
  "language": "en",
  "currency": "EUR",
  "sort_order": "Top Sales",
  "capture_mode": "MANUAL_BIND_PASSIVE_CAPTURE",
  "quantity_mode": "OPEN_ENDED",
  "taxonomy": {
    "status": "UNCONFIGURED"
  },
  "capabilities": {
    "raw_capture_available": true,
    "initial_pool_available": true,
    "classification_available": false,
    "opportunity_available": false
  }
}
```

Capture-only validation does not require Motorcycle exclusion flags, price floors, taxonomy bindings, or hard exclusion codes. Pipeline capability resolution returns a stable `CATEGORY_TAXONOMY_UNCONFIGURED` error for classification, fine classification, and Opportunity.

### 4.3 Generated identity

- `category_key`: deterministic normalized ASCII kebab-case derived from the display/page category identity. Unicode-only names require at least one explicit Latin alias suitable for identity generation.
- `category_profile_version`: deterministic `operator-<category-key>-v1-<content-hash-prefix>` generated from canonical validated business input.
- Filename: `<category_key>--<category_profile_version>.json` after strict safe-segment validation.
- Canonical JSON: fixed field order, arrays normalized and deduplicated, two-space indentation, LF final newline.

The same semantic input always generates the same identity and bytes.

## 5. Operator Profile Store

The store owns validation-to-persistence boundaries:

1. Resolve and validate the configured operator root.
2. Reject a symlink root, symlink path component, non-directory root, or target escaping the root.
3. Normalize input and generate identity server-side.
4. Check both built-in and operator registry identities before writing.
5. Check request idempotency records stored as deterministic sidecar JSON under the same root.
6. Write a uniquely named temporary file with exclusive creation.
7. Flush/close and atomically rename to the deterministic final filename.
8. Re-read and validate the final file through the same profile validator.
9. Return the registered profile. Registry scanning makes it immediately visible without process restart.

Idempotency rules:

- Same `request_id` and same canonical request hash returns the original profile.
- Same `request_id` and different hash returns `CATEGORY_PROFILE_IDEMPOTENCY_CONFLICT` with zero writes.
- Existing built-in identity returns `CATEGORY_PROFILE_BUILT_IN_CONFLICT`.
- Existing operator identity with another request returns `CATEGORY_PROFILE_ALREADY_EXISTS`.
- V1 exposes no delete, update, overwrite, or historical version mutation operation.

## 6. APIs

### 6.1 Validate

`POST /api/catalog/operator/category-profiles/validate`

This endpoint normalizes and validates input and returns the generated identity, normalized listing URL, membership scope, and capabilities. It performs zero filesystem and database writes.

### 6.2 Register

`POST /api/catalog/operator/category-profiles`

Requires:

- `request_id`
- `display_name`
- `page_category_name`
- `category_aliases`
- `parent_category`
- `breadcrumbs`
- `listing_url`

The server ignores/rejects client-provided generated identity and fixed market/capture fields. It persists through the Operator Profile Store and returns the registered profile plus `idempotent_replay`.

### 6.3 Existing Initial Campaign API

After registration, the client calls the existing `POST /api/catalog/operator/initial-campaigns` with the exact returned `category_key`, `category_profile_version`, operator task name, and a separate Campaign `request_id`.

Profile save success followed by Campaign failure is represented explicitly:

```json
{
  "profile_saved": true,
  "campaign_created": false,
  "campaign_error_code": "CATALOG_RPA_CLAIM_CONFLICT"
}
```

The UI retains the registered profile and offers Campaign creation retry. It never deletes the profile as compensation.

## 7. Catalog UI

The existing Catalog module adds a collapsed `添加新类目` panel inside `#catalog-module-root` using only `catalog-*` DOM ids/classes and `catalogState` fields.

Editable fields:

- display name
- Temu page category name
- aliases
- parent category
- breadcrumbs
- listing URL
- Initial Campaign name

Read-only fields:

- Germany
- English
- EUR
- Top Sales
- OPEN_ENDED
- MANUAL_BIND_PASSIVE_CAPTURE

Actions:

1. `验证类目配置`: calls validation only and renders generated identity/capabilities.
2. `保存并创建首次采集任务`: registers the profile, refreshes the registry, selects it, then creates the Initial Campaign.
3. `打开 Temu 类目页面`: appears only for a validated/registered URL and runs `window.open(url)` only in the operator click handler.

Successful validation explicitly renders:

- generated key/version and membership scope
- Raw Capture available
- Initial Pool available
- Classification unconfigured/blocked
- Opportunity unconfigured/blocked

Catalog state and polling remain isolated from YingDao. Catalog render/destroy never queries, clears, disables, or rewrites the YingDao root.

## 8. Manual Bind and Page Health

The same Manual Bind extension and server capture path are reused. The capture context exposes the selected profile’s:

- exact category name and aliases
- breadcrumbs
- normalized listing host/path
- DE / English / EUR
- Top Sales

Page Health must pass all market, category, breadcrumb, sort, product-card, CAPTCHA, SEARCH_NO_RESULTS, and DOM/network readiness checks. A failed check blocks binding and produces zero capture writes. Any bound URL/category/breadcrumb/sort/market change invalidates binding.

Capture-only profiles bypass only Motorcycle business screening. They do not bypass identity, scope, payload, Page Health, or Manual Bind proof gates.

## 9. Initial QA and activation

Initial QA is separated into:

### 9.1 Universal mandatory safety gates

- Campaign/profile/category identity
- unique goods identity
- market/Page Health context
- Manual Bind evidence and batch consistency
- required fields and data quality
- SQLite integrity and foreign keys
- cross-category isolation
- frozen activation payload
- deterministic candidate revision/hash

### 9.2 Profile-enabled business policy gates

Only a ruled profile explicitly enables electronics, USB, battery, price minimum, and Motorcycle eligibility checks.

For `CAPTURE_ONLY`:

```text
CATEGORY_SPECIFIC_POLICY = NOT_CONFIGURED
RAW_POOL_ACTIVATION = ALLOWED
CLASSIFICATION = BLOCKED
OPPORTUNITY = BLOCKED
```

`NOT_CONFIGURED` is an audited non-applicable policy state, not a fabricated Motorcycle PASS.

Existing candidate freeze, QA STALE behavior, activation mutex, final revision/count recheck, rollback, explicit activation, and category-scoped Pool materialization remain unchanged.

## 10. Scoped Excel exports

### 10.1 Initial preview

Available when `live_unique_count > 0`.

Request identity:

- exact `campaign_id`
- exact current `candidate_revision`
- exact category/profile identity

The server rechecks the revision and reads only the Campaign candidate ledger/frozen payloads. A stale revision returns `CATALOG_PREVIEW_REVISION_STALE`.

Workbook metadata prominently states `PREVIEW` and `NOT_ACTIVE_POOL`. Sheets:

1. `01_商品明细`
2. `02_数据质量`
3. `03_采集任务`
4. `04_类目配置`
5. `05_待分类说明`

### 10.2 Formal Pool export

Available only after activation.

Request identity:

- exact `category_key`
- exact `category_profile_version`
- exact `pool_version_id`

The repository reads only Pool version items and associated exact snapshots. It never selects latest Pool, global active memberships, or global products.

Both workbook types include at least:

- goods_id, title, price, currency, sales, rating, review_count, rank
- source_url, canonical_url, image status/reference
- category_key, category_profile_version
- pool_version_id when formal
- campaign_id and capture_time

Missing images remain missing and are never replaced with another product’s image. Export is read-only and must prove `EXCEL_EXPORT_DB_WRITES = 0`. Existing Artifact Tool workbook/image/link patterns are reused; V1 does not fall back to CSV.

## 11. Error model

Stable errors include:

- `CATEGORY_PROFILE_INPUT_INVALID`
- `CATEGORY_PROFILE_URL_INVALID`
- `CATEGORY_PROFILE_IDEMPOTENCY_CONFLICT`
- `CATEGORY_PROFILE_BUILT_IN_CONFLICT`
- `CATEGORY_PROFILE_ALREADY_EXISTS`
- `CATEGORY_PROFILE_STORE_UNSAFE`
- `CATEGORY_TAXONOMY_UNCONFIGURED`
- `CATALOG_PREVIEW_SCOPE_MISMATCH`
- `CATALOG_PREVIEW_REVISION_STALE`
- `CATALOG_POOL_SCOPE_REQUIRED`
- `CATALOG_POOL_SCOPE_MISMATCH`

Every failure is fail-closed. Validation failures perform zero writes; registration failures leave no temporary/final partial file; Campaign failures do not remove a successfully registered profile; export failures do not mutate SQLite or replace an existing valid workbook with partial output.

## 12. Test strategy

All new tests use temporary roots, fixture databases, and temporary export directories.

Required proof:

- two-source registry reload and deterministic precedence
- capture-only schema/capability and explicit taxonomy block
- server-generated identity, canonical JSON, path containment, symlink escape, built-in protection
- validate zero writes
- register idempotency/conflict and registry reload
- Catalog UI validation/save/create/retry/open behavior and YingDao isolation
- Initial Campaign remains OPEN_ENDED and Manual Bind is reused
- alias/breadcrumb/path Page Health and bind zero-write failures
- QA universal gates plus capture-only policy `NOT_CONFIGURED`
- preview revision scope and formal Pool tuple scope
- deterministic workbook rows, zero DB writes, no Motorcycle contamination
- existing Motorcycle, Initial, activation, Catalog UI, YingDao UI, Review, Visual Index, Random5, and Launcher regressions
- full suite retains exactly the approved seven baseline failures by file, test name, and reason class

## 13. Delivery and runtime verification

Each Design, Plan, and Task is committed and normally pushed to `codex/new-category-onboarding-v1`. The completed feature is merged to `codex/catalog-yingdao-runtime` only with `git merge --ff-only` after confirming stable HEAD has not advanced unexpectedly.

The stable runtime reruns focused, related, full-suite, syntax, and diff checks. Dashboard restart uses only the launcher-owned process mechanism and verifies the exact health service identity before opening the page.

Real smoke is limited to opening the new-category form, entering disposable client-side fields, and calling the validation-only endpoint. It does not register a profile, create a Campaign, access Temu, run QA, activate a Pool, or modify production Catalog data. Screenshot output remains outside the repository.

## 14. Design gates

```text
DESIGN_GATE = PASS
PRODUCT_IDENTITY_UNCHANGED = YES
PROFILE_STORE_OUTSIDE_GIT = YES
BUILT_IN_PROFILE_IMMUTABLE = YES
CAPTURE_ONLY_TAXONOMY_EXPLICITLY_UNCONFIGURED = YES
MOTORCYCLE_FALLBACK = NO
MANUAL_BIND_REUSED = YES
INITIAL_OPEN_ENDED = YES
QA_TARGET_DEPENDENCY = NO
PREVIEW_EXPORT_CAMPAIGN_SCOPED = YES
FORMAL_EXPORT_POOL_SCOPED = YES
YINGDAO_BUSINESS_SCOPE_CHANGED = NO
PRODUCTION_DATA_WRITE_IN_TESTS = NO
```
