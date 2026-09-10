# Temu Operator Launcher V1 Design

**Date:** 2026-08-31

**Status:** Approved design with pre-implementation safety amendments

## 1. Goal and Scope

Temu Operator Launcher V1 gives a macOS operator one Finder entry point:

```text
启动 Temu 运营台.app
```

The launcher only ensures that the existing Temu Operator Dashboard is healthy and opens `http://127.0.0.1:37821/`. It does not start Chrome, open Temu, load an extension, create or resume a Campaign, bind or capture a page, navigate, scroll, click See more, repair migrations, or repair catalog state.

V1 is bound to the current machine and temporary worktree:

```text
TEMPORARY_DEPLOYMENT_PATH = YES
WORKTREE = /private/tmp/temu-multi-category-safety-v1
CONFIG = /Users/chuangyangdianzi/Desktop/选品上架-家里版本/temu选品/config.json
```

This is not a long-term deployment design. A missing worktree or config is a hard failure. The launcher never searches for another repository, worktree, config, or main workspace.

## 2. Chosen Architecture

V1 uses a source-controlled macOS `.app` bundle with a shell executable, plus a testable Node launcher core.

```text
Finder double-click
  → 启动 Temu 运营台.app/Contents/MacOS/TemuOperatorLauncher
  → validate exact worktree and config paths
  → explicitly resolve and validate Node + npm in Finder environment
  → tools/operator-dashboard-launcher.mjs
  → verified health / port / lock state machine
  → spawn detached npm run dashboard only when absent
  → wait for verified Temu health identity
  → open system default browser
```

The `.app` avoids a Terminal window. Its executable uses `/bin/zsh` only as an internal runtime and displays a macOS dialog on failure. It never changes Gatekeeper or system security settings.

## 3. Files and Responsibilities

### `tools/operator-dashboard-launcher.mjs`

Exports a dependency-injected `launchOperatorDashboard(options)` for tests and provides the production CLI entry point. It owns:

- exact Temu health verification;
- TCP port occupancy checks;
- atomic launch lock acquisition and stale-lock recovery;
- detached Dashboard spawn;
- bounded health polling;
- bounded log rotation;
- diagnostic PID writing;
- browser opening only after verified health;
- stable error codes and log messages.

It does not import database, Campaign, catalog, migration, browser-extension, or capture modules.

### `启动 Temu 运营台.app/Contents/MacOS/TemuOperatorLauncher`

A source-controlled executable shell file. It:

1. checks the exact worktree directory;
2. checks the exact config file;
3. resolves `node` and `npm` from the Finder environment using explicit executable checks and a login-shell lookup;
4. invokes the Node launcher with fixed allowlisted arguments;
5. shows a persistent macOS error dialog with the log path when launch fails.

It does not open the browser itself. The Node core owns the health-before-open ordering.

### `启动 Temu 运营台.app/Contents/Info.plist`

Declares a normal macOS application bundle and the shell executable. The executable bit is part of acceptance and must be verified by automated test and final QA.

### Documentation and tests

- `docs/TEMU_OPERATOR_LAUNCHER_V1.md` documents use, temporary paths, PID inspection, manual stop, logs, Gatekeeper, and safety boundaries.
- `test/unit/operator-dashboard-launcher.test.mjs` tests the launch state machine on temporary ports and files.
- `test/unit/macos-operator-launcher.test.mjs` checks the `.app` bundle, executable mode, fixed paths, runtime validation, error dialog, and forbidden behavior.
- `test/fixtures/operator-dashboard-fixture.mjs` is a process-lifecycle fixture that can expose valid or invalid health identity and remain alive after its parent launcher returns.

## 4. Service Identity and Port Decision

The existing health endpoint gains additive fields:

```json
{
  "ok": true,
  "service": "temu-operator-dashboard",
  "apiVersion": 1,
  "environment": "development",
  "testMode": false
}
```

The launcher accepts health only when all of these are true:

```text
HTTP status = 200
Content-Type contains application/json
ok = true
service = temu-operator-dashboard
apiVersion = 1
environment is a non-empty string
testMode is a boolean
```

Decision table:

| Port/health state | Result |
| --- | --- |
| Verified Temu health | Do not spawn; open Dashboard URL |
| Port unused | Acquire lock; spawn Dashboard; poll health |
| Port occupied, HTTP or non-HTTP, identity invalid | `PORT_OCCUPIED_BY_OTHER_SERVICE`; do not kill, spawn, or open |
| Dashboard process exits or timeout occurs before verified health | `DASHBOARD_START_FAILED`; log and do not open |

PID files never establish health. Real state is always `TCP port + verified health identity`.

## 5. Duplicate Launch and Atomic Lock

The launcher uses an atomic directory creation under `logs/` as its startup lock. The lock records launcher PID, creation time, port, worktree, and a random ownership token.

The algorithm double-checks health and port after acquiring the lock so two simultaneous Finder launches cannot both spawn.

When a second launcher sees a lock:

1. it rechecks verified health;
2. if health becomes ready, it opens the page without spawning;
3. if the port is occupied by another identity, it hard fails;
4. if the recorded launcher PID is alive, it waits for the first launch within the same bounded timeout;
5. if the PID is absent/dead and the lock is older than the stale threshold while the port is unused, it removes only that exact launcher lock and retries once.

A missing/corrupt lock owner file is not removed until the stale threshold is exceeded. The launcher never kills the recorded PID or any port owner.

The lock is removed only by its matching ownership token after success or failure. A diagnostic Dashboard PID file is written after spawn, but is never trusted as service state.

## 6. Runtime Resolution and Process Lifetime

Finder does not inherit the interactive Terminal PATH. The `.app` executable must explicitly resolve both `node` and `npm`, verify each path is executable, and run `node --version` and `npm --version` before invoking the core.

Resolution is fail-closed. If either runtime cannot be resolved:

```text
NODE_RUNTIME_NOT_FOUND or NPM_RUNTIME_NOT_FOUND
Dashboard spawn count = 0
browser open count = 0
```

No runtime is downloaded or installed automatically.

The Dashboard child uses detached process semantics with all standard streams redirected to the log and the child unreferenced. Tests must prove:

```text
launcher returns
→ dashboard fixture remains alive and healthy
```

Maintenance stops the verified process manually; the `.app` has no stop/kill feature.

## 7. Logs and PID Diagnostics

Primary log:

```text
/private/tmp/temu-multi-category-safety-v1/logs/operator-dashboard.log
```

Before a new spawn, if the log exceeds 5 MiB, the launcher replaces `operator-dashboard.log.1` with the old log and creates a new primary log. V1 retains at most one rotated file. This is intentionally minimal rotation; more retention/compression is technical debt.

Diagnostic PID:

```text
logs/operator-dashboard.pid
```

The PID file contains the spawned Dashboard PID and timestamp. Operators never rely on it. Documentation uses `lsof -nP -iTCP:37821 -sTCP:LISTEN` to discover the actual listener, then requires manual identity confirmation before `kill <PID>`.

## 8. Database and Existing Safety Gates

The launcher directly opens no SQLite database and imports no database code:

```text
LAUNCHER_DIRECT_DB_WRITES = 0
```

Starting the existing Dashboard may legitimately execute its unchanged migration and `recoverInterrupted` startup behavior:

```text
DASHBOARD_STARTUP_RECOVERY_WRITES = POSSIBLE_EXISTING_BEHAVIOR
```

The launcher does not alter, bypass, suppress, repair, or emulate that behavior. A migration checksum failure is logged and displayed as startup failure. The launcher never changes SQL files, copies migrations, or rewrites `schema_migrations`.

The current catalog blocker must remain visible and enforced:

```text
Active Pool = 2135
Active Memberships = 1149
Intersection = 1149
baseline_consistency = false
Profile available = false
创建采集任务 = BLOCKED
```

Launcher acceptance includes a read-only assertion against the running Operator Profile API. No Active Pool or membership repair belongs to this task.

## 9. `.app` and Gatekeeper

The bundle executable must have executable permission (`mode & 0o111 != 0`). Final verification checks the permission from the filesystem and launches the executable directly in a controlled test environment.

Documentation explains that an unsigned local `.app` may show a first-open Gatekeeper prompt. The supported manual recovery is Finder **Open** from the context menu and user confirmation, subject to local policy. The launcher never runs `xattr`, `spctl`, changes System Settings, disables Gatekeeper, or requests automatic security bypass.

## 10. TDD Acceptance Matrix

All tests use temporary ports, directories, logs, and fixture processes. They never point a write test at the production database.

1. **Port free:** one detached fixture Dashboard starts, health identity passes, exact Dashboard URL opens.
2. **Already healthy:** spawn count remains zero and the exact URL opens.
3. **Foreign service:** invalid identity hard fails; foreign PID remains alive; no browser open.
4. **Startup failure:** log records the failure; browser does not open; operator error includes log path.
5. **Concurrent double-click:** two launch calls produce exactly one Dashboard child and both resolve through verified health.
6. **Stale lock:** dead owner + old lock + free port allows one safe retry; live or fresh lock is not removed prematurely.
7. **Runtime resolution:** executable Node/npm pass; missing Node or npm hard fails before core/spawn.
8. **Detached lifetime:** launcher exits while fixture Dashboard remains alive until explicit test cleanup.
9. **Service identity:** HTTP 200 with wrong/missing identity is rejected.
10. **Path binding:** missing exact worktree or config hard fails with no fallback.
11. **Bundle contract:** `.app` executable bit is present; source contains no migration repair, Campaign, capture, scroll, navigation, Chrome, Temu-page, kill, `xattr`, or `spctl` behavior.
12. **Baseline blocker:** verified production health can open the Dashboard while the read-only Profile response remains `available=false` and inconsistent; no Campaign is auto-created.

## 11. Git and Deployment Isolation

The nine approved CRLF migration byte differences remain uncommitted and are excluded from every Launcher commit:

```text
001_core.sql
002_catalog.sql
003_quality_and_classification.sql
004_job_control.sql
009_market_analysis.sql
010_fine_classification.sql
011_ai_provider_audit.sql
012_reviews.sql
013_review_session_recovery.sql
```

Every Launcher commit stages exact allowlisted paths. Final verification reports `git status` separately and confirms no migration path appears in Launcher commits.

## 12. Final Gates

```text
OPERATOR_LAUNCHER_READY = YES / NO
TERMINAL_REQUIRED_FOR_OPERATOR = YES / NO
DUPLICATE_DASHBOARD_PREVENTED = YES / NO
HEALTH_GATE_BEFORE_BROWSER_OPEN = YES / NO
BASELINE_HARD_FAIL_PRESERVED = YES / NO
TEMPORARY_DEPLOYMENT_PATH = YES
LAUNCHER_DIRECT_DB_WRITES = 0 / nonzero
DASHBOARD_STARTUP_RECOVERY_WRITES = NONE_OBSERVED / POSSIBLE / OBSERVED
REAL_TEMU_CAPTURE_STARTED = YES / NO
CAMPAIGN_AUTO_CREATED = YES / NO
```

`DO NOT PUSH`, `DO NOT REPAIR ACTIVE POOL`, and `DO NOT START REAL TEMU CAPTURE` remain mandatory.
