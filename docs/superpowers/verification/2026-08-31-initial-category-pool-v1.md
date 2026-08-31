# Initial Category Pool V1 Verification Evidence

Date: 2026-08-31

Worktree: `/private/tmp/temu-multi-category-safety-v1`

Branch: `codex/multi-category-safety-v1`

## Scope and safety boundary

- All write-path verification used temporary SQLite fixtures created under the operating-system temporary directory.
- The verifier rejects `TEMU_CONFIG_PATH` and `--config` before it creates a fixture.
- Production configuration and production SQLite were not opened by this verification.
- No real Temu page, Chrome Profile, Extension capture, Dashboard startup, Campaign auto-create, or network capture was started.
- The existing Motorcycle 2135/1149 blocker was not repaired or bypassed.
- The paused 1208/2000 Campaign and historical production Campaigns/snapshots were not read as current, resumed, or modified.
- The nine approved CRLF migration working-tree diffs remain unstaged and are excluded from every feature commit.

## TDD results

### NEW_FEATURE_TESTS

Command:

```bash
node --test test/unit/campaign-quantity-policy.test.mjs test/unit/initial-candidate-hash.test.mjs test/unit/initial-pool-qa.test.mjs test/unit/initial-activation-coordinator.test.mjs test/unit/initial-pool-ui.test.mjs test/unit/initial-pool-safety-verifier.test.mjs test/integration/initial-category-pool-migration.test.mjs test/integration/initial-campaign-create.test.mjs test/integration/initial-candidate-ledger.test.mjs test/integration/initial-manual-capture.test.mjs test/integration/initial-pool-qa.test.mjs test/integration/initial-pool-activation.test.mjs test/integration/initial-pool-api.test.mjs
```

Result: `41 PASS / 0 FAIL`.

Coverage includes migration upgrade/rollback; sentinel isolation; Initial create/idempotency/zero-write conflicts; 10/100/1000 open-ended capture; Page Health and binding enforcement; deterministic candidate ledger; mandatory QA and immutable snapshots; stale QA; application mutex; transaction rollback; category-scoped/idempotent activation; API authority; UI state; and verifier production-config rejection.

`npm run qa:initial-pool`: PASS. The temporary fixture captured 10 candidates, froze and passed a 10-row QA snapshot, and explicitly activated a 10-row first Pool.

### RELATED_REGRESSION_TESTS

The plan's 15 related regression files produced `50 PASS / 0 FAIL`. `npm run check` also passed.

This proves the directly related Refresh, Expansion, Manual Bind, Campaign API/create, multi-category isolation, scoped Classification/Export, Profile, UI, migration, and Launcher health paths remain green.

### FULL_SUITE

Command: `npm test`

Result: `376 tests / 369 PASS / 7 FAIL`.

### KNOWN_BASELINE_FAILURES

The failure set exactly matches the approved seven failures by file, test name, assertion class, and actual/expected reason:

1. `test/integration/server-jobs.test.mjs` — `clear Excel requires confirmation and archives the workbook without touching SQLite` — `AssertionError [ERR_ASSERTION]`, HTTP `400 !== 200`.
2. `test/integration/server-jobs.test.mjs` — `test mode reset clears only isolated test data and creates an empty workbook` — `AssertionError [ERR_ASSERTION]`, HTTP `400 !== 200`.
3. `test/unit/catalog-parser.test.mjs` — `image cache validates HTTP, MIME, signature and minimum bytes without blocking failures` — `AssertionError [ERR_ASSERTION]`, `IMAGE_INVALID_CONTENT !== IMAGE_SIGNATURE_INVALID`.
4. `test/unit/image-cache.test.mjs` — `invalid content-type is rejected` — `AssertionError [ERR_ASSERTION]`, `IMAGE_INVALID_CONTENT !== IMAGE_MIME_INVALID`.
5. `test/unit/image-cache.test.mjs` — `missing content-type is rejected for a network response` — `AssertionError [ERR_ASSERTION]`, `IMAGE_INVALID_CONTENT !== IMAGE_MIME_INVALID`.
6. `test/unit/image-cache.test.mjs` — `too-small image is rejected` — `AssertionError [ERR_ASSERTION]`, `IMAGE_INVALID_CONTENT !== IMAGE_TOO_SMALL`.
7. `test/unit/image-cache.test.mjs` — `existing valid cache is reused without a network request` — `AssertionError [ERR_ASSERTION]`, status `failed !== completed`.

`KNOWN_BASELINE_FAILURES = exactly 7`

`NEW_FAILURES = 0`

## Safety evidence

### Motorcycle before/after fingerprint

The temporary verifier seeded a protected `motorcycle-accessories` Active Pool, recorded scoped Pool/membership rows, completed the fake Category B Initial flow, then compared the same ordered fingerprint. Result: exact equality and `MOTORCYCLE_POOL_UNCHANGED = YES`.

The category-isolation regression additionally proved two Categories may share one Product identity while their memberships, Pools, baselines, and checkpoints remain isolated. No production Motorcycle fingerprint or row was written.

### Migration safety

- Empty/current migration path: PASS.
- Historical schema upgrade preserved all four historical Campaign types and the paused 1208/2000 Campaign: PASS.
- Injected failure after the Campaign table rebuild rolled back the schema, rows, references, and `schema_migrations` entry: PASS.
- `PRAGMA integrity_check`: PASS in migration and QA fixtures.
- `PRAGMA foreign_key_check`: PASS in migration and QA fixtures.
- Feature-commit migration diff from the approved Design commit contains only `db/migrations/026_initial_category_pool.sql`.
- No historical migration checksum was edited.

### Static audit

- The Initial storage sentinel is defined only by the centralized quantity-policy module and persisted by the Initial create path.
- Other literal `2147483647` matches in browser code are CSS `z-index` values; matches in older database/crawler code are unrelated ordering/rank defaults. They do not identify an Initial Campaign.
- Initial public API/UI/Extension values are `target_count=null`, `remaining=null`, and `target_reached=null`; the UI renders `不限数量`.
- The Manual Bind runner gates target comparisons behind `quantityMode !== 'OPEN_ENDED'`.
- No global `UPDATE catalog_memberships SET active=0 WHERE active=1` or global Pool deactivation statement exists in the Initial implementation path.
- PID/port/production launcher behavior was outside this feature and was not invoked.

## Commit list before Task 9 evidence commit

1. `29da7b5` — `feat: add Initial Category Pool schema`
2. `4c03ce0` — `feat: centralize Campaign quantity semantics`
3. `fc491c0` — `feat: create open-ended Initial Campaigns`
4. `ec2d915` — `feat: persist deterministic Initial candidates`
5. `f229e7e` — `feat: keep Initial manual capture open ended`
6. `40ce498` — `feat: gate immutable Initial Pool QA`
7. `7381d74` — `feat: atomically activate first Category Pools`
8. `1e7ab51` — `feat: operate first Category Pool from dashboard`

Task 9 adds only the verifier, its unit tests, the package command, and this evidence file.

## Final Gates

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
SAFE_FOR_NEW_CATEGORY_INITIAL_10_ROW_DRY_RUN = YES
```

## Remaining limitations

- `SINGLE_DASHBOARD_PROCESS_REQUIRED=YES`: the V1 campaign-scoped application mutex is intentionally not a cross-process/distributed lock. Multiple Dashboard processes against one SQLite require a future database-level claim/lock design.
- Raw Active Pool activation remains separate from taxonomy capability. An unimplemented new Category may establish a raw Pool, but Classification and Opportunity remain blocked; there is no fallback to Motorcycle taxonomy.
- This verification authorizes only a future operator-controlled 10-row dry run. It does not authorize automatic capture or a larger real collection.
