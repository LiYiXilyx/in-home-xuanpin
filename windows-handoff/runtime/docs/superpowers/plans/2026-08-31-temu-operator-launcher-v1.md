# Temu Operator Launcher V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a Finder-double-clickable macOS application that starts at most one verified Temu Operator Dashboard, waits for exact health identity, and opens the localhost console without exposing Terminal or weakening any catalog safety gate.

**Architecture:** A small additive health identity lets a dependency-injected Node launcher distinguish the Temu Dashboard from any other listener. The Node launcher owns the port/health/lock/spawn/log/open state machine; a source-controlled `.app` shell executable only validates fixed paths and Finder runtime availability before invoking that core. All launch tests use temporary ports, files, and child fixtures; production validation is read-only except for the already-running Dashboard's unchanged startup semantics.

**Tech Stack:** Node.js ESM, Node test runner, `node:http`, `node:net`, `node:child_process`, filesystem lock directories, macOS `.app` bundle, zsh, AppleScript error dialog.

**Spec:** `docs/superpowers/specs/2026-08-31-temu-operator-launcher-v1-design.md`

## Global Constraints

- Work only in `/private/tmp/temu-multi-category-safety-v1` on `codex/multi-category-safety-v1`.
- `TEMPORARY_DEPLOYMENT_PATH = YES`; do not describe V1 as long-term deployment.
- The production worktree path is exactly `/private/tmp/temu-multi-category-safety-v1`; missing means hard fail with no repository fallback.
- The production config path is exactly `/Users/chuangyangdianzi/Desktop/选品上架-家里版本/temu选品/config.json`; missing means hard fail with no config fallback.
- Do not push, repair Active Pool, modify memberships, create or resume a Campaign, or start real Temu capture.
- Do not modify Dashboard migration/recovery semantics.
- Do not modify, copy, normalize, stage, or commit any migration as part of Launcher work.
- The nine existing CRLF migration diffs remain uncommitted and must be absent from every Launcher commit.
- Do not kill any listener, lock owner, or PID-file process.
- Browser open occurs only after exact health identity passes.
- PID files are diagnostic only; service state is port plus verified health.
- The `.app` must not start Chrome, Temu, Extension, Campaign, capture, scroll, navigation, See more, migration repair, or checksum repair.
- All automated write tests use temporary directories, ports, logs, and fixture processes.
- Launcher imports no database code and performs zero direct database writes.

---

### Task 1: Add Explicit Temu Dashboard Health Identity

**Files:**
- Modify: `src/server/router.mjs`
- Create: `test/integration/operator-launcher-health.test.mjs`

**Interfaces:**
- Produces: `GET /api/health` response with `service: "temu-operator-dashboard"` and `apiVersion: 1`.
- Preserves: existing `ok`, `environment`, and `testMode` fields and all current route behavior.
- Does not consume or expose database, Campaign, browser, or capture state.

- [ ] **Step 1: Write the failing health identity test**

Use a temporary config and Operations Server. The test must use a temporary SQLite path and ephemeral port:

```js
test('health endpoint exposes stable Temu operator service identity without starting work',async t => {
  const app=await createOperationsServer({config:fixtureConfig(t),runProcess:()=>assert.fail('must not start work'),
    openTarget:async()=>assert.fail('must not open target'),logError:()=>{},browserDependencies:{ready:async()=>false}});
  t.after(()=>app.close());
  const address=await app.listen({port:0});
  const response=await fetch(`${address.url}/api/health`);const body=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(body,{ok:true,service:'temu-operator-dashboard',apiVersion:1,environment:'development',testMode:false});
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) count FROM catalog_campaigns').get().count),0);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/integration/operator-launcher-health.test.mjs
```

Expected: FAIL because `service` and `apiVersion` are missing.

- [ ] **Step 3: Add the minimal additive identity**

Change only the existing health route:

```js
if (request.method === 'GET' && url.pathname === '/api/health') return json(response,200,{
  ok:true,service:'temu-operator-dashboard',apiVersion:1,
  environment:environment.name,testMode:environment.testMode
});
```

- [ ] **Step 4: Run GREEN and route regressions**

```bash
node --test test/integration/operator-launcher-health.test.mjs test/integration/server-jobs.test.mjs
npm run check
```

The new test must pass. `server-jobs.test.mjs` may contain only its exact two approved Excel/reset baseline failures; no new identity or route failure is allowed.

- [ ] **Step 5: Verify migration exclusion and commit Task 1**

```bash
git diff --check -- src/server/router.mjs test/integration/operator-launcher-health.test.mjs
git add src/server/router.mjs test/integration/operator-launcher-health.test.mjs
git diff --cached --name-only
git commit -m "feat: identify Temu operator dashboard health"
```

The cached name list must contain exactly the two Task 1 paths and no `db/migrations/` path.

---

### Task 2: Health, Port, and Lock State Machine

**Files:**
- Create: `tools/operator-dashboard-launcher.mjs`
- Create: `test/unit/operator-dashboard-launcher.test.mjs`

**Interfaces:**
- Produces: `probeDashboardHealth({healthUrl,fetchImpl,requestTimeoutMs})` returning `{state:'ready'|'foreign'|'unreachable',details}`.
- Produces: `isTcpPortOccupied({host,port,connectTimeoutMs})` returning a boolean without killing or mutating the listener.
- Produces: `acquireLaunchLock({lockPath,metadata,now,isProcessAlive,staleAfterMs})` returning an owned lock or a wait decision.
- Produces: `launchOperatorDashboard(options)` returning `{action:'opened-existing'|'started-and-opened',dashboardUrl,pid}`.
- Consumes in later tasks: injected `spawnDashboard`, `openDashboard`, `sleep`, `now`, and `isProcessAlive` dependencies.

- [ ] **Step 1: Write RED tests for exact health identity**

Use real temporary HTTP servers for valid and foreign identity:

```js
test('HTTP 200 is accepted only with exact Temu service identity',async t => {
  const good=await healthServer(t,{ok:true,service:'temu-operator-dashboard',apiVersion:1,environment:'development',testMode:false});
  assert.equal((await probeDashboardHealth({healthUrl:good.url})).state,'ready');
  const foreign=await healthServer(t,{ok:true,service:'another-service',apiVersion:1,environment:'development',testMode:false});
  assert.equal((await probeDashboardHealth({healthUrl:foreign.url})).state,'foreign');
});
```

Also test wrong content type, malformed JSON, missing fields, HTTP 404, and unused port.

- [ ] **Step 2: Run and verify RED**

```bash
node --test --test-name-pattern="exact Temu service identity" test/unit/operator-dashboard-launcher.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement minimal health and TCP probes**

Use `AbortSignal.timeout()` or an internal `AbortController` for bounded fetch. Validate exact fields and content type. Use `node:net` connect with handlers for `connect`, `ECONNREFUSED`, timeout, and other occupied/error outcomes. Never call process-management commands.

- [ ] **Step 4: Write RED tests for already-running and foreign-port behavior**

```js
test('healthy dashboard opens without spawn',async t => {
  const server=await healthServer(t,temuHealth());let spawns=0,opened=[];
  const result=await launchOperatorDashboard(fixtureOptions(t,server.port,{
    spawnDashboard:async()=>{spawns+=1;throw new Error('must not spawn');},
    openDashboard:async url=>opened.push(url)
  }));
  assert.equal(result.action,'opened-existing');assert.equal(spawns,0);
  assert.deepEqual(opened,[`http://127.0.0.1:${server.port}/`]);
});

test('foreign listener hard fails without kill spawn or open',async t => {
  const server=await healthServer(t,{ok:true,service:'foreign',apiVersion:1,environment:'x',testMode:false});
  let spawns=0,opens=0;
  await assert.rejects(()=>launchOperatorDashboard(fixtureOptions(t,server.port,{
    spawnDashboard:async()=>{spawns+=1;},openDashboard:async()=>{opens+=1;}
  })),error=>error.code==='PORT_OCCUPIED_BY_OTHER_SERVICE');
  assert.equal(spawns,0);assert.equal(opens,0);
  const stillServing=await fetch(server.url);
  assert.equal(stillServing.status,200);
});
```

The final fetch is the no-kill evidence: an in-process test server has no distinct PID, so a PID assertion here would not prove the requirement.

- [ ] **Step 5: Implement the initial decision table**

Order must be:

```text
probe exact health
→ ready: open and return
→ not ready: inspect TCP port
→ occupied: hard fail
→ free: continue to lock/spawn path
```

All thrown errors include stable `code`, operator-safe `message`, and `logPath` where relevant.

- [ ] **Step 6: Write RED tests for lock ownership and stale recovery**

Cover:

```js
test('dead old lock is removed but live or fresh lock is preserved',async t => {
  const lock=lockFixture(t);
  lock.write({launcherPid:999999,createdAt:'2026-08-31T00:00:00.000Z',ownershipToken:'old'});
  const acquired=acquireLaunchLock({...lock.options,now:()=>Date.parse('2026-08-31T00:01:00Z'),
    staleAfterMs:5000,isProcessAlive:()=>false});
  assert.equal(acquired.owned,true);
  assert.notEqual(acquired.ownershipToken,'old');
});
```

Separate assertions must prove a live PID and a dead-but-fresh lock are not removed. Corrupt metadata follows the same age threshold.

- [ ] **Step 7: Implement atomic lock and token-safe release**

Use atomic `fs.mkdirSync(lockPath)`. Write `owner.json` inside the owned directory. On release, reread the token and remove only when it matches. Retry stale recovery at most once. Do not kill any PID.

- [ ] **Step 8: Run Task 2 tests and static check**

```bash
node --test test/unit/operator-dashboard-launcher.test.mjs
node --check tools/operator-dashboard-launcher.mjs
```

Expected: all Task 2 tests pass.

- [ ] **Step 9: Commit Task 2 with exact paths**

```bash
git add tools/operator-dashboard-launcher.mjs test/unit/operator-dashboard-launcher.test.mjs
git diff --cached --name-only
git commit -m "feat: guard Temu dashboard launch state"
```

No migration file may be staged.

---

### Task 3: Detached Spawn, Concurrency, Logs, and PID Diagnostics

**Files:**
- Modify: `tools/operator-dashboard-launcher.mjs`
- Modify: `test/unit/operator-dashboard-launcher.test.mjs`
- Create: `test/fixtures/operator-dashboard-fixture.mjs`

**Interfaces:**
- Extends: `launchOperatorDashboard(options)` with production defaults for detached spawn, health polling, log rotation, PID diagnostics, and system browser open.
- Fixture CLI consumes: `--port`, `--mode valid|foreign|exit`, and optional counter/PID file paths.
- Produces logs: `logs/operator-dashboard.log`, `logs/operator-dashboard.log.1`.
- Produces diagnostic PID: `logs/operator-dashboard.pid`.

- [ ] **Step 1: Create the process fixture and write the port-free RED test**

The fixture starts a real HTTP server with the Task 1 identity, writes its PID, and keeps the event loop alive. The test passes a fixture spawn command to the real launcher:

```js
test('free port starts detached dashboard, waits for health, then opens exact URL',async t => {
  const fixture=launcherFixture(t);const opened=[];
  const result=await launchOperatorDashboard({...fixture.options,
    dashboardCommand:[process.execPath,[fixture.script,'--port',String(fixture.port),'--mode','valid']],
    openDashboard:async url=>opened.push(url)});
  assert.equal(result.action,'started-and-opened');
  assert.deepEqual(opened,[fixture.dashboardUrl]);
  assert.equal((await probeDashboardHealth({healthUrl:fixture.healthUrl})).state,'ready');
  await waitForExitOfLauncherCall();
  assert.equal(processAlive(result.pid),true);
});
```

- [ ] **Step 2: Run and verify RED**

Expected: FAIL because spawn/polling behavior is not implemented.

- [ ] **Step 3: Implement detached spawn and health polling**

Production default must execute the equivalent of:

```text
cwd = exact worktree
TEMU_CONFIG_PATH = exact config
npm run dashboard
detached = true
stdin = ignore
stdout/stderr = append log file descriptors
child.unref()
```

Do not use shell interpolation for supplied paths. The implementation may use the explicitly resolved npm path passed by the `.app`, with arguments `run dashboard`.

Poll until exact health identity is ready, the child exits, or timeout expires. Open only after ready.

- [ ] **Step 4: Write RED concurrency test**

Start two launcher calls simultaneously against one free temporary port and shared lock/log directory:

```js
const [first,second]=await Promise.all([
  launchOperatorDashboard(options),launchOperatorDashboard(options)
]);
assert.equal(readSpawnCounter(),1);
assert.deepEqual(new Set([first.action,second.action]),new Set(['started-and-opened','opened-existing']));
```

The second caller may wait on the live launcher lock but must never spawn.

- [ ] **Step 5: Implement wait-on-owner behavior and prove one spawn**

While a live/fresh lock exists, poll health and port without deleting the lock. When health becomes verified, return through the existing path. If a foreign service appears, hard fail.

- [ ] **Step 6: Write startup-failure and log RED tests**

Use fixture `--mode exit` and assert:

```text
error.code = DASHBOARD_START_FAILED
open count = 0
primary log exists
log contains child exit/start failure evidence
operator error contains absolute log path
```

Create a log larger than 5 MiB before a new spawn and assert it becomes `.log.1`, the new primary stays smaller, and only two files remain.

- [ ] **Step 7: Implement failure logging, bounded rotation, and PID diagnostics**

Rotation rules:

```text
if primary size > 5 MiB:
  remove only exact .log.1 if present
  rename primary to .log.1
create/append new primary
```

Write PID JSON atomically after spawn. Never read it to decide health and never kill it.

- [ ] **Step 8: Run Task 3 and related regressions**

```bash
node --test test/unit/operator-dashboard-launcher.test.mjs test/integration/operator-launcher-health.test.mjs
npm run check
```

All Launcher tests must pass; no new regression failure is allowed.

- [ ] **Step 9: Commit Task 3**

```bash
git add tools/operator-dashboard-launcher.mjs test/unit/operator-dashboard-launcher.test.mjs test/fixtures/operator-dashboard-fixture.mjs
git diff --cached --name-only
git commit -m "feat: launch Temu dashboard in background"
```

No migration file may be staged.

---

### Task 4: Finder `.app` Runtime and Error UX

**Files:**
- Create: `启动 Temu 运营台.app/Contents/Info.plist`
- Create: `启动 Temu 运营台.app/Contents/MacOS/TemuOperatorLauncher`
- Create: `scripts/macos/resolve-temu-operator-runtime.sh`
- Create: `test/unit/macos-operator-launcher.test.mjs`

**Interfaces:**
- `.app` consumes exact fixed worktree/config and invokes `tools/operator-dashboard-launcher.mjs`.
- Resolver produces two newline-separated absolute executable paths: Node then npm; nonzero exit uses `NODE_RUNTIME_NOT_FOUND` or `NPM_RUNTIME_NOT_FOUND`.
- `.app` failure displays `Temu 运营台启动失败` and the exact log path via `/usr/bin/osascript`.
- `.app` success produces no Terminal window and delegates browser opening to Node core.

- [ ] **Step 1: Write RED source/bundle contract tests**

```js
test('macOS app is executable, fixed-path, and contains no unsafe automation',()=>{
  const executable=appExecutable();const mode=fs.statSync(executable).mode;
  assert.notEqual(mode & 0o111,0);
  const source=fs.readFileSync(executable,'utf8');
  assert.match(source,/\/private\/tmp\/temu-multi-category-safety-v1/);
  assert.match(source,/选品上架-家里版本\/temu选品\/config\.json/);
  assert.doesNotMatch(source,/find .*config|git rev-parse|schema_migrations|migration.*repair|campaign|capture|scroll|navigation|see more|chrome|temu\.com|kill |pkill|xattr|spctl/i);
});
```

Assert `Info.plist` points to `TemuOperatorLauncher` and declares an application bundle.

- [ ] **Step 2: Run and verify RED**

```bash
node --test test/unit/macos-operator-launcher.test.mjs
```

Expected: missing `.app` bundle.

- [ ] **Step 3: Write RED behavioral tests for fixed paths and runtime resolution**

Execute the resolver with a temporary controlled lookup path containing executable fake `node` and `npm`, then without each one:

```text
Node + npm executable → exit 0 and exact absolute paths
Node missing → NODE_RUNTIME_NOT_FOUND, no core invocation marker
npm missing → NPM_RUNTIME_NOT_FOUND, no core invocation marker
```

The resolver accepts an optional lookup path only for deterministic tests. Without that argument it checks explicit macOS candidates and then a login-shell lookup; with the argument it searches only that path and performs no fallback.

Test the `.app` executable with explicit hooks enabled only by `TEMU_OPERATOR_LAUNCHER_TEST_MODE=1`: a dialog recorder and core recorder. Production execution must ignore those hook variables unless this flag is exactly `1`. Missing worktree must produce `OPERATOR_WORKTREE_NOT_FOUND`; missing config must produce `OPERATOR_CONFIG_NOT_FOUND`. These hooks may only replace side-effect sinks; they may not weaken production path or health checks.

- [ ] **Step 4: Implement resolver and `.app` bundle**

Resolver order is explicit executable candidates followed by login-shell `command -v`. Every result must be absolute, executable, and pass `--version`. It downloads nothing.

The `.app` executable flow is exactly:

```text
check fixed worktree directory
check fixed config regular file
resolve Node/npm
invoke Node core with explicit --worktree, --config, --npm, --port 37821
on nonzero: display persistent macOS dialog with log path
```

Set executable permissions:

```bash
chmod 755 '启动 Temu 运营台.app/Contents/MacOS/TemuOperatorLauncher'
chmod 755 scripts/macos/resolve-temu-operator-runtime.sh
```

- [ ] **Step 5: Run `.app` tests and direct controlled launch test**

```bash
node --test test/unit/macos-operator-launcher.test.mjs test/unit/operator-dashboard-launcher.test.mjs
test -x '启动 Temu 运营台.app/Contents/MacOS/TemuOperatorLauncher'
plutil -lint '启动 Temu 运营台.app/Contents/Info.plist'
```

No production Dashboard is spawned by these tests.

- [ ] **Step 6: Commit Task 4 with exact app paths**

```bash
git add '启动 Temu 运营台.app/Contents/Info.plist' \
  '启动 Temu 运营台.app/Contents/MacOS/TemuOperatorLauncher' \
  scripts/macos/resolve-temu-operator-runtime.sh test/unit/macos-operator-launcher.test.mjs
git diff --cached --summary
git diff --cached --name-only
git commit -m "feat: add macOS Temu operator app"
```

The summary must show executable mode and no migration file.

---

### Task 5: Operations Runbook and Final Safety Verification

**Files:**
- Create: `docs/TEMU_OPERATOR_LAUNCHER_V1.md`
- Create: `docs/superpowers/verification/2026-08-31-temu-operator-launcher-v1.md`
- Modify: `启动说明.md`

**Interfaces:**
- Documents Finder launch, temporary path status, fixed config, logs, PID inspection, manual stop, Gatekeeper, and current baseline blocker.
- Records fresh automated and read-only production evidence.

- [ ] **Step 1: Write operator and maintenance instructions**

Document:

```text
双击 启动 Temu 运营台.app
正常成功不需要 Terminal
TEMPORARY_DEPLOYMENT_PATH = YES
worktree/config missing = HARD FAIL
log = /private/tmp/temu-multi-category-safety-v1/logs/operator-dashboard.log
PID discovery = lsof -nP -iTCP:37821 -sTCP:LISTEN
stop = verify identity first, then manually kill the exact PID
```

Explain that the PID file is diagnostic only. Explain Finder context-menu **Open** for a first-open Gatekeeper prompt and explicitly forbid automatic `xattr`, `spctl`, or system-security changes.

State the minimal log retention and technical debt: 5 MiB threshold, one `.1` file, no compression/multi-generation retention.

- [ ] **Step 2: Run NEW_FEATURE_TESTS**

```bash
node --test test/integration/operator-launcher-health.test.mjs \
  test/unit/operator-dashboard-launcher.test.mjs \
  test/unit/macos-operator-launcher.test.mjs
```

Expected: 100% pass.

- [ ] **Step 3: Run related safety regressions**

```bash
node --test test/integration/operator-campaign-api.test.mjs \
  test/integration/operator-campaign-create.test.mjs \
  test/integration/catalog-manual-binding.test.mjs \
  test/unit/operator-campaign-console.test.mjs \
  test/unit/catalog-manual-passive-runner.test.mjs
npm run check
npm run check:opportunity
```

Expected: all selected tests and checks pass.

- [ ] **Step 4: Verify process and safety behavior on fixtures**

Record fresh evidence for:

```text
port free → one process, health ready, exact open URL
already healthy → zero spawn
foreign identity → hard fail, foreign process alive
startup failure → log exists, zero browser open
two concurrent launchers → spawn counter = 1
stale dead lock → safe one-time recovery
launcher returned → fixture process still alive
Node/npm missing → zero spawn
```

- [ ] **Step 5: Perform controlled live acceptance with the updated Dashboard**

The Dashboard currently running before implementation predates Task 1 and therefore cannot satisfy the new exact identity. Record its Campaign count and Profile response, then stop only the exact Dashboard instance owned by this task's existing execution session. Do not discover or stop a process by port, PID file, or guessed PID. With the port confirmed free, launch the updated Dashboard through the `.app`, wait for verified health, and invoke the `.app` a second time to prove the existing-service path. This is acceptance orchestration, not Launcher kill behavior.

Capture before/after evidence:

```text
health.service = temu-operator-dashboard
health.apiVersion = 1
profile.active_pool_count = 2135
baseline activeMembershipCount = 1149
baseline intersectionCount = 1149
baseline consistent = false
profile.available = false
Campaign count unchanged
first invocation starts exactly one Dashboard
second invocation leaves Dashboard process count = 1
```

Opening the localhost page is allowed; do not interact with Campaign creation or Temu capture.
Report any existing Dashboard migration/recovery startup writes separately from Launcher direct writes. If the known execution session cannot be proven to own the current service, do not stop it; mark live restart acceptance blocked and rely only on fixture evidence rather than risking another process.

- [ ] **Step 6: Run full suite and compare exact baseline failures**

```bash
npm test
```

Compare by file, exact test name, and reason. Only the approved seven baseline failures are allowed; `NEW_FAILURES = 0`.

- [ ] **Step 7: Audit forbidden code and database imports**

```bash
rg -n "schema_migrations|migration.*repair|createOperatorManualCampaign|capture|scroll|navigation|see more|temu\.com|pkill|kill\s|xattr|spctl" \
  tools/operator-dashboard-launcher.mjs scripts/macos '启动 Temu 运营台.app'
rg -n "db/client|db/repositories|openDatabase|migrateDatabase" tools/operator-dashboard-launcher.mjs scripts/macos '启动 Temu 运营台.app'
```

Expected: no production unsafe or database import match. Allow only documentation/error strings that tests explicitly inspect.

- [ ] **Step 8: Prove migration diff isolation**

```bash
git status --short
git log --format='%H' d693740..HEAD | while read commit; do
  git diff-tree --no-commit-id --name-only -r "$commit"
done
```

The status may show the exact nine approved migration line-ending diffs. No Launcher commit may contain `db/migrations/`.

- [ ] **Step 9: Record final gates**

Write evidence-backed values:

```text
OPERATOR_LAUNCHER_READY = YES / NO
TERMINAL_REQUIRED_FOR_OPERATOR = NO / YES
DUPLICATE_DASHBOARD_PREVENTED = YES / NO
HEALTH_GATE_BEFORE_BROWSER_OPEN = YES / NO
BASELINE_HARD_FAIL_PRESERVED = YES / NO
TEMPORARY_DEPLOYMENT_PATH = YES
LAUNCHER_DIRECT_DB_WRITES = 0 / nonzero
DASHBOARD_STARTUP_RECOVERY_WRITES = NONE_OBSERVED / POSSIBLE / OBSERVED
PRODUCTION_DATABASE_WRITES = 0 / nonzero, with launcher/startup distinction
REAL_TEMU_CAPTURE_STARTED = NO / YES
CAMPAIGN_AUTO_CREATED = NO / YES
NEW_FAILURES = 0 / count
```

- [ ] **Step 10: Commit Task 5 exact documentation paths**

```bash
git add docs/TEMU_OPERATOR_LAUNCHER_V1.md \
  docs/superpowers/verification/2026-08-31-temu-operator-launcher-v1.md \
  启动说明.md
git diff --cached --name-only
git commit -m "docs: verify Temu operator launcher"
```

No migration file may be staged or committed.

- [ ] **Step 11: Final repository report**

```bash
git status --short --branch
git log --oneline d693740..HEAD
```

Keep the branch and worktree. Do not push.
