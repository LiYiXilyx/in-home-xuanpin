# Temu Operator Launcher V1 Verification

**Date:** 2026-08-31

**Worktree:** `/private/tmp/temu-multi-category-safety-v1`

**Branch:** `codex/multi-category-safety-v1`

**Temporary deployment:** `TEMPORARY_DEPLOYMENT_PATH = YES`

## Automated verification

### NEW_FEATURE_TESTS

```text
Command:
node --test test/integration/operator-launcher-health.test.mjs \
  test/unit/operator-dashboard-launcher.test.mjs \
  test/unit/macos-operator-launcher.test.mjs

Result: 25 PASS / 0 FAIL
```

Covered behavior:

- exact HTTP status/content type/service/apiVersion/environment/testMode health identity;
- unused, healthy, and foreign port decisions;
- foreign HTTP service remains reachable after HARD FAIL;
- atomic lock, live/fresh lock preservation, stale dead lock recovery, matching-token release;
- post-lock health/port recheck before spawn;
- missing lock parent directory on first deployment;
- detached Dashboard survives launcher return;
- concurrent launch calls spawn counter equals one;
- startup failure writes a log and opens no browser;
- 5 MiB threshold with one `.log.1` generation;
- diagnostic PID writing without health authority;
- fixed worktree/config/npm/port CLI scope;
- `.app` executable contract, Node/npm resolution, missing runtime/path HARD FAIL, and persistent failure UI.

### RELATED_REGRESSION_TESTS

```text
Campaign / Manual Bind selection: 21 PASS / 0 FAIL
npm run check: PASS
npm run check:opportunity: PASS
```

This includes active queue conflict zero writes, explicit Campaign scope, baseline consistency gate, unbound capture zero writes, page-context invalidation, idempotent manual capture, and no automatic scheduling.

### FULL_SUITE

```text
tests = 330
pass = 323
fail = 7
NEW_FAILURES = 0
```

The exact approved baseline failures remain:

1. `test/integration/server-jobs.test.mjs` — `clear Excel requires confirmation and archives the workbook without touching SQLite` — response `400 !== 200`.
2. `test/integration/server-jobs.test.mjs` — `test mode reset clears only isolated test data and creates an empty workbook` — response `400 !== 200`.
3. `test/unit/catalog-parser.test.mjs` — `image cache validates HTTP, MIME, signature and minimum bytes without blocking failures` — `IMAGE_INVALID_CONTENT` vs `IMAGE_SIGNATURE_INVALID`.
4. `test/unit/image-cache.test.mjs` — `invalid content-type is rejected` — `IMAGE_INVALID_CONTENT` vs `IMAGE_MIME_INVALID`.
5. `test/unit/image-cache.test.mjs` — `missing content-type is rejected for a network response` — `IMAGE_INVALID_CONTENT` vs `IMAGE_MIME_INVALID`.
6. `test/unit/image-cache.test.mjs` — `too-small image is rejected` — `IMAGE_INVALID_CONTENT` vs `IMAGE_TOO_SMALL`.
7. `test/unit/image-cache.test.mjs` — `existing valid cache is reused without a network request` — `failed` vs `completed`.

The first full-suite run exposed the new fixture file as an eighth discovered test with no CLI port. The fixture was made inert when invoked without `--port`, its direct test passed, Launcher regressions passed, and the second full-suite run returned to the exact seven approved failures.

## Controlled live acceptance

The pre-existing Dashboard was proven to belong to this thread through execution session `9886` and was stopped only by sending Ctrl-C to that owned session. No port-derived, PID-file-derived, or guessed PID was stopped.

Pre-restart read-only snapshot:

```text
old health identity fields absent (expected for the old process)
Campaign count = 9
Active Pool = 2135
Active Memberships = 1149
Intersection = 1149
baseline_consistency = false
Profile available = false
```

The first `.app` acceptance attempt exposed a missing `logs/` parent-directory bug before Dashboard spawn. The log/lock fix was implemented with a reproducing RED test. The second Finder-equivalent `open` succeeded:

```json
{"ok":true,"service":"temu-operator-dashboard","apiVersion":1,"environment":"development","testMode":false}
```

Second `.app` invocation evidence:

```text
listener count before = 1
listener count after = 1
launcher process count after return = 0
Dashboard listener count after launcher return = 1
```

Post-restart read-only snapshot:

```text
Campaign count = 9
Active Pool = 2135
Active Memberships = 1149
Intersection = 1149
baseline_consistency = false
Profile available = false
```

No UI business action was clicked. No Campaign was created or resumed, no Active Pool/member repair ran, and no Temu capture started.

## Database and migration boundary

Static audit found no database or migration import in Launcher code:

```text
LAUNCHER_DIRECT_DB_WRITES = 0
```

The existing Dashboard still owns its unchanged migration and `recoverInterrupted` startup behavior. The acceptance did not instrument SQLite write syscalls, so it does not claim that the overall Dashboard startup performed zero writes:

```text
DASHBOARD_STARTUP_RECOVERY_WRITES = POSSIBLE_EXISTING_BEHAVIOR
```

Protected business counters above were unchanged. The nine approved CRLF migration files remain uncommitted working-tree diffs. Commit-path audit from the Launcher design commit through HEAD returned no `db/migrations/` path.

## Safety gates

```text
FINDER_DOUBLE_CLICK = PASS
TERMINAL_VISIBLE_TO_OPERATOR = NO
DASHBOARD_PROCESS_AFTER_LAUNCHER_EXIT = ALIVE
DOUBLE_CLICK_SPAWN_COUNT = 1
STALE_LOCK_RECOVERY = PASS
FOREIGN_PORT_SERVICE_KILLED = NO
HEALTH_IDENTITY_REQUIRED = YES
BROWSER_OPENS_ONLY_AFTER_HEALTH = YES
LAUNCHER_DIRECT_DB_WRITES = 0
BASELINE_HARD_FAIL_PRESERVED = YES
REAL_TEMU_CAPTURE_STARTED = NO
CAMPAIGN_AUTO_CREATED = NO
NEW_FAILURES = 0

OPERATOR_LAUNCHER_READY = YES
```

## Implementation commits

```text
1c68bf8 feat: identify Temu operator dashboard health
ed1ff0c feat: guard Temu dashboard launch state
da06548 feat: launch Temu dashboard in background
5c9c102 feat: add macOS Temu operator app
ce4773a fix: close launcher identity race gates
bedadd4 fix: create launcher lock directory
754c0f0 test: keep dashboard fixture inert under discovery
```

No commit was pushed.
