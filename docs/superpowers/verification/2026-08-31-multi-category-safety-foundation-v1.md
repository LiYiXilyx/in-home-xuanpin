# Multi-Category Safety Foundation V1 Verification

## Isolation and prohibited actions

- Worktree: `/private/tmp/temu-multi-category-safety-v1`
- Branch: `codex/multi-category-safety-v1`
- Production SQLite was opened only with `readOnly: true` by `scripts/verify-multi-category-readonly.mjs`.
- No production migration/backfill, real Temu capture, push, stash, reset, or clean was performed.
- YingDao work is limited to a disabled Operator UI integration seam and the documented eight-column compatibility contract. No exporter was implemented.

## Static verification

- `npm run check`: PASS
- `npm run check:opportunity`: PASS
- `git diff --check`: PASS
- Repository scan confirms no remaining global `UPDATE catalog_memberships SET active=0 WHERE active=1` in `src`, `tools`, or the browser extension.

## NEW_FEATURE_TESTS

Command: focused `node --test` run covering Category Profile/bindings, legacy resolver, campaign selection, dual-category isolation, classification/export isolation, Manual Bind runner/server gate, browser UI seam, and read-only QA contract.

- Tests: 41
- Pass: 41
- Fail: 0
- Result: PASS

This includes same `goods_id` in two categories, membership/materialization/active-pool/baseline/checkpoint isolation, explicit resume, wrong-category resume hard fail, taxonomy binding gates, Excel/Opportunity scope and metadata, legacy resolution pass/unresolved/ambiguous gates, unbound zero writes, context invalidation, idempotent replay, disabled automation, dynamic Manual admin scope, and ready-Pool promotion scope.

## RELATED_REGRESSION_TESTS

Command: focused `node --test` run over catalog API/campaign/refresh/expansion/persistence/resume, classification/fine classification, export, migrations, Opportunity, browser/network capture, and configuration tests.

- Tests: 98
- Pass: 98
- Fail: 0
- Result: PASS

## FULL_SUITE

Command: `npm test`

- Tests: 283
- Pass: 276
- Fail: 7
- Result: expected baseline only

### KNOWN_BASELINE_FAILURES = 7

1. `test/integration/server-jobs.test.mjs` — `clear Excel requires confirmation and archives the workbook without touching SQLite` — `AssertionError`, HTTP status `400 !== 200`.
2. `test/integration/server-jobs.test.mjs` — `test mode reset clears only isolated test data and creates an empty workbook` — `AssertionError`, HTTP status `400 !== 200`.
3. `test/unit/catalog-parser.test.mjs` — `image cache validates HTTP, MIME, signature and minimum bytes without blocking failures` — `AssertionError`, `IMAGE_INVALID_CONTENT !== IMAGE_SIGNATURE_INVALID`.
4. `test/unit/image-cache.test.mjs` — `invalid content-type is rejected` — `AssertionError`, `IMAGE_INVALID_CONTENT !== IMAGE_MIME_INVALID`.
5. `test/unit/image-cache.test.mjs` — `missing content-type is rejected for a network response` — `AssertionError`, `IMAGE_INVALID_CONTENT !== IMAGE_MIME_INVALID`.
6. `test/unit/image-cache.test.mjs` — `too-small image is rejected` — `AssertionError`, `IMAGE_INVALID_CONTENT !== IMAGE_TOO_SMALL`.
7. `test/unit/image-cache.test.mjs` — `existing valid cache is reused without a network request` — `AssertionError`, `failed !== completed`.

The final failure identities and reasons exactly match the approved baseline. No failure was replaced by a new one.

- NEW_FAILURES: 0

## Production read-only QA

The QA command was run twice against the configured production database. Both runs exited 0 and produced byte-identical output.

- `PRAGMA integrity_check`: `ok`
- Foreign-key violations: 0
- `LEGACY_MEMBERSHIP_NULL_CATEGORY_KEY`: 452
- `LEGACY_ACTIVE_MEMBERSHIP_NULL_CATEGORY_KEY`: 220
- Legacy memberships uniquely resolved: 220
- Legacy memberships unresolved: 232
- Legacy memberships ambiguous: 0
- Protected Motorcycle Active Pool: `catalog_pool_bdc90c9ae44740cea0e7a1b59476fd63`, 2135 products
- Total product identities: 2372
- Protected paused campaign: `catalog_campaign_6e86fd902ac244e08eade55975e8b9ac`, `1208 / 2000`, status `paused`
- Historical campaigns: 9
- Historical snapshots: 4205

## Final gates

`SAFE_FOR_SECOND_CATEGORY_10_ROW_DRY_RUN = YES`

`SAFE_FOR_OPERATOR_MANUAL_CAPTURE = YES`

These gates authorize only the separately controlled next-stage dry run/manual operation. No real capture was started by this implementation or verification.
