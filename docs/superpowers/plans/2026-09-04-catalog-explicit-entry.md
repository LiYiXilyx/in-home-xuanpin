# Catalog Explicit Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, as authorized by the operator. No additional approval pause.

**Goal:** Explicit operator click selects START_INITIAL, CONTINUE_INITIAL, or existing Expansion without implicit mutations.

**Architecture:** Add a scoped entry/continuation service composed with the existing Catalog service. Preserve its atomic Initial creation and quantity policy. Catalog module consumes server action descriptors; all page reads remain non-mutating.

**Tech Stack:** Node ESM, node:sqlite, node:test, existing vanilla Catalog UI.

**Spec:** docs/superpowers/specs/2026-09-04-catalog-explicit-entry-design.md

## Global constraints

- No production Campaign actions, production migrations, production writes, Dashboard restart, Temu capture or push.
- Preserve all migration checksums and unrelated dirty files.
- Tests write only temporary/fixture/copied SQLite.
- Final full-suite failures must match the approved seven file/name/reason identities; NEW_FAILURES=0.
- Category/profile identity precedes every action; BEGIN IMMEDIATE covers all continuation rechecks and writes.

## Gap-based execution amendment (supersedes repeating Tasks 1–3)

Retain 9e0ceb7/c18efce/4d8f01a. Audit: `docs/superpowers/verification/2026-09-04-entry-conformance-audit.md`. Design status PARTIAL_IMPLEMENTATION_EXISTS / ACCEPTANCE_PENDING. Six gaps, executed inline without another approval pause.

### Gap Task A — G1/G2 bounded service conformance

Files: `src/modules/catalog-scale/operator-entry-service.mjs`, thin dependency injection in `catalog-campaign-service.mjs`, `test/integration/catalog-explicit-entry.test.mjs`.

- [ ] RED: corrupt frozen membership scope or source category; assert `resolve(...).action === 'BLOCKED'` and ordered DB rows unchanged. End a source while parent is running; replay must throw rather than return prior success. Foreign conflict must include complete blockers.
- [ ] Minimal patch: private read-only Entry tuple validation checks frozen profile/category/scope, exact child/run ownership and legal states. Share it with continuation without changing repositories. Replay additionally requires capturing children. Inject existing claimBlockers callback for error details.
- [ ] GREEN: `node --test test/integration/catalog-explicit-entry.test.mjs`.
- [ ] Related: Initial create/manual-capture/QA/activation tests. `git diff --check`, commit only bounded files.

### Gap Task B — G3 API/race acceptance coverage

Files: existing Entry API test and race worker fixture only, unless RED identifies a bounded controller defect.

- [ ] Add missing/wrong payload and request identity cases; verify `total_changes()` unchanged on rejection/replay. Strengthen competing-request race with allowed loser errors and all Initial creation row counts. Verify identical request retry returns the winner without writes. Bound barrier wait and clean up workers.
- [ ] Run Entry API tests and existing operator/Initial API regressions. Existing passing implementation is retained, not rewritten merely to manufacture RED. If a real failing behavior appears, patch only its Entry boundary.
- [ ] `git diff --check`, independent test commit.

### Gap Task C — G4/G5 remaining UI TDD

Files: `ui/modules/catalog/{api,model,panel}.js`, `test/unit/catalog-explicit-entry-ui.test.mjs`.

- [ ] RED: authoritative descriptor selects START/CONTINUE/EXPANSION/BLOCKED; `continueInitial` sends exact displayed campaign. Initial quantity controls hidden; no required campaign name for continuation. Mount/refresh/change never POST. A deferred response plus two submit events produces one request. Change selection before resolution and assert selection/result stays scoped.
- [ ] Minimal patch: descriptor helper, explicit continue API, synchronous loading guard. Key retained request by category/profile/action/campaign/payload; retry uncertainty reuses identity. Preserve selected profile across refresh; suppress old-scope mutation response/error. Re-read server after success without mutation.
- [ ] GREEN and Catalog module/namespace/polling/Initial UI related tests. `git diff --check`, independent commit.

### Gap Task D — G6 acceptance only

- [ ] Prepare ignored fixture/copied SQLite for four existing environment-dependent tests; production inputs read-only, no production test config.
- [ ] Run focused, related, and full `node --test --test-reporter=tap` with explicit `YINGDAO_REAL_SOURCE_DIR` read-only fixture directory. Capture logs outside git.
- [ ] Compare each failure file/name/reason to approved exact seven; environment failures are not baseline exceptions. Verify protected file diff empty and original three commits ancestors. Record final counts and remaining limitations, commit documentation. No production startup/actions/push.

## Task 1 — Read-only entry resolver

Files: new src/modules/catalog-scale/operator-entry-service.mjs and test/integration/catalog-explicit-entry.test.mjs; modify Catalog service composition and profile descriptor.

Interface: createOperatorEntryService({db,repository,initialRepository,now}) exposes resolve(profile), returning {action,available,code,campaign_id,category_key,category_profile_version}. resolve performs no writes.

- [ ] RED: fixture tests assert START_INITIAL before create, CONTINUE_INITIAL after create, BLOCKED for invalid profile, multiple unfinished Initials, pool history without active, Active Pool plus unfinished Initial, profile mismatch and orphan membership. Compare ordered row fingerprints, not only counts.
- [ ] Run `node --test test/integration/catalog-explicit-entry.test.mjs`; fail because resolver is absent.
- [ ] Implement precedence exactly as spec. Use category-scoped SQL, repository.getCampaign and getBaselineConsistency; never LIMIT 1 to resolve ambiguity.
- [ ] GREEN and related `node --test test/integration/initial-campaign-create.test.mjs`.
- [ ] `git diff --check`; commit `feat: resolve explicit category capture entry`.

## Task 2 — Atomic explicit continuation

Files: operator-entry-service.mjs; Catalog service composition; same integration test file.

Interface: continueInitial({profile,campaignId,requestId}) returns existing Initial operator summary. Store request audit under exact Campaign config operatorContinue requests (bounded to current implementation, no schema migration); request_id scope must be checked across Campaigns. Never use latest selection.

- [ ] RED: running same-claim retains run/token/generation; paused no claim atomically acquires exact claim; foreign claim and terminal/mismatched/multiple states leave ordered rows unchanged; injected transaction failure rolls back; same request replay performs zero writes.
- [ ] Implement within transaction(db,...): resolve again; verify exact id, mode, policy, queue/source identity and allowed states; reject foreign active/nonterminal claimed rows; validate unfinished run cardinality; reuse/acquire exact claim; preserve/create sole unfinished run; reset binding and automatic flags; set full running/capturing/capturing tuple; persist request result.
- [ ] GREEN: `node --test test/integration/catalog-explicit-entry.test.mjs test/integration/initial-manual-capture.test.mjs test/integration/initial-pool-activation.test.mjs`.
- [ ] `git diff --check`; commit `feat: continue exact Initial atomically`.

## Task 3 — Scoped API and concurrent creation

Files: catalog-controller.mjs, router.mjs, test/integration/catalog-explicit-entry-api.test.mjs, new worker fixture under test/fixtures.

Interfaces: GET /api/catalog/operator/entry?category_key=...&category_profile_version=...; POST /api/catalog/operator/initial-campaigns/:campaign_id/continue with matching body ids and request_id. Existing Initial create endpoint unchanged.

- [ ] RED: GET all modes zero writes; wrong path/body identity rejected; continue exact tuple exposed; missing request_id rejected. Use temporary HTTP server and real fixture services.
- [ ] RED race: two Worker threads independently open the same temporary SQLite and await a shared barrier before calling existing createOperatorInitialCampaign with different names/request_ids; assert one complete winner and one hard failure, exactly one source/queue/run/Initial.
- [ ] Wire controller with registry.resolve and assertCampaignBodyIdentity; map result through existing operator response mapping. Verify failure paths do not return current global context.
- [ ] GREEN plus `node --test test/integration/operator-campaign-api.test.mjs test/integration/initial-pool-api.test.mjs`.
- [ ] `git diff --check`; commit `feat: expose strict operator continuation API`.

## Task 4 — Explicit Catalog UI action

Files: ui/modules/catalog/api.js, model.js, panel.js; new test/unit/catalog-explicit-entry-ui.test.mjs.

Interface: profile.entry descriptor drives button; continueInitial(body) submits explicit id; no automatic requests on selection except GET/listProfiles.

- [ ] RED: mount/refresh/category change triggers no mutation; START/CONTINUE/EXPANSION buttons route correct payload; double-click coalesces; retain request_id on uncertain failure; selecting another scope cannot reuse pending request or apply late result; blocked action is disabled.
- [ ] Implement isolated Catalog handlers. Keep ordinary Expansion inputs. Treat continuable profiles as selectable even though creation eligibility is false. Synchronously guard loading; freeze selected identity at click and disregard stale responses.
- [ ] GREEN plus existing Catalog namespace/isolation, Initial UI and operator campaign UI tests.
- [ ] `git diff --check`; commit `feat: show explicit start or continue capture action`.

## Task 5 — Full verification

- [ ] Run all new tests and directly related Initial/claim/Manual Bind/activation/Catalog UI regressions.
- [ ] Run full suite using same isolated environment as pre-change baseline: `node --test --test-reporter=tap`.
- [ ] Compare exact failing file/name/error class/actual/expected against approved seven and pre-change baseline; investigate environmental failures, never classify them as approved.
- [ ] Record results, commit list, clean/dirty status and deployment-not-performed in docs/superpowers/verification/2026-09-04-catalog-explicit-entry.md.
- [ ] `git diff --check`; commit verification only. No merge into runtime, restart, push or production writes.

## Coverage self-review

Precedence/read-only: Task 1. Full state tuple/claim/idempotency/rollback: Task 2. Exact HTTP identity and two-connection race: Task 3. Explicit operator trigger and frontend duplicate/stale-response safety: Task 4. Exact-seven regressions and production boundary: Task 5.
