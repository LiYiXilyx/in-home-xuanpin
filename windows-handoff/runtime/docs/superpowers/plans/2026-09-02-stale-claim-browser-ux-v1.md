# Stale Claim Recovery + Manual Bind Browser UX V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fail-closed stale Catalog claim inspection/recovery, complete blocker UX, and a Manual Bind flow that is independent of legacy CDP.

**Architecture:** A focused claim-recovery repository/service owns immutable evidence, deterministic stale evaluation and atomic terminalization. The Catalog controller/API/UI consume server-authoritative blocker records; a process activity registry supplies transient liveness. Existing Initial Campaign creation remains explicit and zero-write on conflicts.

**Tech Stack:** Node.js ESM, `node:test`, SQLite STRICT tables, vanilla browser modules, existing Catalog service/router.

**Spec:** `docs/superpowers/specs/2026-09-02-stale-claim-browser-ux-v1-design.md`

## Global Constraints

- Minimum thresholds: heartbeat `1800000`, inspection interval `10000`, binding lease `30000`, legacy inactivity `86400000` milliseconds.
- Only `paused` Campaigns are stale-eligible; `running` and `manual_required` are never timeout-terminalized.
- Unknown worker/binding/in-flight evidence fails closed.
- No Product, Membership, Pool, Pool item, snapshot or taxonomy mutation.
- No implicit resume, automatic Campaign retry, real capture, scrolling, binding, QA or activation.
- Tests write only temporary SQLite until Task 8's explicitly authorized production stage.
- Each task runs RED → minimal implementation → GREEN → related regression → `git diff --check` → commit.
- Do not change YingDao business files or the seven approved baseline failures.
- Keep the local untracked `node_modules` symlink and all nine pre-existing CRLF migration differences out of every feature commit.

---

### Task 1: Claim inspection schema, repository and complete blocker list

**Files:**
- Create: `db/migrations/027_catalog_rpa_claim_recovery.sql`
- Create: `src/db/repositories/catalog-claim-recovery-repository.mjs`
- Create: `src/modules/catalog-scale/catalog-claim-inspection.mjs`
- Create: `test/integration/catalog-claim-inspection.test.mjs`
- Modify: `src/db/repositories/catalog-campaign-repository.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`

**Interfaces:**
- Produces `createCatalogClaimRecoveryRepository(db,{now})` with `listBlockerRows()`, `insertInspection(record)`, `getInspection(id)`.
- Produces `createCatalogClaimInspectionService({repository,activityRegistry,thresholds,now})` with `listBlockers()` and `inspect({campaignId,previousInspectionId})`.

- [ ] Write RED tests that seed two claimed queues and assert deterministic `primaryBlocker`, complete `allBlockers`, exact joined identities and immutable inspection rows.
- [ ] Run `node --test test/integration/catalog-claim-inspection.test.mjs`; expect missing migration/service failure.
- [ ] Add migration 027 with inspection/audit tables, claim generation and append-only UPDATE/DELETE guards; do not edit earlier migrations.
- [ ] Implement joined blocker reads and canonical mapping. Use latest trustworthy activity, claim time and IDs for ordering.
- [ ] Change Initial/Expansion conflict errors to include `details: inspectionService.listBlockers()` while preserving transaction zero writes.
- [ ] Run the Task 1 test and `test/integration/initial-campaign-create.test.mjs test/integration/operator-campaign-create.test.mjs` to GREEN.
- [ ] Run `git diff --check` and commit `feat: inspect complete Catalog claim blockers`.

### Task 2: Thresholds, activity registry and stale determination

**Files:**
- Create: `src/modules/catalog-scale/catalog-activity-registry.mjs`
- Create: `src/modules/catalog-scale/catalog-claim-stale-policy.mjs`
- Create: `test/unit/catalog-claim-stale-policy.test.mjs`
- Modify: `src/config/defaults.mjs`
- Modify: `src/config/validate.mjs`
- Modify: `src/modules/catalog-scale/catalog-claim-inspection.mjs`

**Interfaces:**
- Produces `createCatalogActivityRegistry()` with `enter(scope,kind)`, `leave(token)`, `snapshot(scope)` and `run(scope,kind,fn)`.
- Produces `resolveClaimRecoveryThresholds(config)` and `evaluateClaimStale({current,previous,activity,thresholds,now})`.

- [ ] Write RED boundary tests for 29/30 minutes, 23/24 hours, running/manual-required, live/unknown worker, 30-second binding lease and any in-flight flag.
- [ ] Run `node --test test/unit/catalog-claim-stale-policy.test.mjs`; expect module-not-found.
- [ ] Implement constants as immutable floors; reject lower configured values and ignore request/UI overrides.
- [ ] Implement deterministic stale reasons and exactly `ACTIVE`, `NOT_ELIGIBLE`, `STALE_NOT_PROVEN`, `STALE_CONFIRMED`.
- [ ] Implement the activity registry with exact Campaign/Queue scope and `try/finally` cleanup.
- [ ] Run Task 2 tests plus configuration and Manual Bind tests to GREEN.
- [ ] Run `git diff --check` and commit `feat: determine stale Catalog claims safely`.

### Task 3: Double inspection, binding lease and race evidence

**Files:**
- Modify: `src/db/repositories/catalog-claim-recovery-repository.mjs`
- Modify: `src/modules/catalog-scale/catalog-claim-inspection.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Modify: `browser-extension/catalog-manual-passive-runner.js`
- Create: `test/integration/catalog-claim-double-inspection.test.mjs`
- Modify: `test/unit/catalog-manual-passive-runner.test.mjs`

**Interfaces:**
- `inspect({campaignId,previousInspectionId})` persists a versioned evidence snapshot and may confirm only against a valid prior record.
- Extension checkpoints include `binding_heartbeat_at`, `binding_generation`, `binding_fingerprint`, exact claim generation and scope.

- [ ] Write RED tests for <10-second interval, token/generation change, progress/checkpoint change, recovered heartbeat/binding and stable legacy fallback.
- [ ] Run the focused tests; expect missing double-inspection behavior.
- [ ] Add canonical versioned progress/binding fingerprints and maximum trustworthy activity calculation.
- [ ] Persist immutable first/second evidence and reject cross-scope or reordered inspection IDs.
- [ ] Add exact binding lease heartbeat fields without enabling auto capture/navigation.
- [ ] Run focused tests plus capture idempotency and binding invalidation regressions to GREEN.
- [ ] Run `git diff --check` and commit `feat: require stable double claim inspection`.

### Task 4: Atomic end-stale service, audit and idempotency

**Files:**
- Modify: `src/db/repositories/catalog-claim-recovery-repository.mjs`
- Create: `src/modules/catalog-scale/catalog-claim-recovery-service.mjs`
- Modify: `src/modules/catalog-scale/catalog-campaign-service.mjs`
- Create: `test/integration/catalog-claim-termination.test.mjs`

**Interfaces:**
- Produces `endStaleClaim({campaignId,queueId,sourceId,firstInspectionId,secondInspectionId,expectedClaimToken,expectedClaimGeneration,requestId,operatorConfirmation})`.
- Returns exact previous/new status identities and `idempotentReplay`.

- [ ] Write RED tests for recheck failure zero writes, successful four-entity terminalization, Source Run finish reason, append-only audit, replay/conflict and fault injection after each write.
- [ ] Run Task 4 test; expect missing service.
- [ ] Implement a single SQLite transaction that re-evaluates stale evidence after transaction start and consults activity registry.
- [ ] Transition Campaign/Queue/Source to cancelled, finish open Source Runs with `STALE_CLAIM_ENDED_BY_OPERATOR`, retain historical evidence and insert one audit.
- [ ] Verify Products, Memberships, Pools, Pool items, snapshots, staging and batches are fingerprint-identical.
- [ ] Run Task 4 and Initial activation/capture isolation regressions to GREEN.
- [ ] Run `git diff --check` and commit `feat: atomically end confirmed stale claims`.

### Task 5: Operator APIs and Catalog blocker UI

**Files:**
- Modify: `src/server/index.mjs`
- Modify: `src/server/controllers/catalog-controller.mjs`
- Modify: `src/server/router.mjs`
- Modify: `ui/modules/catalog/api.js`
- Modify: `ui/modules/catalog/state.js`
- Modify: `ui/modules/catalog/panel.js`
- Modify: `ui/modules/catalog/catalog.css`
- Create: `test/integration/catalog-claim-recovery-api.test.mjs`
- Modify: `test/unit/catalog-panel.test.mjs`

**Interfaces:**
- GET `/api/catalog/operator/rpa-claim-blockers`.
- POST `/api/catalog/operator/rpa-claims/:campaign_id/inspections`.
- POST `/api/catalog/operator/rpa-claims/:campaign_id/end-stale`.

- [ ] Write RED API tests for local-only mutations, full blocker metadata, inspection identity, fixed confirmation, 409 mappings and zero-write stale failures.
- [ ] Write RED UI tests for primary/all cards, disabled actions and explicit second confirmation.
- [ ] Wire activity/inspection/recovery services through server/controller/router without adding non-Catalog endpoints.
- [ ] Extend `catalogState` with private blocker/inspection/recovery fields and render only within `catalog-module-root`.
- [ ] Surface `CATALOG_RPA_CLAIM_CONFLICT` details and refresh blockers after actions; never auto-retry create.
- [ ] Run focused API/UI tests and Catalog/YingDao isolation regression to GREEN.
- [ ] Run `git diff --check` and commit `feat: show and recover Catalog claim blockers`.

### Task 6: Downgrade legacy CDP and expose Manual Bind steps

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/app.js`
- Modify: `ui/styles.css`
- Modify: `ui/modules/catalog/panel.js`
- Modify: `ui/modules/catalog/catalog.css`
- Create: `test/unit/manual-bind-browser-ux.test.mjs`
- Modify: `test/unit/catalog-panel.test.mjs`

**Interfaces:**
- Legacy shell retains `/api/browser/connect` only inside collapsed advanced tools.
- Catalog module displays six extension-driven steps independent of CDP state.

- [ ] Write RED markup/behavior tests asserting the new advanced label, helper text, six steps and no CDP prerequisite in Catalog.
- [ ] Run focused tests; expect old copy/layout failures.
- [ ] Move existing controls—not browser behavior—into `<details>` advanced tools and remove the global CDP prerequisite copy.
- [ ] Render the Manual Bind steps from Catalog, keeping Browser Health/Jobs/Review legacy logic in `app.js`.
- [ ] Prove CDP failure leaves Profile capability, Initial create and extension path enabled.
- [ ] Run focused UI, Browser legacy and dual-module isolation tests to GREEN.
- [ ] Run `git diff --check` and commit `feat: clarify Manual Bind browser workflow`.

### Task 7: girls-sets and creation safety regression

**Files:**
- Create: `test/integration/girls-sets-initial-after-claim-recovery.test.mjs`
- Modify: `test/integration/initial-campaign-create.test.mjs`
- Modify: `test/integration/operator-campaign-api.test.mjs`
- Create: `scripts/verify-stale-claim-browser-ux-v1.mjs`
- Modify: `package.json`

**Interfaces:**
- Verifier rejects production config/input and uses only self-owned temporary SQLite.
- Tests use the exact girls-sets profile shape but never read/write the production registry.

- [ ] Write RED end-to-end fixture: two blockers prevent Initial; confirmed atomic endings clear blockers; exact request creates one OPEN_ENDED/UNBOUND Initial; replay stays one.
- [ ] Assert CDP disconnected does not change Profile availability or Manual Bind extension contract.
- [ ] Implement only missing integration seams and a production-input-rejecting verifier.
- [ ] Run new feature tests, related Catalog tests and YingDao isolation tests to GREEN.
- [ ] Run `git diff --check` and commit `test: verify stale claim recovery delivery`.

### Task 8: Full verification, integration and authorized production acceptance

**Files:**
- Create: `docs/superpowers/verification/2026-09-02-stale-claim-browser-ux-v1.md`
- No feature code changes unless a verified new regression requires returning to its owning task.

**Interfaces:**
- Consumes all prior commits and the exact authorized production IDs/request IDs.
- Produces final stable runtime and one UNBOUND girls-sets Initial only when both blockers confirm stale.

- [ ] Run `npm run verify:stale-claim-browser-ux`, all new tests, related Catalog/Manual Bind/UI tests, YingDao tests, `npm run check`, and `git diff --check`.
- [ ] Run the full suite with the validated read-only fixture mapping; compare exact file/test/error identities to the seven approved baseline failures and require `NEW_FAILURES=0`.
- [ ] Remove the local `node_modules` symlink, require clean feature status, push feature normally.
- [ ] Audit stable branch/remote; stop on unknown advance, otherwise `git merge --ff-only codex/stale-claim-browser-ux-v1` and repeat verification.
- [ ] Revalidate exact Dashboard PID/port/cwd/command/health, SIGTERM only the owned stable service, wait for release and launch latest stable.
- [ ] Snapshot production Products/Memberships/Pools/Pool items/snapshots/taxonomy and girls-sets Profile/Campaign identities.
- [ ] For each authorized Motorcycle Campaign, execute two inspections at least 10 seconds apart. If either is not `STALE_CONFIRMED`, stop with zero production writes and no girls-sets Campaign.
- [ ] If both confirm, call end-stale with the approved exact request IDs; verify two audits and atomic terminal states, then prove protected fingerprints unchanged.
- [ ] Explicitly create/replay the approved girls-sets Initial request and verify count 1, OPEN_ENDED, baseline/current 0, UNBOUND and no capture/QA/activation.
- [ ] Perform browser acceptance without detect/bind/capture, keep the page open, write verification evidence, commit if documentation changed, push stable normally and verify remote equality.

## Plan gates

- `PLAN_COVERAGE = PASS`
- `TASK_COUNT = 8`
- `UNRESOLVED_SCOPE_DECISIONS = 0`
- `PRODUCTION_WRITES_BEFORE_TASK_8 = 0`
