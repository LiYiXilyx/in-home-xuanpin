# Catalog Explicit Operator Entry V1 — local verification

Date: 2026-09-04. Branch: `codex/catalog-explicit-entry-v1`.
Worktree: `/private/tmp/temu-market-evidence-safe-region-feedback-v1`.
Verified implementation: `ca1f4aae5a1c09f461f59cc01f2cc54202c004c8`.
Stable base, unchanged: `ddd1e6ee0471d06694dbf5182a2fb04ed152246b`.

## Outcome and retained history

This is a thin Entry layer, not a second Initial system. Existing commits 9e0ceb7, c18efce and 4d8f01a remain ancestors. Design status corrected separately in 99c1dbf; read-only conformance audit and gap plan committed in 0ac10a1. Bounded implementation commits: 3de7138, 7d9e97b, 3fc43c2, ca1f4aa. No reset, revert, amend, merge, cherry-pick or push.

Nine tracked gaps closed: six plan groups plus three independent review findings. See `2026-09-04-entry-conformance-audit.md` for before/after matrices.

## TDD and regression

- Service REDs demonstrated foreign source scope, frozen membership scope drift, stale replay children, missing blocker details, completed-without-pool create, running-without-claim and malformed policy problems. Bounded Entry guards made them GREEN.
- UI REDs demonstrated missing continuation routing, duplicate submits, polling selection overwrite, and missing explicit continue API. Scoped Entry UI made them GREEN.
- Review REDs demonstrated foreign pending claim bypass at START, empty claim fake success and permanent successful continuation request reuse. All three fixed and reviewed again.
- New feature tests: `node --test test/integration/catalog-explicit-entry*.test.mjs test/unit/catalog-explicit-entry-ui.test.mjs`: **24 PASS / 0 FAIL**.
- Related regression: **86 PASS / 0 FAIL**. Command:

```sh
node --test test/integration/initial-*.test.mjs test/integration/operator-campaign-*.test.mjs test/integration/operator-new-category-initial.test.mjs test/integration/catalog-manual-binding.test.mjs test/integration/girls-sets-initial-after-claim-recovery.test.mjs test/unit/catalog-panel.test.mjs test/unit/catalog-new-category-panel.test.mjs test/unit/catalog-dual-module-isolation.test.mjs test/unit/catalog-polling-isolation.test.mjs test/unit/initial-*.test.mjs test/unit/campaign-quantity-policy.test.mjs test/unit/operator-campaign-ui.test.mjs test/unit/catalog-manual-binding.test.mjs
```

- `npm run check`: PASS. `git diff --check`: PASS.
- Full suite: **822 tests / 813 PASS / 7 FAIL / 2 SKIP / 0 cancelled**. Exit 1 is expected from the explicitly approved failures, not reported as all-green.

```sh
YINGDAO_REAL_SOURCE_DIR='/Users/chuangyangdianzi/Desktop/1688导出excel' node --test --test-reporter=tap
```

Full log: `/private/tmp/catalog-entry-final-full-v2.tap`; focused: `/private/tmp/catalog-entry-focused-v2.tap`; related: `/private/tmp/catalog-entry-related-v2.tap`.

### Exact approved failures

All are ERR_ASSERTION. A read-only parser compared each file/name/actual/expected tuple against the approved literals and passed.

| File | Test | Actual → expected |
|---|---|---|
|test/integration/server-jobs.test.mjs|clear Excel requires confirmation and archives the workbook without touching SQLite|400 → 200|
|test/integration/server-jobs.test.mjs|test mode reset clears only isolated test data and creates an empty workbook|400 → 200|
|test/unit/catalog-parser.test.mjs|image cache validates HTTP, MIME, signature and minimum bytes without blocking failures|IMAGE_INVALID_CONTENT → IMAGE_SIGNATURE_INVALID|
|test/unit/image-cache.test.mjs|invalid content-type is rejected|IMAGE_INVALID_CONTENT → IMAGE_MIME_INVALID|
|test/unit/image-cache.test.mjs|missing content-type is rejected for a network response|IMAGE_INVALID_CONTENT → IMAGE_MIME_INVALID|
|test/unit/image-cache.test.mjs|too-small image is rejected|IMAGE_INVALID_CONTENT → IMAGE_TOO_SMALL|
|test/unit/image-cache.test.mjs|existing valid cache is reused without a network request|failed → completed|

Existing skips remain: `shared Operator serves Catalog and YingDao roots, modules and Review Console from one server`; `real Review V1 remains 50 goods 250 candidates with zero mapping errors`. No live production UI acceptance is claimed.

### Environment correction

Initial baseline had four additional environment failures. Existing isolated copies from `/private/tmp/temu-market-evidence-mvp-v1-integration/data` were copied into ignored development `data/`, with its existing image-cache copied into ignored outputs. The Sourcing fixture was checked read-only: 1 run / 50 goods / 250 candidates / 0 reviews. The existing real export directory was parsed read-only; no images downloaded. No test pointed at production writable databases.

The four environment-dependent test files were separately run: sourcing-review-migration, sourcing-review-repository, temu-sourcing-context-readonly, yingdao-real-exports: **14 PASS / 0 FAIL**. ENVIRONMENT_FAILURES=0 in full suite.

## Protected boundaries

Diff against stable is empty for all DB repositories, historical migrations, quantity policy, candidate hash, Initial QA, activation coordinator, browser-extension, YingDao module, ui/app.js and ui/index.html. Catalog service edits are composition, profile descriptor, exports and pre-create Entry guards inside the original transaction. No core Initial implementation was rewritten.

Snapshot/Image Cache V1 remains frozen: no candidate_snapshot_id, independent snapshot schema/repository, CREATING/SEALED lifecycle, reconstruction/live-freeze, image download/cache/retry, Preview or future snapshot handoff implementation.

Stable HEAD/status were rechecked: same ddd1e6e, clean. Feature worktree clean before this documentation commit. Data/image copies and test logs are not committed. No production database was opened writable by this work; no Dashboard restart or real browser/capture action.

## Final gates

```text
DESIGN_STATUS_CORRECTED = YES
DESIGN_AMEND_COMMIT = 99c1dbf
CONFORMANCE_AUDIT_PASS = YES
EXISTING_ENTRY_COMMITS_RETAINED = YES
ENTRY_RESOLVER_STATUS = PASS
CONTINUATION_STATUS = PASS
API_CONCURRENCY_STATUS = PASS
GAP_COUNT = 9
PATCHED_GAP_COUNT = 9
FROZEN_INITIAL_INFRA_TOUCHED = NO
FROZEN_SNAPSHOT_FEATURE_TOUCHED = NO
KNOWN_BASELINE_FAILURES = EXACT_SAME_7
ENVIRONMENT_FAILURES = 0
NEW_FAILURES = 0
PRODUCTION_DATA_WRITES = 0
REAL_TEMU_CAPTURE = 0
PRODUCTION_MIGRATION_APPLICATION = 0
STABLE_CHANGED = NO
DASHBOARD_RESTARTED = NO
PUSHED = NO
SAFE_TO_CONTINUE_REMAINING_IMPLEMENTATION = YES
ENTRY_V1_READY = YES (local implementation/fixture acceptance only; not deployed)
```
